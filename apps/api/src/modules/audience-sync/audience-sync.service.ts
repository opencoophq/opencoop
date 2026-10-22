import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@opencoop/database';
import { PrismaService } from '../../prisma/prisma.service';
import {
  EmailAudienceProvider,
  UpsertContactInput,
  UpsertResult,
} from './audience-provider.interface';
import { AudienceProviderConfig, getAudienceProvider } from './audience-provider.factory';
import { SyncErrorDetail, toSyncErrorDetail } from './audience-sync.errors';
import { groupShareholdersByEmail, resolvedGroupEmail } from './audience-sync.grouping';

export interface ReconcileSummary {
  created: number;
  updated: number;
  /** Contact was placed on one managed list and removed from another. */
  moved: number;
  /** Contact was removed from managed lists and not added to another. */
  unlinked: number;
  /** Provider returned 404 and nothing was created. The shareholder had an email. */
  noop: number;
  /** No resolvable email and no existing contact to change, or sync is not configured. */
  skipped: number;
  failed: number;
  errors: SyncErrorDetail[];
}

const EMPTY = (): ReconcileSummary => ({
  created: 0,
  updated: 0,
  moved: 0,
  unlinked: 0,
  noop: 0,
  skipped: 0,
  failed: 0,
  errors: [],
});

// Selection shared by reconcileOne/reconcileAll so the mapping is identical.
const SHAREHOLDER_SELECT = {
  id: true,
  status: true,
  firstName: true,
  lastName: true,
  companyName: true,
  email: true,
  createdAt: true,
  userId: true,
  user: { select: { email: true } },
} as const;

type CoopAudienceConfig = AudienceProviderConfig & {
  brevoMembersListId: string | null;
  brevoResignedListId: string | null;
};

type SelectedShareholder = {
  id: string;
  status: string;
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
  email: string | null;
  createdAt: Date;
  userId: string | null;
  user: { email: string | null } | null;
};

type ContactIntent = 'active' | 'move' | 'unlink';

@Injectable()
export class AudienceSyncService {
  private readonly logger = new Logger(AudienceSyncService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Overridable seam so tests can stub the provider. */
  protected providerFor(coop: AudienceProviderConfig): EmailAudienceProvider {
    return getAudienceProvider(coop);
  }

  async reconcileOne(coopId: string, shareholderId: string): Promise<ReconcileSummary> {
    const summary = EMPTY();
    const coop = await this.prisma.coop.findUnique({ where: { id: coopId } });
    if (!coop?.emailAudienceProvider) {
      summary.skipped++;
      return summary;
    }

    const shareholder = await this.prisma.shareholder.findFirst({
      where: { id: shareholderId, coopId },
      select: SHAREHOLDER_SELECT,
    });
    if (!shareholder) {
      summary.skipped++;
      return summary;
    }

    const provider = this.providerFor(coop);
    const shareholders = await this.loadEmailGroup(coopId, shareholder);
    await this.applyShareholders(provider, coop, shareholders, summary);
    return summary;
  }

  async reconcileAll(coopId: string, trigger: 'cron' | 'manual'): Promise<ReconcileSummary> {
    const summary = EMPTY();
    const coop = await this.prisma.coop.findUnique({ where: { id: coopId } });
    if (!coop?.emailAudienceProvider) {
      summary.skipped++;
      return summary;
    }

    // A row left RUNNING means the process died mid-run. Close it before starting another.
    await this.prisma.brevoSyncRun.updateMany({
      where: { coopId, status: 'RUNNING' },
      data: {
        status: 'ERROR',
        finishedAt: new Date(),
        errors: [{ code: 'RUN_INTERRUPTED', message: 'RUN_INTERRUPTED', email: null }],
      },
    });

    const run = await this.prisma.brevoSyncRun.create({
      data: { coopId, trigger, status: 'RUNNING' },
    });

    try {
      await this.prisma.coop.update({
        where: { id: coopId },
        data: { brevoLastSyncStatus: 'RUNNING' },
      });

      const provider = this.providerFor(coop);
      const shareholders = await this.prisma.shareholder.findMany({
        where: { coopId },
        select: SHAREHOLDER_SELECT,
      });
      await this.applyShareholders(provider, coop, shareholders, summary);

      const status = summary.failed > 0 ? 'PARTIAL' : 'OK';
      await this.prisma.brevoSyncRun.update({
        where: { id: run.id },
        data: {
          status,
          finishedAt: new Date(),
          added: summary.created,
          created: summary.created,
          updated: summary.updated,
          moved: summary.moved,
          unlinked: summary.unlinked,
          noop: summary.noop,
          skipped: summary.skipped,
          failed: summary.failed,
          errors: summary.errors.length
            ? (summary.errors as unknown as Prisma.InputJsonValue)
            : undefined,
        },
      });
      await this.prisma.coop.update({
        where: { id: coopId },
        data: { brevoLastSyncAt: new Date(), brevoLastSyncStatus: status },
      });
      return summary;
    } catch (err) {
      const detail = toSyncErrorDetail(err);
      try {
        await this.prisma.brevoSyncRun.update({
          where: { id: run.id },
          data: {
            status: 'ERROR',
            finishedAt: new Date(),
            errors: [detail] as unknown as Prisma.InputJsonValue,
          },
        });
      } catch (recoveryErr) {
        const recoveryMessage =
          recoveryErr instanceof Error ? recoveryErr.message : String(recoveryErr);
        this.logger.error(`audience-sync recovery run update failed: ${recoveryMessage}`);
      }
      try {
        await this.prisma.coop.update({
          where: { id: coopId },
          data: { brevoLastSyncAt: new Date(), brevoLastSyncStatus: 'ERROR' },
        });
      } catch (recoveryErr) {
        const recoveryMessage =
          recoveryErr instanceof Error ? recoveryErr.message : String(recoveryErr);
        this.logger.error(`audience-sync recovery coop update failed: ${recoveryMessage}`);
      }
      throw err;
    }
  }

  /**
   * Shareholders that resolve to the same email must be reconciled together,
   * including from reconcileOne, or the secondary would be pushed as its own
   * contact and Brevo would reject the shared address.
   */
  private async loadEmailGroup(
    coopId: string,
    shareholder: SelectedShareholder,
  ): Promise<SelectedShareholder[]> {
    const email = resolvedGroupEmail(shareholder);
    if (!email) return [shareholder];

    const or: Prisma.ShareholderWhereInput[] = [
      { id: shareholder.id },
      { email: { equals: email, mode: 'insensitive' } },
      { user: { is: { email: { equals: email, mode: 'insensitive' } } } },
    ];
    if (shareholder.userId) or.push({ userId: shareholder.userId });

    const candidates = await this.prisma.shareholder.findMany({
      where: { coopId, OR: or },
      select: SHAREHOLDER_SELECT,
    });
    const grouped = candidates.filter((candidate) => resolvedGroupEmail(candidate) === email);
    return grouped.length > 0 ? grouped : [shareholder];
  }

  private async applyShareholders(
    provider: EmailAudienceProvider,
    coop: CoopAudienceConfig,
    shareholders: SelectedShareholder[],
    summary: ReconcileSummary,
  ): Promise<void> {
    const membersList = listId(coop.brevoMembersListId);
    const resignedList = listId(coop.brevoResignedListId);
    if (!membersList) {
      summary.skipped += shareholders.length;
      return;
    }

    const managedListIds = resignedList ? [membersList, resignedList] : [membersList];

    for (const group of groupShareholdersByEmail(shareholders)) {
      if (!group.email) {
        await this.applyWithoutEmail(
          provider,
          group.shareholders[0],
          membersList,
          resignedList,
          summary,
        );
        continue;
      }

      const [primary, ...secondaries] = group.shareholders;
      await this.applyWithEmail(
        provider,
        primary,
        secondaries.map((secondary) => secondary.id),
        group.email,
        membersList,
        resignedList,
        summary,
      );
      for (const secondary of secondaries) {
        await this.unlinkContact(provider, secondary.id, managedListIds, true, summary);
      }
    }
  }

  private async applyWithEmail(
    provider: EmailAudienceProvider,
    shareholder: SelectedShareholder,
    claimFromExtIds: string[],
    email: string,
    membersList: number,
    resignedList: number | null,
    summary: ReconcileSummary,
  ): Promise<void> {
    const plan = planForStatus(shareholder.status, membersList, resignedList, true);
    await this.runContact(
      provider,
      shareholder.id,
      {
        extId: shareholder.id,
        email,
        attributes: nameAttributes(shareholder),
        addListIds: plan.addListIds,
        removeListIds: plan.removeListIds,
        createIfMissing: plan.createIfMissing,
        claimFromExtIds,
      },
      plan.intent,
      true,
      summary,
    );
  }

  private async applyWithoutEmail(
    provider: EmailAudienceProvider,
    shareholder: SelectedShareholder,
    membersList: number,
    resignedList: number | null,
    summary: ReconcileSummary,
  ): Promise<void> {
    // An ACTIVE shareholder whose email was removed may still sit on the members
    // list under their EXT_ID. Unlink that contact. Do not create one, and do
    // not delete it. INACTIVE/PENDING follow the same list plan, still by EXT_ID.
    const plan = planForStatus(shareholder.status, membersList, resignedList, false);
    await this.runContact(
      provider,
      shareholder.id,
      {
        extId: shareholder.id,
        email: null,
        attributes: nameAttributes(shareholder),
        addListIds: plan.addListIds,
        removeListIds: plan.removeListIds,
        createIfMissing: false,
      },
      plan.intent,
      false,
      summary,
    );
  }

  private async unlinkContact(
    provider: EmailAudienceProvider,
    shareholderId: string,
    removeListIds: number[],
    hadEmail: boolean,
    summary: ReconcileSummary,
  ): Promise<void> {
    await this.runContact(
      provider,
      shareholderId,
      {
        extId: shareholderId,
        email: null,
        attributes: {},
        addListIds: [],
        removeListIds,
        createIfMissing: false,
      },
      'unlink',
      hadEmail,
      summary,
    );
  }

  private async runContact(
    provider: EmailAudienceProvider,
    shareholderId: string,
    input: UpsertContactInput,
    intent: ContactIntent,
    hadEmail: boolean,
    summary: ReconcileSummary,
  ): Promise<void> {
    try {
      const result = await provider.upsertContact(input);
      tally(summary, intent, result, hadEmail);
    } catch (err) {
      const detail = toSyncErrorDetail(err, shareholderId, input.email);
      summary.failed++;
      summary.errors.push(detail);
      this.logger.warn(`audience-sync failed for ${shareholderId}: ${detail.code}`);
    }
  }
}

function listId(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function nameAttributes(shareholder: SelectedShareholder): UpsertContactInput['attributes'] {
  return {
    FIRSTNAME: shareholder.firstName ?? undefined,
    LASTNAME: shareholder.lastName ?? shareholder.companyName ?? undefined,
  };
}

/**
 * List plan for one shareholder.
 * `withEmail` ACTIVE contacts are created when missing.
 * Without an email the same lists are updated only when the EXT_ID already exists.
 * ACTIVE without an email is unlinked from the members list only.
 */
function planForStatus(
  status: string,
  membersList: number,
  resignedList: number | null,
  withEmail: boolean,
): {
  addListIds: number[];
  removeListIds: number[];
  createIfMissing: boolean;
  intent: ContactIntent;
} {
  if (status === 'ACTIVE') {
    if (!withEmail) {
      return {
        addListIds: [],
        removeListIds: [membersList],
        createIfMissing: false,
        intent: 'unlink',
      };
    }
    return {
      addListIds: [membersList],
      removeListIds: resignedList ? [resignedList] : [],
      createIfMissing: true,
      intent: 'active',
    };
  }
  if (status === 'INACTIVE' && resignedList) {
    return {
      addListIds: [resignedList],
      removeListIds: [membersList],
      createIfMissing: false,
      intent: 'move',
    };
  }
  return {
    addListIds: [],
    removeListIds: [membersList],
    createIfMissing: false,
    intent: 'unlink',
  };
}

function tally(
  summary: ReconcileSummary,
  intent: ContactIntent,
  result: UpsertResult,
  hadEmail: boolean,
): void {
  if (result === 'noop') {
    if (hadEmail) summary.noop++;
    else summary.skipped++;
    return;
  }
  if (intent === 'move') {
    summary.moved++;
    return;
  }
  if (intent === 'unlink') {
    summary.unlinked++;
    return;
  }
  if (result === 'created') summary.created++;
  else summary.updated++;
}
