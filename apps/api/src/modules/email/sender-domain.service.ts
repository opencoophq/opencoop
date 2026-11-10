import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  authenticateBrevoDomain,
  BrevoDomainRequestError,
  BrevoDomainSnapshot,
  createBrevoDomain,
  getBrevoDomain,
  SenderDnsRecord,
} from './brevo-domains';
import { normalizeDomain, normalizeEmail, emailDomain, sanitizeDisplayName } from './sender-domain';

const SELECT = {
  id: true,
  name: true,
  coopEmail: true,
  senderDomain: true,
  senderFromAddress: true,
  senderFromName: true,
  senderDomainStatus: true,
  senderDomainCheckedAt: true,
  senderDomainRecords: true,
  senderDomainError: true,
} as const;

type SenderRow = Prisma.CoopGetPayload<{ select: typeof SELECT }>;

export interface SenderDomainActor {
  id?: string;
  ip?: string;
  userAgent?: string | string[];
}

export interface SenderDomainView {
  senderDomain: string | null;
  senderFromAddress: string | null;
  senderFromName: string | null;
  senderDomainStatus: string | null;
  senderDomainCheckedAt: string | null;
  senderDomainRecords: SenderDnsRecord[];
  senderDomainError: string | null;
}

export interface UpsertSenderDomainInput {
  domain: string;
  fromAddress: string;
  fromName?: string | null;
}

@Injectable()
export class SenderDomainService {
  private readonly logger = new Logger(SenderDomainService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async register(
    coopId: string,
    input: UpsertSenderDomainInput,
    actor?: SenderDomainActor,
  ): Promise<SenderDomainView> {
    const coop = await this.requireCoop(coopId);
    const domain = this.parseDomain(input.domain);
    const fromAddress = this.parseFromAddress(input.fromAddress, domain);
    const fromName = sanitizeDisplayName(input.fromName) ?? sanitizeDisplayName(coop.name);
    const apiKey = this.requireApiKey();

    let snapshot: BrevoDomainSnapshot | null = null;
    try {
      snapshot = await createBrevoDomain(apiKey, domain);
      snapshot = await getBrevoDomain(apiKey, domain);
    } catch (error) {
      this.reportProviderError(domain, error);
      // A create payload is enough to show DNS records. No payload means Brevo
      // never accepted the domain, so the admin can retry.
      if (!snapshot) throw new BadRequestException('SENDER_DOMAIN_PROVIDER');
    }

    const records = snapshot?.records ?? [];
    const ready = snapshot?.verified === true && snapshot?.authenticated === true;
    const status = ready ? 'verified' : 'pending';
    const updated = await this.prisma.coop.update({
      where: { id: coopId },
      data: {
        senderDomain: domain,
        senderFromAddress: fromAddress,
        senderFromName: fromName,
        senderDomainStatus: status,
        senderDomainCheckedAt: new Date(),
        senderDomainRecords: records as unknown as Prisma.InputJsonValue,
        senderDomainError: null,
      },
      select: SELECT,
    });
    await this.auditChange(coop, updated, actor);
    return toView(updated);
  }

  async check(coopId: string, actor?: SenderDomainActor): Promise<SenderDomainView> {
    const coop = await this.requireCoop(coopId);
    if (!coop.senderDomain) throw new BadRequestException('SENDER_DOMAIN_NOT_SET');
    const domain = normalizeDomain(coop.senderDomain);
    if (!domain) throw new BadRequestException('SENDER_DOMAIN_INVALID');
    const apiKey = this.requireApiKey();

    try {
      const auth = await authenticateBrevoDomain(apiKey, domain);
      if (auth.missing) {
        return this.saveOutcome(coop, actor, {
          status: 'failed',
          error: 'DOMAIN_MISSING',
          records: readRecords(coop.senderDomainRecords),
        });
      }
      const snapshot = await getBrevoDomain(apiKey, domain);
      const ready = snapshot.verified && snapshot.authenticated;
      return this.saveOutcome(coop, actor, {
        status: ready ? 'verified' : 'failed',
        error: ready ? null : 'DNS_NOT_READY',
        records: snapshot.records,
      });
    } catch (error) {
      this.reportProviderError(domain, error);
      if (error instanceof BrevoDomainRequestError && error.status === 404) {
        return this.saveOutcome(coop, actor, {
          status: 'failed',
          error: 'DOMAIN_MISSING',
          records: readRecords(coop.senderDomainRecords),
        });
      }
      // A transport or 5xx failure must not take a working domain offline.
      return this.saveOutcome(coop, actor, {
        status: coop.senderDomainStatus,
        error: 'PROVIDER_ERROR',
        records: readRecords(coop.senderDomainRecords),
      });
    }
  }

  async clear(coopId: string, actor?: SenderDomainActor): Promise<SenderDomainView> {
    const coop = await this.requireCoop(coopId);
    const updated = await this.prisma.coop.update({
      where: { id: coopId },
      data: {
        senderDomain: null,
        senderFromAddress: null,
        senderFromName: null,
        senderDomainStatus: null,
        senderDomainCheckedAt: null,
        senderDomainRecords: Prisma.DbNull,
        senderDomainError: null,
      },
      select: SELECT,
    });
    await this.auditChange(coop, updated, actor);
    return toView(updated);
  }

  /**
   * Daily read of domains already stored. Does not call authenticate.
   * A verified domain is demoted only when Brevo answers that it is no
   * longer verified or authenticated. Transport errors leave the status.
   */
  async recheckAll(): Promise<void> {
    const coops = await this.prisma.coop.findMany({
      where: { senderDomain: { not: null } },
      select: { id: true },
    });
    if (coops.length === 0) return;
    if (!readApiKey()) {
      this.logger.warn('BREVO_API_KEY is not set; skipping sender-domain recheck');
      return;
    }
    for (const coop of coops) {
      try {
        await this.recheckOne(coop.id);
      } catch (error) {
        Sentry.captureException(error);
        const message = error instanceof Error ? error.message : 'unknown error';
        this.logger.error(
          `Sender domain recheck failed for coop ${coop.id}: ${redactApiKey(message)}`,
        );
      }
    }
  }

  async recheckOne(coopId: string): Promise<void> {
    const coop = await this.prisma.coop.findUnique({ where: { id: coopId }, select: SELECT });
    if (!coop?.senderDomain) return;
    const domain = normalizeDomain(coop.senderDomain);
    if (!domain) return;
    const apiKey = readApiKey();
    if (!apiKey) return;

    try {
      const snapshot = await getBrevoDomain(apiKey, domain);
      const ready = snapshot.verified && snapshot.authenticated;
      let status = coop.senderDomainStatus;
      let error: string | null = coop.senderDomainError;
      if (ready) {
        status = 'verified';
        error = null;
      } else if (coop.senderDomainStatus === 'verified') {
        status = 'failed';
        error = 'DNS_NOT_READY';
      }
      await this.saveOutcome(coop, undefined, {
        status,
        error,
        records: snapshot.records,
      });
    } catch (error) {
      this.reportProviderError(domain, error);
      if (error instanceof BrevoDomainRequestError && error.status === 404) {
        await this.saveOutcome(coop, undefined, {
          status: 'failed',
          error: 'DOMAIN_MISSING',
          records: readRecords(coop.senderDomainRecords),
        });
        return;
      }
      await this.saveOutcome(coop, undefined, {
        status: coop.senderDomainStatus,
        error: 'PROVIDER_ERROR',
        records: readRecords(coop.senderDomainRecords),
      });
    }
  }

  private async saveOutcome(
    coop: SenderRow,
    actor: SenderDomainActor | undefined,
    outcome: { status: string | null; error: string | null; records: SenderDnsRecord[] },
  ): Promise<SenderDomainView> {
    const updated = await this.prisma.coop.update({
      where: { id: coop.id },
      data: {
        senderDomainStatus: outcome.status,
        senderDomainError: outcome.error,
        senderDomainCheckedAt: new Date(),
        senderDomainRecords: outcome.records as unknown as Prisma.InputJsonValue,
      },
      select: SELECT,
    });
    await this.auditChange(coop, updated, actor);
    return toView(updated);
  }

  private async requireCoop(coopId: string): Promise<SenderRow> {
    const coop = await this.prisma.coop.findUnique({ where: { id: coopId }, select: SELECT });
    if (!coop) throw new NotFoundException('Cooperative not found');
    return coop;
  }

  private parseDomain(input: string): string {
    const domain = normalizeDomain(input);
    if (!domain) {
      const raw = typeof input === 'string' ? input.trim().toLowerCase() : '';
      if (raw === 'opencoop.be' || raw.endsWith('.opencoop.be')) {
        throw new BadRequestException('SENDER_DOMAIN_PLATFORM');
      }
      throw new BadRequestException('SENDER_DOMAIN_INVALID');
    }
    return domain;
  }

  private parseFromAddress(input: string, domain: string): string {
    const address = normalizeEmail(input);
    if (!address) throw new BadRequestException('SENDER_DOMAIN_FROM_INVALID');
    if (emailDomain(address) !== domain)
      throw new BadRequestException('SENDER_DOMAIN_FROM_MISMATCH');
    return address;
  }

  private requireApiKey(): string {
    const apiKey = readApiKey();
    if (!apiKey) throw new ServiceUnavailableException('SENDER_DOMAIN_UNAVAILABLE');
    return apiKey;
  }

  private reportProviderError(domain: string, error: unknown): void {
    const message = error instanceof Error ? error.message : 'unknown error';
    this.logger.warn(`Brevo sender domain request failed for ${domain}: ${redactApiKey(message)}`);
  }

  private async auditChange(
    before: SenderRow,
    after: SenderRow,
    actor?: SenderDomainActor,
  ): Promise<void> {
    const changes = diffSender(before, after);
    if (changes.length === 0) return;
    try {
      await this.audit.log({
        coopId: before.id,
        entity: 'Coop',
        entityId: before.id,
        action: 'UPDATE',
        changes,
        actorId: actor?.id,
        ipAddress: actor?.ip,
        userAgent: typeof actor?.userAgent === 'string' ? actor.userAgent : undefined,
      });
    } catch (error) {
      Sentry.captureException(error);
      this.logger.error(`Failed to audit sender domain change for coop ${before.id}`);
    }
  }
}

function readApiKey(): string | null {
  const value = process.env.BREVO_API_KEY?.trim();
  return value ? value : null;
}

function redactApiKey(message: string): string {
  const apiKey = readApiKey();
  if (!apiKey) return message;
  return message.split(apiKey).join('[redacted]');
}

function diffSender(
  before: SenderRow,
  after: SenderRow,
): Array<{ field: string; oldValue: unknown; newValue: unknown }> {
  const fields = [
    'senderDomain',
    'senderFromAddress',
    'senderFromName',
    'senderDomainStatus',
    'senderDomainError',
  ] as const;
  const changes: Array<{ field: string; oldValue: unknown; newValue: unknown }> = [];
  for (const field of fields) {
    if (before[field] !== after[field]) {
      changes.push({ field, oldValue: before[field], newValue: after[field] });
    }
  }
  return changes;
}

export function readRecords(value: unknown): SenderDnsRecord[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isSenderDnsRecord);
}

function isSenderDnsRecord(value: unknown): value is SenderDnsRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    (record.key === 'brevo-code' ||
      record.key === 'dkim' ||
      record.key === 'spf' ||
      record.key === 'dmarc') &&
    typeof record.type === 'string' &&
    typeof record.host === 'string' &&
    typeof record.value === 'string'
  );
}

function toView(row: SenderRow): SenderDomainView {
  return {
    senderDomain: row.senderDomain,
    senderFromAddress: row.senderFromAddress,
    senderFromName: row.senderFromName,
    senderDomainStatus: row.senderDomainStatus,
    senderDomainCheckedAt: row.senderDomainCheckedAt?.toISOString() ?? null,
    senderDomainRecords: readRecords(row.senderDomainRecords),
    senderDomainError: row.senderDomainError,
  };
}
