import {
  BadRequestException,
  ConflictException,
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
import {
  newProofToken,
  proofValue,
  PROOF_HOST_LABEL,
  ProofResult,
  SenderDomainProofChecker,
} from './sender-domain-proof';

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
  senderDomainProofToken: true,
  senderDomainProofAt: true,
  senderDomainRevision: true,
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
    private readonly proofs: SenderDomainProofChecker,
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
    // A domain another coop holds stays with that coop until it clears it.
    await this.assertDomainFree(coopId, domain);

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

    // Proof is bound to this coop and this domain. Only the coop that already
    // holds the same domain keeps its token and proof. Every other path starts
    // fresh: a pre-existing Brevo domain, or one another coop cleared, is
    // never inherited, whatever Brevo reports.
    const sameDomain = coop.senderDomain === domain;
    const token =
      sameDomain && coop.senderDomainProofToken ? coop.senderDomainProofToken : newProofToken();
    const proofAt = sameDomain && coop.senderDomainProofToken ? coop.senderDomainProofAt : null;
    const decision = evaluate({
      proofAt,
      proof: 'keep',
      snapshot,
      previousStatus: sameDomain ? coop.senderDomainStatus : null,
      manual: false,
    });
    // The write applies only if the coop row is the revision this request
    // started from. Any clear, register or check that landed during the
    // provider calls wins, and this stale save is refused.
    const updated = await this.guardedUpdate(coop, {
      senderDomain: domain,
      senderFromAddress: fromAddress,
      senderFromName: fromName,
      senderDomainStatus: decision.status === 'verified' ? 'verified' : 'pending',
      senderDomainCheckedAt: new Date(),
      senderDomainRecords: buildRecords(
        snapshot?.records ?? [],
        token,
        proofAt,
      ) as unknown as Prisma.InputJsonValue,
      senderDomainError: null,
      senderDomainProofToken: token,
      senderDomainProofAt: proofAt,
    });
    if (!updated) throw new ConflictException('SENDER_DOMAIN_CHANGED');
    await this.auditChange(coop, updated, actor);
    return toView(updated);
  }

  async check(coopId: string, actor?: SenderDomainActor): Promise<SenderDomainView> {
    const coop = await this.requireCoop(coopId);
    if (!coop.senderDomain) throw new BadRequestException('SENDER_DOMAIN_NOT_SET');
    const domain = normalizeDomain(coop.senderDomain);
    if (!domain) throw new BadRequestException('SENDER_DOMAIN_INVALID');
    const apiKey = this.requireApiKey();
    return this.refresh(coop, domain, apiKey, true, actor);
  }

  async clear(coopId: string, actor?: SenderDomainActor): Promise<SenderDomainView> {
    const coop = await this.requireCoop(coopId);
    // Clear always wins and always bumps the revision, even on an empty
    // config, so a slower register or check that started earlier cannot
    // write back. It drops the token and the proof: the next claimant of this
    // domain, including this coop, must publish a fresh token.
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
        senderDomainProofToken: null,
        senderDomainProofAt: null,
        senderDomainRevision: { increment: 1 },
      },
      select: SELECT,
    });
    await this.auditChange(coop, updated, actor);
    return toView(updated);
  }

  /**
   * Daily read of domains already stored. Does not call authenticate.
   * A verified domain is demoted when Brevo says it is no longer verified or
   * authenticated, or when the DNS proof is gone. Transport errors leave the
   * status.
   */
  async recheckAll(): Promise<void> {
    const coops = await this.prisma.coop.findMany({
      where: { senderDomain: { not: null } },
      select: { id: true },
    });
    if (coops.length === 0) return;
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
    // The DNS proof does not need the Brevo key, so it is checked either way.
    await this.refresh(coop, domain, readApiKey(), false, undefined);
  }

  /**
   * One read of the provider and of the DNS proof, saved against the revision
   * that was observed. Used by the manual check and the nightly recheck.
   */
  private async refresh(
    coop: SenderRow,
    domain: string,
    apiKey: string | null,
    manual: boolean,
    actor: SenderDomainActor | undefined,
  ): Promise<SenderDomainView> {
    const proof = await this.proofs.check(domain, coop.senderDomainProofToken);
    let snapshot: BrevoDomainSnapshot | null = null;
    let missing = false;
    let providerError = false;

    if (!apiKey) {
      providerError = true;
      if (!manual) this.logger.warn('BREVO_API_KEY is not set; sender-domain recheck is DNS-only');
    } else {
      try {
        if (manual) {
          const auth = await authenticateBrevoDomain(apiKey, domain);
          missing = auth.missing;
        }
        if (!missing) snapshot = await getBrevoDomain(apiKey, domain);
      } catch (error) {
        this.reportProviderError(domain, error);
        if (error instanceof BrevoDomainRequestError && error.status === 404) missing = true;
        else providerError = true;
      }
    }

    const token = coop.senderDomainProofToken ?? newProofToken();
    const decision = evaluate({
      proofAt: coop.senderDomainProofAt,
      proof,
      snapshot,
      previousStatus: coop.senderDomainStatus,
      manual,
      missing,
      providerError,
    });
    const brevoRecords = snapshot ? snapshot.records : readRecords(coop.senderDomainRecords);
    return this.saveOutcome(coop, actor, {
      status: decision.status,
      error: decision.error,
      proofAt: decision.proofAt,
      token,
      records: buildRecords(brevoRecords, token, decision.proofAt),
    });
  }

  /**
   * Stores the result of a provider read. The write applies only while the
   * coop row is still at the revision this result was read from, so a slow
   * check cannot verify a replacement domain, revive a cleared one, or land
   * after an old.be -> new.be -> old.be round trip. When it does not apply,
   * the current row is returned unchanged.
   */
  private async saveOutcome(
    coop: SenderRow,
    actor: SenderDomainActor | undefined,
    outcome: {
      status: string | null;
      error: string | null;
      proofAt: Date | null;
      token: string;
      records: SenderDnsRecord[];
    },
  ): Promise<SenderDomainView> {
    const updated = await this.guardedUpdate(coop, {
      senderDomainStatus: outcome.status,
      senderDomainError: outcome.error,
      senderDomainCheckedAt: new Date(),
      senderDomainRecords: outcome.records as unknown as Prisma.InputJsonValue,
      senderDomainProofToken: outcome.token,
      senderDomainProofAt: outcome.proofAt,
    });
    if (!updated) {
      this.logger.warn(`Ignored stale sender domain result for coop ${coop.id}`);
      return toView(await this.requireCoop(coop.id));
    }
    await this.auditChange(coop, updated, actor);
    return toView(updated);
  }

  /**
   * Update the coop only if its revision still equals the one in `before`,
   * and bump the revision. Domain equality is not enough: a domain can go
   * old -> new -> old, or null -> cleared null, with the same value.
   * No transaction wraps the provider calls; this single statement is the guard.
   */
  private async guardedUpdate(
    before: SenderRow,
    data: Prisma.CoopUpdateManyMutationInput,
  ): Promise<SenderRow | null> {
    try {
      const result = await this.prisma.coop.updateMany({
        where: { id: before.id, senderDomainRevision: before.senderDomainRevision ?? 0 },
        data: { ...data, senderDomainRevision: { increment: 1 } },
      });
      if (result.count === 0) return null;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('SENDER_DOMAIN_CLAIMED');
      }
      throw error;
    }
    return this.prisma.coop.findUnique({ where: { id: before.id }, select: SELECT });
  }

  private async assertDomainFree(coopId: string, domain: string): Promise<void> {
    const holder = await this.prisma.coop.findFirst({
      where: { senderDomain: domain, id: { not: coopId } },
      select: { id: true },
    });
    if (holder) throw new ConflictException('SENDER_DOMAIN_CLAIMED');
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

interface EvaluateInput {
  proofAt: Date | string | null | undefined;
  /** ok / absent come from a fresh DNS read; error and keep leave the proof as stored. */
  proof: ProofResult | 'keep';
  snapshot: BrevoDomainSnapshot | null;
  previousStatus: string | null;
  /** Manual check: not-ready becomes failed. Otherwise only a verified row is demoted. */
  manual: boolean;
  missing?: boolean;
  providerError?: boolean;
}

/**
 * Decides status from BOTH sources: the shared Brevo flags and this coop's own
 * DNS proof. "verified" needs both. A DNS outage keeps the stored proof; a DNS
 * answer without the token removes it.
 */
export function evaluate(input: EvaluateInput): {
  status: string | null;
  error: string | null;
  proofAt: Date | null;
} {
  const stored = input.proofAt ? new Date(input.proofAt) : null;
  const proofAt = input.proof === 'ok' ? new Date() : input.proof === 'absent' ? null : stored;
  const proven = proofAt !== null;
  const proofError = input.proof === 'error' ? 'PROOF_DNS_ERROR' : 'PROOF_MISSING';
  const demoted = input.previousStatus === 'verified' ? 'failed' : input.previousStatus;

  if (input.missing) return { status: 'failed', error: 'DOMAIN_MISSING', proofAt };

  if (input.snapshot) {
    if (input.snapshot.verified && input.snapshot.authenticated && proven) {
      return { status: 'verified', error: null, proofAt };
    }
    const error = proven ? 'DNS_NOT_READY' : proofError;
    const status = input.manual ? 'failed' : (demoted ?? 'pending');
    return { status, error, proofAt };
  }

  // Provider unknown (outage or no API key). Never promote; demote only on lost proof.
  if (!proven) return { status: demoted, error: proofError, proofAt };
  return { status: input.previousStatus, error: 'PROVIDER_ERROR', proofAt };
}

function buildRecords(
  brevo: SenderDnsRecord[],
  token: string,
  proofAt: Date | string | null | undefined,
): SenderDnsRecord[] {
  return [
    {
      key: 'proof',
      type: 'TXT',
      host: PROOF_HOST_LABEL,
      value: proofValue(token),
      status: proofAt ? true : null,
    },
    ...brevo.filter((record) => record.key !== 'proof'),
  ];
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
    (record.key === 'proof' ||
      record.key === 'brevo-code' ||
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
