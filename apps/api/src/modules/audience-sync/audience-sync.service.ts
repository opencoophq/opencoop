import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@opencoop/database';
import { PrismaService } from '../../prisma/prisma.service';
import {
  EmailAudienceProvider,
  UpsertContactInput,
  UpsertResult,
} from './audience-provider.interface';
import { AudienceProviderConfig, getAudienceProvider } from './audience-provider.factory';
import {
  filterMemberAttributes,
  memberAttributeSupport,
  memberContactAttributes,
  MemberAttributeSupport,
} from './audience-sync.attributes';
import { SyncErrorDetail, toSyncErrorDetail } from './audience-sync.errors';
import { groupShareholdersByEmail, resolvedGroupEmail } from './audience-sync.grouping';

export interface ReconcileSummary {
  created: number;
  updated: number;
  /**
   * Lists re-applied: Brevo accepted a PUT that adds one managed list and
   * removes another. Membership was not re-read, so this is not a verified move.
   */
  moved: number;
  /**
   * Lists re-applied: Brevo accepted a PUT that only removes managed lists.
   * Membership was not re-read.
   */
  unlinked: number;
  /** Provider returned 404 and nothing was created. The shareholder had an email. */
  noop: number;
  /** No resolvable email and no existing contact to change, or sync is not configured. */
  skipped: number;
  failed: number;
  errors: SyncErrorDetail[];
}

/** A RUNNING row older than this is a dead process. A younger one means skip. */
const STALE_RUN_MS = 2 * 60 * 60 * 1000;

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
  brevoProspectsListId?: string | null;
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
    const attributeSupport = await this.loadAttributeSupport(coopId, provider);
    const shareholders = await this.loadEmailGroup(coopId, shareholder);
    await this.applyShareholders(provider, coop, shareholders, summary, attributeSupport);
    return summary;
  }

  async reconcileAll(coopId: string, trigger: 'cron' | 'manual'): Promise<ReconcileSummary> {
    const summary = EMPTY();
    const coop = await this.prisma.coop.findUnique({ where: { id: coopId } });
    if (!coop?.emailAudienceProvider) {
      summary.skipped++;
      return summary;
    }

    const run = await this.openRun(coopId, trigger);
    if (!run) {
      this.logger.warn(`audience-sync skipped for ${coopId}: a run is already in progress`);
      return summary;
    }

    let attributeSupport: MemberAttributeSupport | null = null;
    try {
      await this.prisma.coop.update({
        where: { id: coopId },
        data: { brevoLastSyncStatus: 'RUNNING' },
      });

      const provider = this.providerFor(coop);
      attributeSupport = await this.loadAttributeSupport(coopId, provider);
      const shareholders = await this.prisma.shareholder.findMany({
        where: { coopId },
        select: SHAREHOLDER_SELECT,
      });
      await this.applyShareholders(provider, coop, shareholders, summary, attributeSupport);

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
          warnings: warningJson(attributeSupport),
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
            warnings: warningJson(attributeSupport),
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
   * One reconcile-all at a time per coop. The advisory lock is transaction-scoped
   * so it is safe on the Prisma pool: it only covers marking a stale RUNNING row
   * and inserting the new one. A RUNNING row younger than two hours is left
   * alone and this call does nothing. Only an older RUNNING row is RUN_INTERRUPTED.
   */
  private async openRun(coopId: string, trigger: 'cron' | 'manual') {
    const staleBefore = new Date(Date.now() - STALE_RUN_MS);
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`audience-sync:${coopId}`})::bigint)`;
      await tx.brevoSyncRun.updateMany({
        where: { coopId, status: 'RUNNING', startedAt: { lt: staleBefore } },
        data: {
          status: 'ERROR',
          finishedAt: new Date(),
          errors: [{ code: 'RUN_INTERRUPTED', message: 'RUN_INTERRUPTED', email: null }],
        },
      });
      const busy = await tx.brevoSyncRun.findFirst({
        where: { coopId, status: 'RUNNING', startedAt: { gte: staleBefore } },
        select: { id: true },
      });
      if (busy) return null;
      return tx.brevoSyncRun.create({
        data: { coopId, trigger, status: 'RUNNING' },
      });
    });
  }

  /**
   * Shareholders that resolve to the same email must be reconciled together,
   * including from reconcileOne, or the secondary would be pushed as its own
   * contact and Brevo would reject the shared address.
   *
   * The lookup trims and lowercases stored emails. Prisma `equals` is
   * case-insensitive but does not trim, so ` Ann@X.be ` would miss the group.
   */
  private async loadEmailGroup(
    coopId: string,
    shareholder: SelectedShareholder,
  ): Promise<SelectedShareholder[]> {
    const email = resolvedGroupEmail(shareholder);
    if (!email) return [shareholder];

    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT s."id"
      FROM "shareholders" s
      LEFT JOIN "users" u ON u."id" = s."userId"
      WHERE s."coopId" = ${coopId}
        AND (
          lower(trim(s."email")) = ${email}
          OR lower(trim(u."email")) = ${email}
        )
    `;
    const ids = [...new Set([shareholder.id, ...rows.map((row) => row.id)])];
    const candidates = await this.prisma.shareholder.findMany({
      where: { coopId, id: { in: ids } },
      select: SHAREHOLDER_SELECT,
    });
    const grouped = candidates.filter((candidate) => resolvedGroupEmail(candidate) === email);
    return grouped.length > 0 ? grouped : [shareholder];
  }

  /**
   * One attribute read per run. A short provider cache covers reconcile-one
   * bursts. Missing COOPERANT/STATUS is a warning: those keys are left out and
   * the list sync still runs. It does not increment `failed`.
   */
  private async loadAttributeSupport(
    coopId: string,
    provider: EmailAudienceProvider,
  ): Promise<MemberAttributeSupport> {
    try {
      const definitions = await provider.listContactAttributes();
      const support = memberAttributeSupport(definitions);
      if (support.warning) {
        this.logger.warn(`audience-sync ${coopId}: ${support.warning}`);
      }
      return support;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const warning = 'MISSING_ATTRIBUTES: contact attributes could not be read';
      this.logger.warn(`audience-sync ${coopId}: ${warning} (${message})`);
      return { cooperant: false, status: false, warning };
    }
  }

  private async applyShareholders(
    provider: EmailAudienceProvider,
    coop: CoopAudienceConfig,
    shareholders: SelectedShareholder[],
    summary: ReconcileSummary,
    attributeSupport: MemberAttributeSupport,
  ): Promise<void> {
    const membersList = listId(coop.brevoMembersListId);
    const resignedList = listId(coop.brevoResignedListId);
    const prospectsList = listId(coop.brevoProspectsListId);
    if (!membersList) {
      summary.skipped += shareholders.length;
      return;
    }

    const managedListIds = uniqueNumbers([membersList, resignedList, prospectsList]);

    for (const group of groupShareholdersByEmail(shareholders)) {
      if (!group.email) {
        await this.applyWithoutEmail(
          provider,
          group.shareholders[0],
          membersList,
          resignedList,
          summary,
          attributeSupport,
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
        prospectsList,
        summary,
        attributeSupport,
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
    prospectsList: number | null,
    summary: ReconcileSummary,
    attributeSupport: MemberAttributeSupport,
  ): Promise<void> {
    const plan = planForStatus(shareholder.status, membersList, resignedList, prospectsList, true);
    await this.runContact(
      provider,
      shareholder.id,
      {
        extId: shareholder.id,
        email,
        attributes: filterMemberAttributes(memberContactAttributes(shareholder), attributeSupport),
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
    attributeSupport: MemberAttributeSupport,
  ): Promise<void> {
    // An ACTIVE shareholder whose email was removed may still sit on the members
    // list under their EXT_ID. Unlink that contact. Do not create one, and do
    // not delete it. A resigned shareholder with no email still gets
    // COOPERANT=false and STATUS=resigned when that contact exists.
    const plan = planForStatus(shareholder.status, membersList, resignedList, null, false);
    const raw =
      shareholder.status === 'INACTIVE'
        ? memberContactAttributes(shareholder)
        : nameAttributes(shareholder);
    await this.runContact(
      provider,
      shareholder.id,
      {
        extId: shareholder.id,
        email: null,
        attributes: filterMemberAttributes(raw, attributeSupport),
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
  const attributes: UpsertContactInput['attributes'] = {};
  if (shareholder.firstName) attributes.FIRSTNAME = shareholder.firstName;
  const lastName = shareholder.lastName ?? shareholder.companyName;
  if (lastName) attributes.LASTNAME = lastName;
  return attributes;
}

function uniqueNumbers(ids: Array<number | null | undefined>): number[] {
  const out: number[] = [];
  for (const id of ids) {
    if (id == null || out.includes(id)) continue;
    out.push(id);
  }
  return out;
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
  prospectsList: number | null,
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
      // Drop the contact from prospects when they become (or stay) ACTIVE.
      // Never remove the members list we are adding them to.
      removeListIds: uniqueNumbers([resignedList, prospectsList]).filter(
        (id) => id !== membersList,
      ),
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

function warningJson(support: MemberAttributeSupport | null): Prisma.InputJsonValue | undefined {
  if (!support?.warning) return undefined;
  return { attributeStatus: support.warning };
}
