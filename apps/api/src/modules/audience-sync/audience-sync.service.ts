import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { resolveShareholderEmail } from '../shareholders/shareholder-email.resolver';
import { EmailAudienceProvider, UpsertContactInput } from './audience-provider.interface';
import { AudienceProviderConfig, getAudienceProvider } from './audience-provider.factory';

export interface ReconcileSummary {
  added: number;
  updated: number;
  moved: number;
  skipped: number;
  failed: number;
  errors: Array<{ shareholderId: string; email: string | null; message: string }>;
}

const EMPTY = (): ReconcileSummary => ({
  added: 0,
  updated: 0,
  moved: 0,
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
  user: { email: string | null } | null;
};

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

    const shareholder = await this.prisma.shareholder.findUnique({
      where: { id: shareholderId },
      select: SHAREHOLDER_SELECT,
    });
    if (!shareholder) {
      summary.skipped++;
      return summary;
    }

    const provider = this.providerFor(coop);
    await this.applyOne(provider, coop, shareholder, summary);
    return summary;
  }

  async reconcileAll(coopId: string, trigger: 'cron' | 'manual'): Promise<ReconcileSummary> {
    const summary = EMPTY();
    const coop = await this.prisma.coop.findUnique({ where: { id: coopId } });
    if (!coop?.emailAudienceProvider) {
      summary.skipped++;
      return summary;
    }

    await this.prisma.coop.update({
      where: { id: coopId },
      data: { brevoLastSyncStatus: 'RUNNING' },
    });
    const provider = this.providerFor(coop);

    const shareholders = await this.prisma.shareholder.findMany({
      where: { coopId, status: { in: ['ACTIVE', 'INACTIVE'] } },
      select: SHAREHOLDER_SELECT,
    });
    for (const shareholder of shareholders) {
      await this.applyOne(provider, coop, shareholder, summary);
    }

    const status = summary.failed > 0 ? 'PARTIAL' : 'OK';
    await this.prisma.brevoSyncRun.create({
      data: {
        coopId,
        trigger,
        status,
        finishedAt: new Date(),
        added: summary.added,
        updated: summary.updated,
        moved: summary.moved,
        skipped: summary.skipped,
        failed: summary.failed,
        errors: summary.errors.length ? summary.errors : undefined,
      },
    });
    await this.prisma.coop.update({
      where: { id: coopId },
      data: { brevoLastSyncAt: new Date(), brevoLastSyncStatus: status },
    });
    return summary;
  }

  private async applyOne(
    provider: EmailAudienceProvider,
    coop: CoopAudienceConfig,
    shareholder: SelectedShareholder,
    summary: ReconcileSummary,
  ): Promise<void> {
    const email = resolveShareholderEmail(shareholder);
    const membersList = coop.brevoMembersListId ? Number(coop.brevoMembersListId) : null;
    const resignedList = coop.brevoResignedListId ? Number(coop.brevoResignedListId) : null;

    if (shareholder.status === 'PENDING' || !membersList) {
      summary.skipped++;
      return;
    }
    if (shareholder.status === 'ACTIVE' && !email) {
      summary.skipped++;
      return;
    }

    const attributes = {
      FIRSTNAME: shareholder.firstName ?? undefined,
      LASTNAME: shareholder.lastName ?? shareholder.companyName ?? undefined,
    };

    let input: UpsertContactInput;
    if (shareholder.status === 'ACTIVE') {
      input = {
        extId: shareholder.id,
        email,
        attributes,
        addListIds: [membersList],
        removeListIds: resignedList ? [resignedList] : [],
        createIfMissing: true,
      };
    } else {
      // INACTIVE: remove from members, move to resigned iff configured; never create.
      input = {
        extId: shareholder.id,
        email,
        attributes,
        addListIds: resignedList ? [resignedList] : [],
        removeListIds: [membersList],
        createIfMissing: false,
      };
    }

    try {
      const result = await provider.upsertContact(input);
      if (shareholder.status === 'INACTIVE') {
        summary.moved++;
      } else if (result === 'created') {
        summary.added++;
      } else {
        summary.updated++;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      summary.failed++;
      summary.errors.push({ shareholderId: shareholder.id, email, message });
      this.logger.warn(`audience-sync failed for ${shareholder.id}: ${message}`);
    }
  }
}
