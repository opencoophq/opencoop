import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { Prisma, ShareholderStatus, ShareTransfer, TransferReason } from '@opencoop/database';
import { computeTotalPaid, computeVestedShares } from '@opencoop/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { deriveShareholderStatus } from '../shareholder-status/shareholder-status';
import { ShareholderStatusService } from '../shareholder-status/shareholder-status.service';
import { RegistrationsService } from './registrations.service';

export interface TransferSharesInput {
  coopId: string;
  fromShareholderId: string;
  toShareholderId: string;
  shareClassId: string;
  quantity: number;
  /** ISO date (YYYY-MM-DD) or ISO date-time. */
  transferDate: Date | string;
  reason: TransferReason;
  note?: string;
  markFromAsDeceased?: boolean;
  /** ISO date (YYYY-MM-DD). Only with reason INHERITANCE. */
  dateOfDeath?: string;
  idempotencyKey?: string;
  processedByUserId?: string;
}

export interface Holdings {
  sharesInClass: number;
  valueInClassEur: number;
  totalShares: number;
  totalValueEur: number;
}

export interface TransferPartyPreview {
  id: string;
  name: string;
  deceasedAt: Date | null;
  before: Holdings;
  after: Holdings | null;
  statusBefore: ShareholderStatus;
  statusAfter: ShareholderStatus | null;
}

export interface TransferAllocation {
  registrationId: string;
  quantity: number;
  pricePerShare: number;
}

export interface ShareTransferPreview {
  valid: boolean;
  errors: string[];
  shareClass: { id: string; name: string; code: string; pricePerShare: number } | null;
  quantity: number;
  transferDate: string | null;
  reason: TransferReason;
  /** Value of the moved shares at the consumed buys' prices; null when the shares are not all available. */
  valueEur: number | null;
  from: TransferPartyPreview | null;
  to: TransferPartyPreview | null;
  fromWillBeMarkedDeceased: boolean;
  allocations: TransferAllocation[];
}

export interface TransferSharesResult {
  transfer: ShareTransfer;
  registrations: string[];
  valueEur: number;
  idempotentReplay: boolean;
  from: { statusAfter: ShareholderStatus | null; deceasedAt: Date | null };
  to: { statusAfter: ShareholderStatus | null };
}

type Db = Prisma.TransactionClient;

type ValidationError = { notFound: boolean; message: string };

const BRUSSELS_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Brussels',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Calendar day (YYYY-MM-DD) of an instant in Europe/Brussels. */
function brusselsDay(date: Date): string {
  return BRUSSELS_DAY.format(date);
}

/** Parse an ISO date or date-time. Returns the instant and its Brussels calendar day, or null. */
function parseDay(value: Date | string | undefined | null): { date: Date; day: string } | null {
  if (value === undefined || value === null || value === '') return null;
  if (value instanceof Date) {
    return isNaN(value.getTime()) ? null : { date: value, day: brusselsDay(value) };
  }
  if (typeof value !== 'string') return null;
  if (DATE_ONLY.test(value)) {
    const date = new Date(`${value}T00:00:00.000Z`);
    // Reject roll-overs such as 2026-02-31.
    if (isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return null;
    return { date, day: value };
  }
  const date = new Date(value);
  return isNaN(date.getTime()) ? null : { date, day: brusselsDay(date) };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

const PARTY_SELECT = {
  id: true,
  coopId: true,
  type: true,
  firstName: true,
  lastName: true,
  companyName: true,
  status: true,
  deceasedAt: true,
  registrations: {
    select: {
      id: true,
      type: true,
      status: true,
      quantity: true,
      pricePerShare: true,
      shareClassId: true,
      registerDate: true,
      payments: { select: { amount: true } },
    },
  },
} satisfies Prisma.ShareholderSelect;

type Party = Prisma.ShareholderGetPayload<{ select: typeof PARTY_SELECT }>;

interface Plan {
  errors: ValidationError[];
  preview: ShareTransferPreview;
  transferDate: { date: Date; day: string } | null;
  deathDate: { date: Date; day: string } | null;
  from: Party | null;
  to: Party | null;
  /** Project and price of each consumed source buy, copied onto the new rows. */
  sourceBuys: Map<string, { projectId: string | null; pricePerShare: Prisma.Decimal }>;
}

/**
 * Transfers shares of one class between two existing shareholders of one coop,
 * for example an inheritance (erfopvolging). It writes the same register rows as
 * RegistrationsService.createTransfer (a COMPLETED SELL plus a COMPLETED BUY, each with
 * a synthetic payment), once per consumed source buy, and links them to one ShareTransfer.
 */
@Injectable()
export class ShareTransferService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registrations: RegistrationsService,
    private readonly shareholderStatus: ShareholderStatusService,
    private readonly audit: AuditService,
  ) {}

  /** Validate and describe a transfer. Writes nothing. */
  async previewTransfer(input: TransferSharesInput): Promise<ShareTransferPreview> {
    const plan = await this.plan(input, this.prisma);
    return plan.preview;
  }

  async transferShares(input: TransferSharesInput): Promise<TransferSharesResult> {
    const transferDay = parseDay(input.transferDate);
    const key = this.idempotencyKey(input, transferDay?.day ?? String(input.transferDate));

    const existing = await this.prisma.shareTransfer.findUnique({
      where: { coopId_idempotencyKey: { coopId: input.coopId, idempotencyKey: key } },
    });
    if (existing) return this.replay(existing, input, transferDay?.day ?? null);

    let outcome:
      | { kind: 'replay'; transfer: ShareTransfer }
      | {
          kind: 'created';
          transfer: ShareTransfer;
          registrationIds: string[];
          valueEur: number;
          deceasedAt: Date | null;
        };
    try {
      outcome = await this.prisma.$transaction(
        async (tx) => {
          // Lock both parties in a fixed order: concurrent transfers cannot oversell the
          // source, and two opposite transfers cannot deadlock on each other's rows.
          const lockIds = [...new Set([input.fromShareholderId, input.toShareholderId])].sort();
          await tx.$queryRaw(
            Prisma.sql`SELECT id FROM shareholders WHERE id IN (${Prisma.join(lockIds)}) AND "coopId" = ${input.coopId} ORDER BY id FOR UPDATE`,
          );

          const raced = await tx.shareTransfer.findUnique({
            where: { coopId_idempotencyKey: { coopId: input.coopId, idempotencyKey: key } },
          });
          if (raced) return { kind: 'replay' as const, transfer: raced };

          const plan = await this.plan(input, tx);
          if (plan.errors.length > 0) throw this.validationException(plan.errors);

          return this.write(tx, input, key, plan);
        },
        { timeout: 30_000 },
      );
    } catch (err) {
      if (this.isIdempotencyCollision(err)) {
        const winner = await this.prisma.shareTransfer.findUnique({
          where: { coopId_idempotencyKey: { coopId: input.coopId, idempotencyKey: key } },
        });
        if (winner) return this.replay(winner, input, transferDay?.day ?? null);
      }
      throw err;
    }

    if (outcome.kind === 'replay') {
      return this.replay(outcome.transfer, input, transferDay?.day ?? null);
    }

    await this.shareholderStatus.recomputeMany([input.fromShareholderId, input.toShareholderId]);
    const statuses = await this.statuses(input.fromShareholderId, input.toShareholderId);

    return {
      transfer: outcome.transfer,
      registrations: outcome.registrationIds,
      valueEur: outcome.valueEur,
      idempotentReplay: false,
      from: { statusAfter: statuses.from?.status ?? null, deceasedAt: outcome.deceasedAt },
      to: { statusAfter: statuses.to?.status ?? null },
    };
  }

  private async write(tx: Db, input: TransferSharesInput, key: string, plan: Plan) {
    const preview = plan.preview;
    const transferDate = plan.transferDate!.date;
    const from = plan.from!;
    const valueEur = preview.valueEur!;
    const now = new Date();

    let transfer = await tx.shareTransfer.create({
      data: {
        coopId: input.coopId,
        fromShareholderId: input.fromShareholderId,
        toShareholderId: input.toShareholderId,
        shareClassId: input.shareClassId,
        quantity: input.quantity,
        totalAmount: valueEur,
        transferDate,
        reason: input.reason,
        note: input.note ?? null,
        idempotencyKey: key,
        processedByUserId: input.processedByUserId ?? null,
      },
    });

    const registrationIds: string[] = [];
    for (const allocation of preview.allocations) {
      const source = plan.sourceBuys.get(allocation.registrationId)!;
      const pricePerShare = Number(source.pricePerShare);
      const totalAmount = round2(allocation.quantity * pricePerShare);

      // SELL registration for the from-shareholder (mirrors createTransfer)
      const sellReg = await tx.registration.create({
        data: {
          coopId: input.coopId,
          shareholderId: input.fromShareholderId,
          shareClassId: input.shareClassId,
          projectId: source.projectId,
          type: 'SELL',
          status: 'COMPLETED',
          quantity: allocation.quantity,
          pricePerShare,
          totalAmount,
          registerDate: transferDate,
          sellsRegistrationId: allocation.registrationId,
          toShareholderId: input.toShareholderId,
          processedByUserId: input.processedByUserId,
          // Effective date, not wall-clock time: dividends subtract a SELL by
          // processedAt and count the BUY by payment bankDate. Both must use the
          // transfer date, or a backdated transfer pays the dividend twice.
          // ShareTransfer.createdAt keeps the real processing time.
          processedAt: transferDate,
          shareTransferId: transfer.id,
        },
      });

      // Synthetic payment for SELL (so capital calc cancels out)
      await tx.payment.create({
        data: {
          registrationId: sellReg.id,
          coopId: input.coopId,
          amount: totalAmount,
          bankDate: transferDate,
          matchedByUserId: input.processedByUserId,
          matchedAt: now,
        },
      });

      // BUY registration for the to-shareholder
      const buyReg = await tx.registration.create({
        data: {
          coopId: input.coopId,
          shareholderId: input.toShareholderId,
          shareClassId: input.shareClassId,
          projectId: source.projectId,
          type: 'BUY',
          status: 'COMPLETED',
          quantity: allocation.quantity,
          pricePerShare,
          totalAmount,
          registerDate: transferDate,
          fromShareholderId: input.fromShareholderId,
          processedByUserId: input.processedByUserId,
          // Effective date, not wall-clock time: dividends subtract a SELL by
          // processedAt and count the BUY by payment bankDate. Both must use the
          // transfer date, or a backdated transfer pays the dividend twice.
          // ShareTransfer.createdAt keeps the real processing time.
          processedAt: transferDate,
          shareTransferId: transfer.id,
        },
      });

      // Synthetic payment for BUY (for ownership derivation)
      await tx.payment.create({
        data: {
          registrationId: buyReg.id,
          coopId: input.coopId,
          amount: totalAmount,
          bankDate: transferDate,
          matchedByUserId: input.processedByUserId,
          matchedAt: now,
        },
      });

      registrationIds.push(sellReg.id, buyReg.id);
    }

    let deceasedAt = from.deceasedAt;
    if (preview.fromWillBeMarkedDeceased) {
      deceasedAt = plan.deathDate?.date ?? transferDate;
      await tx.shareholder.update({
        where: { id: from.id },
        data: { deceasedAt },
      });
      transfer = await tx.shareTransfer.update({
        where: { id: transfer.id },
        data: { markedFromAsDeceased: true },
      });
    }

    await this.audit.log(
      {
        coopId: input.coopId,
        entity: 'ShareTransfer',
        entityId: transfer.id,
        action: 'CREATE',
        actorId: input.processedByUserId,
        changes: [
          { field: 'fromShareholderId', oldValue: null, newValue: input.fromShareholderId },
          { field: 'toShareholderId', oldValue: null, newValue: input.toShareholderId },
          { field: 'shareClassId', oldValue: null, newValue: input.shareClassId },
          { field: 'quantity', oldValue: null, newValue: input.quantity },
          { field: 'totalAmount', oldValue: null, newValue: valueEur },
          { field: 'transferDate', oldValue: null, newValue: plan.transferDate!.day },
          { field: 'reason', oldValue: null, newValue: input.reason },
          { field: 'note', oldValue: null, newValue: input.note ?? null },
        ],
      },
      tx,
    );

    if (preview.fromWillBeMarkedDeceased) {
      await this.audit.log(
        {
          coopId: input.coopId,
          entity: 'Shareholder',
          entityId: from.id,
          action: 'UPDATE',
          actorId: input.processedByUserId,
          changes: [{ field: 'deceasedAt', oldValue: null, newValue: brusselsDay(deceasedAt!) }],
        },
        tx,
      );
    }

    return {
      kind: 'created' as const,
      transfer,
      registrationIds,
      valueEur,
      deceasedAt,
    };
  }

  /** Validation, FIFO allocation, and before/after figures. Reads only. */
  private async plan(input: TransferSharesInput, db: Db): Promise<Plan> {
    const errors: ValidationError[] = [];
    const bad = (message: string) => errors.push({ notFound: false, message });
    const missing = (message: string) => errors.push({ notFound: true, message });
    const today = brusselsDay(new Date());

    const quantityValid = Number.isInteger(input.quantity) && input.quantity > 0;
    if (!quantityValid) bad('quantity must be a whole number greater than 0');

    const sameParty = input.fromShareholderId === input.toShareholderId;
    if (sameParty) bad('The source and the recipient must be different shareholders');

    const transferDate = parseDay(input.transferDate);
    if (!transferDate) {
      bad('transferDate is not a valid date');
    } else if (transferDate.day > today) {
      bad('transferDate cannot be in the future');
    }

    const isInheritance = input.reason === TransferReason.INHERITANCE;
    if (input.markFromAsDeceased && !isInheritance) {
      bad('markFromAsDeceased is only allowed with reason INHERITANCE');
    }
    let deathDate: { date: Date; day: string } | null = null;
    if (input.dateOfDeath !== undefined && input.dateOfDeath !== null) {
      if (!isInheritance) {
        bad('dateOfDeath is only allowed with reason INHERITANCE');
      }
      deathDate = parseDay(input.dateOfDeath);
      if (!deathDate) {
        bad('dateOfDeath is not a valid date');
      } else {
        if (deathDate.day > today) bad('dateOfDeath cannot be in the future');
        if (transferDate && deathDate.day > transferDate.day) {
          bad('dateOfDeath cannot be after transferDate');
        }
      }
    }

    const [from, to, shareClass] = await Promise.all([
      db.shareholder.findFirst({
        where: { id: input.fromShareholderId, coopId: input.coopId },
        select: PARTY_SELECT,
      }),
      sameParty
        ? Promise.resolve(null)
        : db.shareholder.findFirst({
            where: { id: input.toShareholderId, coopId: input.coopId },
            select: PARTY_SELECT,
          }),
      db.shareClass.findFirst({
        where: { id: input.shareClassId, coopId: input.coopId },
        select: { id: true, name: true, code: true, pricePerShare: true },
      }),
    ]);
    const toParty = sameParty ? from : to;

    if (!from) missing('Source shareholder not found');
    if (!toParty) missing('Recipient shareholder not found');
    if (!shareClass) missing('Share class not found');
    if (toParty && !sameParty && toParty.deceasedAt) {
      bad('The recipient is recorded as deceased');
    }

    // FIFO allocation over the source's buys of this class, dated on or before the transfer day.
    const allocations: TransferAllocation[] = [];
    const sourceBuys: Plan['sourceBuys'] = new Map();
    let allocated = 0;
    if (from && shareClass && transferDate && quantityValid) {
      const buys = await db.registration.findMany({
        where: {
          coopId: input.coopId,
          shareholderId: from.id,
          shareClassId: shareClass.id,
          type: 'BUY',
          status: { in: ['ACTIVE', 'COMPLETED'] },
        },
        select: {
          id: true,
          quantity: true,
          pricePerShare: true,
          projectId: true,
          registerDate: true,
          payments: { select: { amount: true } },
        },
        orderBy: [{ registerDate: 'asc' }, { id: 'asc' }],
      });

      let available = 0;
      for (const buy of buys) {
        if (brusselsDay(buy.registerDate) > transferDate.day) continue;
        const price = Number(buy.pricePerShare);
        const free = await this.registrations.getAvailableShares(
          buy.id,
          buy.payments,
          price,
          buy.quantity,
          db,
        );
        if (free <= 0) continue;
        available += free;
        const take = Math.min(free, input.quantity - allocated);
        if (take > 0) {
          allocations.push({ registrationId: buy.id, quantity: take, pricePerShare: price });
          sourceBuys.set(buy.id, { projectId: buy.projectId, pricePerShare: buy.pricePerShare });
          allocated += take;
        }
      }

      if (allocated < input.quantity) {
        bad(
          `Not enough shares: the source holds ${available} available share(s) of this class on ${transferDate.day}, ${input.quantity} requested`,
        );
      }
    }

    const complete = quantityValid && allocated === input.quantity && allocations.length > 0;
    const valueEur = complete
      ? round2(allocations.reduce((sum, a) => sum + a.quantity * a.pricePerShare, 0))
      : null;

    // The EcoPower minimum is about a living client keeping supply, so an inheritance skips it.
    if (from && valueEur !== null && !isInheritance) {
      try {
        await this.registrations.checkEcoPowerThreshold(
          input.coopId,
          from.id,
          input.quantity,
          valueEur / input.quantity,
          db,
        );
      } catch (err) {
        if (!(err instanceof BadRequestException)) throw err;
        bad(err.message);
      }
    }

    const fromPreview =
      from && shareClass
        ? this.partyPreview(from, shareClass.id, complete ? allocations : null, 'out')
        : null;
    const toPreview =
      toParty && shareClass && !sameParty
        ? this.partyPreview(toParty, shareClass.id, complete ? allocations : null, 'in')
        : null;

    const fromWillBeMarkedDeceased =
      isInheritance &&
      !!from &&
      !from.deceasedAt &&
      (!!input.markFromAsDeceased || fromPreview?.after?.totalShares === 0);

    const preview: ShareTransferPreview = {
      valid: errors.length === 0,
      errors: errors.map((e) => e.message),
      shareClass: shareClass
        ? {
            id: shareClass.id,
            name: shareClass.name,
            code: shareClass.code,
            pricePerShare: Number(shareClass.pricePerShare),
          }
        : null,
      quantity: input.quantity,
      transferDate: transferDate?.day ?? null,
      reason: input.reason,
      valueEur,
      from: fromPreview,
      to: toPreview,
      fromWillBeMarkedDeceased,
      allocations,
    };

    return { errors, preview, transferDate, deathDate, from, to: toParty, sourceBuys };
  }

  private partyPreview(
    party: Party,
    shareClassId: string,
    allocations: TransferAllocation[] | null,
    direction: 'in' | 'out',
  ): TransferPartyPreview {
    const before = this.holdings(party.registrations, shareClassId);
    let after: Holdings | null = null;
    let statusAfter: ShareholderStatus | null = null;

    if (allocations) {
      const sign = direction === 'in' ? 1 : -1;
      const movedShares = allocations.reduce((sum, a) => sum + a.quantity, 0);
      const movedValue = round2(
        allocations.reduce((sum, a) => sum + a.quantity * a.pricePerShare, 0),
      );
      after = {
        sharesInClass: before.sharesInClass + sign * movedShares,
        valueInClassEur: round2(before.valueInClassEur + sign * movedValue),
        totalShares: before.totalShares + sign * movedShares,
        totalValueEur: round2(before.totalValueEur + sign * movedValue),
      };
      statusAfter = deriveShareholderStatus([
        ...party.registrations,
        ...allocations.map((a) => ({
          type: direction === 'in' ? 'BUY' : 'SELL',
          status: 'COMPLETED',
          quantity: a.quantity,
        })),
      ]);
    }

    return {
      id: party.id,
      name: this.displayName(party),
      deceasedAt: party.deceasedAt,
      before,
      after,
      statusBefore: party.status,
      statusAfter,
    };
  }

  /** Owned shares: paid (vested) part of active/completed buys, minus completed sells. */
  private holdings(registrations: Party['registrations'], shareClassId: string): Holdings {
    const result: Holdings = {
      sharesInClass: 0,
      valueInClassEur: 0,
      totalShares: 0,
      totalValueEur: 0,
    };
    for (const reg of registrations) {
      const price = Number(reg.pricePerShare);
      let shares = 0;
      if (reg.type === 'BUY' && (reg.status === 'ACTIVE' || reg.status === 'COMPLETED')) {
        shares = computeVestedShares(computeTotalPaid(reg.payments), price, reg.quantity);
      } else if (reg.type === 'SELL' && reg.status === 'COMPLETED') {
        shares = -reg.quantity;
      } else {
        continue;
      }
      result.totalShares += shares;
      result.totalValueEur += shares * price;
      if (reg.shareClassId === shareClassId) {
        result.sharesInClass += shares;
        result.valueInClassEur += shares * price;
      }
    }
    result.valueInClassEur = round2(result.valueInClassEur);
    result.totalValueEur = round2(result.totalValueEur);
    return result;
  }

  private displayName(party: Party): string {
    if (party.type === 'COMPANY') return party.companyName ?? '';
    return [party.firstName, party.lastName].filter(Boolean).join(' ');
  }

  private idempotencyKey(input: TransferSharesInput, day: string): string {
    if (input.idempotencyKey) return input.idempotencyKey;
    const canonical = JSON.stringify({
      from: input.fromShareholderId,
      to: input.toShareholderId,
      shareClassId: input.shareClassId,
      quantity: input.quantity,
      transferDate: day,
      reason: input.reason,
    });
    return createHash('sha256').update(canonical).digest('hex');
  }

  private async replay(
    transfer: ShareTransfer,
    input: TransferSharesInput,
    day: string | null,
  ): Promise<TransferSharesResult> {
    const same =
      transfer.fromShareholderId === input.fromShareholderId &&
      transfer.toShareholderId === input.toShareholderId &&
      transfer.shareClassId === input.shareClassId &&
      transfer.quantity === input.quantity &&
      transfer.reason === input.reason &&
      day !== null &&
      brusselsDay(transfer.transferDate) === day;
    if (!same) {
      throw new ConflictException('Idempotency key already used for a different transfer');
    }

    // The first call may have committed and then failed before its status recompute.
    await this.shareholderStatus.recomputeMany([
      transfer.fromShareholderId,
      transfer.toShareholderId,
    ]);

    const [registrations, statuses] = await Promise.all([
      this.prisma.registration.findMany({
        where: { shareTransferId: transfer.id },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
      }),
      this.statuses(transfer.fromShareholderId, transfer.toShareholderId),
    ]);

    return {
      transfer,
      registrations: registrations.map((r) => r.id),
      valueEur: Number(transfer.totalAmount),
      idempotentReplay: true,
      from: {
        statusAfter: statuses.from?.status ?? null,
        deceasedAt: statuses.from?.deceasedAt ?? null,
      },
      to: { statusAfter: statuses.to?.status ?? null },
    };
  }

  private async statuses(fromId: string, toId: string) {
    const rows = await this.prisma.shareholder.findMany({
      where: { id: { in: [fromId, toId] } },
      select: { id: true, status: true, deceasedAt: true },
    });
    return { from: rows.find((r) => r.id === fromId), to: rows.find((r) => r.id === toId) };
  }

  private validationException(errors: ValidationError[]): HttpException {
    const notFound = errors.filter((e) => e.notFound);
    if (notFound.length > 0) {
      return new NotFoundException(notFound.map((e) => e.message).join('; '));
    }
    return new BadRequestException(errors.map((e) => e.message).join('; '));
  }

  private isIdempotencyCollision(err: unknown): boolean {
    if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') {
      return false;
    }
    const target = (err.meta as { target?: unknown } | undefined)?.target;
    const fields = Array.isArray(target) ? target.map(String) : [String(target ?? '')];
    return fields.some((f) => f.includes('idempotencyKey'));
  }
}
