import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ChargeCard, ChargeCardStatus, Prisma, ShareholderStatus } from '@opencoop/database';
import { computeTotalPaid } from '@opencoop/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { resolveShareholderEmail } from '../shareholders/shareholder-email.resolver';
import { CAN_REPORT_LOST, cancelCard, lockCard, transitionCard } from './charge-card-transition';
import { ChargeCardView, shareholderDisplayName, toChargeCardView } from './charge-card-view';
import { isOverdue, workingDaysBetween } from './working-days';

export interface AdminChargeCardRow extends ChargeCardView {
  shareholderId: string;
  shareholderName: string;
  shareholderStatus: ShareholderStatus;
  totalPaid: number;
  /** Working days since the request (REQUESTED) or the payment (PAID); null otherwise. */
  waitingWorkingDays: number | null;
  overdue: boolean;
}

@Injectable()
export class ChargeCardsAdminService {
  private readonly logger = new Logger(ChargeCardsAdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {}

  async list(
    coopId: string,
    filter: { status?: ChargeCardStatus; todo?: boolean },
    now: Date = new Date(),
  ): Promise<AdminChargeCardRow[]> {
    const cards = await this.prisma.chargeCard.findMany({
      where: {
        coopId,
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.todo ? { providerSyncNeeded: true } : {}),
      },
      include: {
        shareholder: { select: { firstName: true, lastName: true, companyName: true, status: true } },
        payments: { select: { amount: true } },
      },
      orderBy: { requestedAt: 'asc' },
    });

    return cards.map((card) => {
      const waitingSince =
        card.status === 'REQUESTED' ? card.requestedAt : card.status === 'PAID' ? (card.paidAt ?? card.requestedAt) : null;
      return {
        ...toChargeCardView(card),
        shareholderId: card.shareholderId,
        shareholderName: shareholderDisplayName(card.shareholder),
        shareholderStatus: card.shareholder.status,
        totalPaid: computeTotalPaid(card.payments),
        waitingWorkingDays: waitingSince ? workingDaysBetween(waitingSince, now) : null,
        overdue: waitingSince !== null && isOverdue(waitingSince, now),
      };
    });
  }

  async issue(coopId: string, cardId: string, rawCardNumber: string): Promise<ChargeCardView> {
    const cardNumber = rawCardNumber.trim();
    if (!cardNumber) {
      throw new BadRequestException('Card number is required');
    }
    const card = await this.prisma.chargeCard.findFirst({
      where: { id: cardId, coopId },
      include: {
        shareholder: {
          select: {
            status: true,
            firstName: true,
            lastName: true,
            companyName: true,
            email: true,
            user: { select: { email: true } },
          },
        },
      },
    });
    if (!card) {
      throw new NotFoundException('Charge card not found');
    }
    if (card.status !== 'PAID') {
      throw new BadRequestException('Only a paid card can be issued');
    }
    if (card.shareholder.status !== 'ACTIVE') {
      throw new BadRequestException('The shareholder is no longer active; cancel the card instead');
    }

    const now = new Date();
    let issued: ChargeCard;
    try {
      issued = await this.guardedTransition(
        coopId,
        cardId,
        // Re-checked atomically, under the lock, on top of the clearer
        // pre-check above: a shareholder deactivated between the read and
        // the write must not get an issued card either.
        { status: 'PAID', shareholder: { status: 'ACTIVE' } },
        { status: 'ACTIVE', cardNumber, issuedAt: now, activatedAt: now, providerSyncNeeded: false },
        'Only a paid card can be issued',
      );
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('This card number is already used in this cooperative');
      }
      throw err;
    }

    const to = resolveShareholderEmail(card.shareholder);
    if (to) {
      const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3002';
      try {
        await this.email.sendChargeCardIssued(coopId, to, {
          shareholderName: shareholderDisplayName(card.shareholder),
          label: issued.label,
          cardNumber,
          dashboardUrl: `${baseUrl}/dashboard/charge-cards`,
        });
      } catch (err) {
        this.logger.error(`Failed to queue charge-card issued email: ${(err as Error).message}`);
      }
    }
    return toChargeCardView(issued);
  }

  async block(coopId: string, cardId: string): Promise<ChargeCardView> {
    return toChargeCardView(
      await this.guardedTransition(
        coopId,
        cardId,
        { status: 'ACTIVE' },
        { status: 'BLOCKED', blockReason: 'ADMIN', blockedAt: new Date(), providerSyncNeeded: true },
        'Only an active card can be blocked',
      ),
    );
  }

  /** Lifts an ADMIN block. NO_SHARES lifts itself (sync job); LOST never lifts. */
  async unblock(coopId: string, cardId: string): Promise<ChargeCardView> {
    return toChargeCardView(
      await this.guardedTransition(
        coopId,
        cardId,
        { status: 'BLOCKED', blockReason: 'ADMIN', shareholder: { status: 'ACTIVE' } },
        { status: 'ACTIVE', blockReason: null, blockedAt: null, activatedAt: new Date(), providerSyncNeeded: true },
        'Only a card blocked by an admin, of an active shareholder, can be unblocked',
      ),
    );
  }

  async markLost(coopId: string, cardId: string): Promise<ChargeCardView> {
    return toChargeCardView(
      await this.guardedTransition(
        coopId,
        cardId,
        CAN_REPORT_LOST,
        { status: 'BLOCKED', blockReason: 'LOST', blockedAt: new Date(), providerSyncNeeded: true },
        'Only an active or blocked card can be marked lost',
      ),
    );
  }

  async markProviderSyncDone(coopId: string, cardId: string): Promise<ChargeCardView> {
    return toChargeCardView(
      await this.guardedTransition(
        coopId,
        cardId,
        { providerSyncNeeded: true },
        { providerSyncNeeded: false },
        'This card has no pending provider change',
      ),
    );
  }

  /**
   * A PAID card can be cancelled too (shareholder left); the refund happens
   * outside OpenCoop, unlike the shareholder's own cancel, which refuses a
   * card that already holds a payment. Goes through the shared `cancelCard`,
   * which clears `replacesCardId` so the LOST card this one replaced, if
   * any, can be replaced again — the same rule the shareholder's own cancel
   * follows, not a second copy of it.
   */
  async cancel(coopId: string, cardId: string): Promise<ChargeCardView> {
    return toChargeCardView(
      await this.withLockedCard(coopId, cardId, (tx) =>
        cancelCard(tx, { id: cardId, coopId }, ['REQUESTED', 'PAID'], 'Only a requested or paid card can be cancelled'),
      ),
    );
  }

  /**
   * Locks the card row (FOR UPDATE), the same way the shareholder's cancel()
   * and recordChargeCardPayment do, then runs `fn` inside that lock. Every
   * admin mutation goes through this, so each is safe against a concurrent
   * payment, sync job or shareholder action on the same card.
   */
  private async withLockedCard<T>(
    coopId: string,
    cardId: string,
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      const locked = await lockCard(tx, { id: cardId, coopId });
      if (!locked) {
        throw new NotFoundException('Charge card not found');
      }
      return fn(tx);
    });
  }

  private async guardedTransition(
    coopId: string,
    cardId: string,
    allowed: Prisma.ChargeCardWhereInput,
    data: Prisma.ChargeCardUncheckedUpdateManyInput,
    refusal: string,
  ): Promise<ChargeCard> {
    return this.withLockedCard(coopId, cardId, (tx) => transitionCard(tx, { id: cardId, coopId }, allowed, data, refusal));
  }
}
