import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ChargeCard, Prisma } from '@opencoop/database';
import { PrismaService } from '../../prisma/prisma.service';
import { OgmService } from '../ogm/ogm.service';
import { EmailService } from '../email/email.service';
import { canActForShareholder } from '../shareholders/shareholder-access';
import { CAN_REPORT_LOST, cancelCard, lockCard, transitionCard } from './charge-card-transition';
import { ChargeCardView, shareholderDisplayName, toChargeCardView } from './charge-card-view';
import { RequestChargeCardDto } from './dto/request-charge-card.dto';

const CANCEL_REFUSAL = 'Only a requested card can be cancelled';

const OWN_SHAREHOLDER_SELECT = {
  id: true,
  coopId: true,
  userId: true,
  type: true,
  registeredByUserId: true,
  status: true,
  firstName: true,
  lastName: true,
  companyName: true,
  coop: {
    select: {
      id: true,
      name: true,
      slug: true,
      chargeCardsEnabled: true,
      chargeCardFee: true,
      chargeCardReplacementFee: true,
      bankIban: true,
      bankBic: true,
      coopEmail: true,
    },
  },
} satisfies Prisma.ShareholderSelect;

type OwnShareholder = Prisma.ShareholderGetPayload<{ select: typeof OWN_SHAREHOLDER_SELECT }>;

export interface ChargeCardPaymentDetails {
  beneficiaryName: string;
  iban: string | null;
  bic: string | null;
  amount: number;
  ogmCode: string;
}

@Injectable()
export class ChargeCardsService {
  private readonly logger = new Logger(ChargeCardsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ogm: OgmService,
    private readonly email: EmailService,
  ) {}

  async listForShareholder(shareholderId: string, userId: string) {
    const sh = await this.loadOwnShareholder(shareholderId, userId);
    const cards = sh.coop.chargeCardsEnabled
      ? await this.prisma.chargeCard.findMany({
          where: { shareholderId: sh.id },
          include: { replacedBy: { select: { id: true } } },
          orderBy: { requestedAt: 'desc' },
        })
      : [];
    return {
      enabled: sh.coop.chargeCardsEnabled,
      coop: { name: sh.coop.name, slug: sh.coop.slug, bankIban: sh.coop.bankIban, bankBic: sh.coop.bankBic },
      shareholderStatus: sh.status,
      fee: Number(sh.coop.chargeCardFee),
      replacementFee: Number(sh.coop.chargeCardReplacementFee),
      cards: cards.map(toChargeCardView),
    };
  }

  async request(
    shareholderId: string,
    userId: string,
    dto: RequestChargeCardDto,
  ): Promise<{ card: ChargeCardView; payment: ChargeCardPaymentDetails }> {
    const sh = await this.loadOwnShareholder(shareholderId, userId);
    if (!sh.coop.chargeCardsEnabled) {
      throw new ForbiddenException('Charge cards are not enabled for this cooperative');
    }
    if (sh.status !== 'ACTIVE') {
      throw new BadRequestException('Only active shareholders can request a charge card');
    }

    // The server decides whether this request replaces a lost card, not the
    // client: if the shareholder has a LOST card that no live card already
    // replaces, this request automatically becomes its replacement — the
    // oldest one first, if there happen to be several.
    const lost = await this.prisma.chargeCard.findFirst({
      where: { shareholderId: sh.id, status: 'BLOCKED', blockReason: 'LOST', replacedBy: null },
      orderBy: { blockedAt: 'asc' },
    });
    const feeInclVat = lost ? sh.coop.chargeCardReplacementFee : sh.coop.chargeCardFee;
    const replacesCardId = lost?.id ?? null;

    let card: ChargeCard;
    try {
      card = await this.prisma.$transaction(async (tx) => {
        const ogmCode = await this.ogm.nextOgmCode(tx, sh.coopId);
        return tx.chargeCard.create({
          data: {
            coopId: sh.coopId,
            shareholderId: sh.id,
            label: dto.label?.trim() || null,
            ogmCode,
            feeInclVat,
            isReplacement: replacesCardId !== null,
            replacesCardId,
          },
        });
      });
    } catch (err) {
      // Two concurrent replacement requests for the same lost card: the unique
      // index on replacesCardId lets exactly one through.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002' &&
        String(err.meta?.target).includes('replacesCardId')
      ) {
        throw new ConflictException('This card has already been replaced');
      }
      throw err;
    }

    await this.notifyCoop(sh, 'requested', card);
    return {
      card: toChargeCardView(card),
      payment: {
        beneficiaryName: sh.coop.name,
        iban: sh.coop.bankIban,
        bic: sh.coop.bankBic,
        amount: Number(card.feeInclVat),
        ogmCode: card.ogmCode,
      },
    };
  }

  async cancel(shareholderId: string, userId: string, cardId: string): Promise<ChargeCardView> {
    const sh = await this.loadOwnShareholder(shareholderId, userId);
    const card = await this.prisma.$transaction(async (tx) => {
      // Lock the card row, as recordChargeCardPayment does, so a payment and a
      // cancel on this card run one after the other and cannot both win.
      const locked = await lockCard(tx, { id: cardId, shareholderId: sh.id });
      if (!locked) {
        throw new NotFoundException('Charge card not found');
      }
      if (locked.status !== 'REQUESTED') {
        throw new BadRequestException(CANCEL_REFUSAL);
      }
      // A requested card that money already reached: only the coop can unwind that (refund).
      if ((await tx.payment.count({ where: { chargeCardId: cardId } })) > 0) {
        throw new ConflictException('card has a payment; contact the coop');
      }
      // cancelCard clears replacesCardId, so the LOST card this one was
      // requested for can be replaced again; isReplacement stays true, as a
      // record of why this (now cancelled) card existed.
      return cancelCard(tx, { id: cardId, shareholderId: sh.id }, ['REQUESTED'], CANCEL_REFUSAL);
    });
    return toChargeCardView(card);
  }

  async reportLost(shareholderId: string, userId: string, cardId: string): Promise<ChargeCardView> {
    const sh = await this.loadOwnShareholder(shareholderId, userId);
    const card = await transitionCard(
      this.prisma,
      { id: cardId, shareholderId: sh.id },
      CAN_REPORT_LOST,
      { status: 'BLOCKED', blockReason: 'LOST', blockedAt: new Date(), providerSyncNeeded: true },
      'Only an active or blocked card can be reported lost',
    );
    return toChargeCardView(card);
  }

  /**
   * v1 manual flow: the provider expires unused cards on its own. The
   * shareholder tells us the card stopped working; the admin re-enables it in
   * the provider portal. Idempotent: a second click does not email again.
   */
  async requestReenable(shareholderId: string, userId: string, cardId: string): Promise<ChargeCardView> {
    const sh = await this.loadOwnShareholder(shareholderId, userId);
    if (!sh.coop.chargeCardsEnabled) {
      throw new ForbiddenException('Charge cards are not enabled for this cooperative');
    }
    const existing = await this.prisma.chargeCard.findFirst({ where: { id: cardId, shareholderId: sh.id } });
    if (!existing) {
      throw new NotFoundException('Charge card not found');
    }
    if (existing.status !== 'ACTIVE') {
      throw new BadRequestException('Only an active card can be re-enabled');
    }
    if (sh.status !== 'ACTIVE') {
      throw new BadRequestException('Only active shareholders can re-enable a card');
    }
    if (existing.providerSyncNeeded) {
      return toChargeCardView(existing);
    }

    // Guarded transition: the update only takes effect if the card is still
    // ACTIVE and not already flagged. Two quick clicks, or a click racing an
    // admin block, can only ever have one of them actually flip the flag —
    // the loser sees count 0 and quietly returns the current row instead of
    // emailing a second time or overwriting a concurrent admin action.
    const result = await this.prisma.chargeCard.updateMany({
      where: { id: existing.id, status: 'ACTIVE', providerSyncNeeded: false },
      data: { providerSyncNeeded: true, activatedAt: new Date() },
    });
    const updated = await this.prisma.chargeCard.findUniqueOrThrow({ where: { id: existing.id } });
    if (result.count === 0) {
      return toChargeCardView(updated);
    }

    await this.notifyCoop(sh, 'reenable', updated);
    return toChargeCardView(updated);
  }

  private async loadOwnShareholder(shareholderId: string, userId: string): Promise<OwnShareholder> {
    const sh = await this.prisma.shareholder.findUnique({
      where: { id: shareholderId },
      select: OWN_SHAREHOLDER_SELECT,
    });
    if (!sh) {
      throw new NotFoundException('Shareholder not found');
    }
    if (!canActForShareholder(sh, userId)) {
      throw new ForbiddenException('You can only manage your own shareholder records');
    }
    return sh;
  }

  private async notifyCoop(sh: OwnShareholder, kind: 'requested' | 'reenable', card: ChargeCard) {
    if (!sh.coop.coopEmail) {
      this.logger.warn(`Coop ${sh.coopId} has no coopEmail; charge-card ${kind} notice not sent`);
      return;
    }
    try {
      await this.email.sendChargeCardCoopNotice(sh.coopId, sh.coop.coopEmail, {
        kind,
        // Fall back to the card's OGM when the shareholder has no company,
        // first or last name (a malformed record should not blank the email).
        shareholderName: shareholderDisplayName(sh) || card.ogmCode,
        label: card.label,
        ogmCode: card.ogmCode,
        amount: Number(card.feeInclVat),
        isReplacement: card.isReplacement,
      });
    } catch (err) {
      this.logger.error(`Failed to queue charge-card ${kind} notice: ${(err as Error).message}`);
    }
  }
}
