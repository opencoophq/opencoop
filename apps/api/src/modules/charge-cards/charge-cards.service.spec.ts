import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@opencoop/database';
import { ChargeCardsService } from './charge-cards.service';

const OGM = '+++090/9337/55493+++';

function shareholder(overrides: Record<string, unknown> = {}, coop: Record<string, unknown> = {}) {
  return {
    id: 'sh-1',
    coopId: 'coop-1',
    userId: 'user-1',
    type: 'INDIVIDUAL',
    registeredByUserId: null,
    status: 'ACTIVE',
    firstName: 'Jan',
    lastName: 'Peeters',
    companyName: null,
    coop: {
      id: 'coop-1',
      name: 'Bronsgroen',
      slug: 'bronsgroen',
      chargeCardsEnabled: true,
      chargeCardFee: new Prisma.Decimal('6.00'),
      chargeCardReplacementFee: new Prisma.Decimal('12.00'),
      bankIban: 'BE68539007547034',
      bankBic: 'GKCCBEBB',
      coopEmail: 'info@bronsgroen.be',
      ...coop,
    },
    ...overrides,
  };
}

function card(overrides: Record<string, unknown> = {}) {
  return {
    id: 'card-1',
    coopId: 'coop-1',
    shareholderId: 'sh-1',
    label: 'Auto Anna',
    status: 'REQUESTED',
    blockReason: null,
    ogmCode: OGM,
    cardNumber: null,
    feeInclVat: new Prisma.Decimal('6.00'),
    isReplacement: false,
    replacesCardId: null,
    providerSyncNeeded: false,
    requestedAt: new Date('2026-10-05T08:00:00Z'),
    paidAt: null,
    issuedAt: null,
    blockedAt: null,
    activatedAt: null,
    replacedBy: null,
    ...overrides,
  };
}

describe('ChargeCardsService (shareholder side)', () => {
  let prisma: any;
  let ogm: { nextOgmCode: jest.Mock };
  let email: { sendChargeCardCoopNotice: jest.Mock };
  let service: ChargeCardsService;

  beforeEach(() => {
    prisma = {
      shareholder: { findUnique: jest.fn().mockResolvedValue(shareholder()) },
      chargeCard: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn(),
      },
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(prisma)),
    };
    ogm = { nextOgmCode: jest.fn().mockResolvedValue(OGM) };
    email = { sendChargeCardCoopNotice: jest.fn().mockResolvedValue(undefined) };
    service = new ChargeCardsService(prisma, ogm as any, email as any);
  });

  describe('access', () => {
    it('refuses the shareholder record of another user', async () => {
      await expect(service.listForShareholder('sh-1', 'someone-else')).rejects.toThrow(ForbiddenException);
    });

    it('lets a parent act for a minor they registered', async () => {
      prisma.shareholder.findUnique.mockResolvedValue(
        shareholder({ type: 'MINOR', userId: null, registeredByUserId: 'parent-1' }),
      );

      await expect(service.listForShareholder('sh-1', 'parent-1')).resolves.toMatchObject({ enabled: true });
    });

    it('returns 404 for an unknown shareholder', async () => {
      prisma.shareholder.findUnique.mockResolvedValue(null);

      await expect(service.listForShareholder('missing', 'user-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('listForShareholder', () => {
    it('returns enabled=false and no cards when the coop has the feature off', async () => {
      prisma.shareholder.findUnique.mockResolvedValue(shareholder({}, { chargeCardsEnabled: false }));

      const result = await service.listForShareholder('sh-1', 'user-1');

      expect(result).toMatchObject({ enabled: false, cards: [] });
      expect(prisma.chargeCard.findMany).not.toHaveBeenCalled();
    });

    it('returns fees as numbers and the cards, newest first', async () => {
      prisma.chargeCard.findMany.mockResolvedValue([card()]);

      const result = await service.listForShareholder('sh-1', 'user-1');

      expect(result).toMatchObject({
        enabled: true,
        fee: 6,
        replacementFee: 12,
        shareholderStatus: 'ACTIVE',
        coop: { name: 'Bronsgroen', slug: 'bronsgroen', bankIban: 'BE68539007547034', bankBic: 'GKCCBEBB' },
        cards: [{ id: 'card-1', feeInclVat: 6, replaced: false }],
      });
      expect(prisma.chargeCard.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { shareholderId: 'sh-1' }, orderBy: { requestedAt: 'desc' } }),
      );
    });
  });

  describe('request', () => {
    it('refuses when the coop has charge cards off', async () => {
      prisma.shareholder.findUnique.mockResolvedValue(shareholder({}, { chargeCardsEnabled: false }));

      await expect(service.request('sh-1', 'user-1', {})).rejects.toThrow(ForbiddenException);
      expect(prisma.chargeCard.create).not.toHaveBeenCalled();
    });

    it('refuses a shareholder who is not ACTIVE', async () => {
      prisma.shareholder.findUnique.mockResolvedValue(shareholder({ status: 'INACTIVE' }));

      await expect(service.request('sh-1', 'user-1', {})).rejects.toThrow(BadRequestException);
      expect(prisma.chargeCard.create).not.toHaveBeenCalled();
    });

    it('creates a REQUESTED card with the next OGM and the coop fee, and emails the coop', async () => {
      prisma.chargeCard.create.mockResolvedValue(card());

      const result = await service.request('sh-1', 'user-1', { label: '  Auto Anna  ' });

      expect(ogm.nextOgmCode).toHaveBeenCalledWith(prisma, 'coop-1');
      expect(prisma.chargeCard.create).toHaveBeenCalledWith({
        data: {
          coopId: 'coop-1',
          shareholderId: 'sh-1',
          label: 'Auto Anna',
          ogmCode: OGM,
          feeInclVat: new Prisma.Decimal('6.00'),
          isReplacement: false,
          replacesCardId: null,
        },
      });
      expect(result.payment).toEqual({
        beneficiaryName: 'Bronsgroen',
        iban: 'BE68539007547034',
        bic: 'GKCCBEBB',
        amount: 6,
        ogmCode: OGM,
      });
      expect(email.sendChargeCardCoopNotice).toHaveBeenCalledWith('coop-1', 'info@bronsgroen.be', {
        kind: 'requested',
        shareholderName: 'Jan Peeters',
        label: 'Auto Anna',
        ogmCode: OGM,
        amount: 6,
        isReplacement: false,
      });
    });

    it('stores a blank label as null', async () => {
      prisma.chargeCard.create.mockResolvedValue(card({ label: null }));

      await service.request('sh-1', 'user-1', { label: '   ' });

      expect(prisma.chargeCard.create).toHaveBeenCalledWith({ data: expect.objectContaining({ label: null }) });
    });

    it('charges the replacement fee when replacing an own LOST card', async () => {
      prisma.chargeCard.findFirst.mockResolvedValue(card({ id: 'lost-1', status: 'BLOCKED', blockReason: 'LOST' }));
      prisma.chargeCard.create.mockResolvedValue(
        card({ id: 'card-2', feeInclVat: new Prisma.Decimal('12.00'), isReplacement: true, replacesCardId: 'lost-1' }),
      );

      await service.request('sh-1', 'user-1', { replacesCardId: 'lost-1' });

      expect(prisma.chargeCard.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'lost-1', shareholderId: 'sh-1' } }),
      );
      expect(prisma.chargeCard.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          feeInclVat: new Prisma.Decimal('12.00'),
          isReplacement: true,
          replacesCardId: 'lost-1',
        }),
      });
    });

    it('refuses to replace a card that is not lost', async () => {
      prisma.chargeCard.findFirst.mockResolvedValue(card({ id: 'c-2', status: 'ACTIVE' }));

      await expect(service.request('sh-1', 'user-1', { replacesCardId: 'c-2' })).rejects.toThrow(BadRequestException);
    });

    it('refuses to replace a lost card twice', async () => {
      prisma.chargeCard.findFirst.mockResolvedValue(
        card({ id: 'lost-1', status: 'BLOCKED', blockReason: 'LOST', replacedBy: { id: 'card-2' } }),
      );

      await expect(service.request('sh-1', 'user-1', { replacesCardId: 'lost-1' })).rejects.toThrow(ConflictException);
    });

    it('turns a unique-index race on replacesCardId into 409', async () => {
      prisma.chargeCard.findFirst.mockResolvedValue(card({ id: 'lost-1', status: 'BLOCKED', blockReason: 'LOST' }));
      prisma.chargeCard.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: '6.2.0',
          meta: { target: ['replacesCardId'] },
        }),
      );

      await expect(service.request('sh-1', 'user-1', { replacesCardId: 'lost-1' })).rejects.toThrow(ConflictException);
    });

    it('still creates the card when the coop has no email address', async () => {
      prisma.shareholder.findUnique.mockResolvedValue(shareholder({}, { coopEmail: null }));
      prisma.chargeCard.create.mockResolvedValue(card());

      await expect(service.request('sh-1', 'user-1', {})).resolves.toMatchObject({ card: { id: 'card-1' } });
      expect(email.sendChargeCardCoopNotice).not.toHaveBeenCalled();
    });
  });

  describe('cancel, report lost, re-enable', () => {
    it('cancels a REQUESTED card', async () => {
      prisma.chargeCard.findFirst.mockResolvedValue({ id: 'card-1' });
      prisma.chargeCard.findUniqueOrThrow.mockResolvedValue(card({ status: 'CANCELLED' }));

      const result = await service.cancel('sh-1', 'user-1', 'card-1');

      expect(prisma.chargeCard.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'card-1', shareholderId: 'sh-1' } }),
      );
      expect(prisma.chargeCard.updateMany).toHaveBeenCalledWith({
        where: { AND: [{ id: 'card-1' }, { status: 'REQUESTED' }] },
        data: { status: 'CANCELLED' },
      });
      expect(result.status).toBe('CANCELLED');
    });

    it('refuses to cancel a card that is no longer REQUESTED', async () => {
      prisma.chargeCard.findFirst.mockResolvedValue({ id: 'card-1' });
      prisma.chargeCard.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.cancel('sh-1', 'user-1', 'card-1')).rejects.toThrow(BadRequestException);
    });

    it('returns 404 for a card of another shareholder', async () => {
      prisma.chargeCard.findFirst.mockResolvedValue(null);

      await expect(service.cancel('sh-1', 'user-1', 'card-9')).rejects.toThrow(NotFoundException);
    });

    it('reports a card lost and flags the provider sync', async () => {
      prisma.chargeCard.findFirst.mockResolvedValue({ id: 'card-1' });
      prisma.chargeCard.findUniqueOrThrow.mockResolvedValue(card({ status: 'BLOCKED', blockReason: 'LOST' }));

      await service.reportLost('sh-1', 'user-1', 'card-1');

      const call = prisma.chargeCard.updateMany.mock.calls[0][0];
      expect(call.where).toEqual({
        AND: [{ id: 'card-1' }, { OR: [{ status: 'ACTIVE' }, { status: 'BLOCKED', blockReason: { not: 'LOST' } }] }],
      });
      expect(call.data).toEqual({
        status: 'BLOCKED',
        blockReason: 'LOST',
        blockedAt: expect.any(Date),
        providerSyncNeeded: true,
      });
    });

    it('flags a re-enable once and emails the coop once', async () => {
      prisma.chargeCard.findFirst
        .mockResolvedValueOnce(card({ status: 'ACTIVE' }))
        .mockResolvedValueOnce(card({ status: 'ACTIVE', providerSyncNeeded: true }));
      prisma.chargeCard.update.mockResolvedValue(card({ status: 'ACTIVE', providerSyncNeeded: true }));

      await service.requestReenable('sh-1', 'user-1', 'card-1');
      await service.requestReenable('sh-1', 'user-1', 'card-1');

      expect(prisma.chargeCard.update).toHaveBeenCalledTimes(1);
      expect(prisma.chargeCard.update).toHaveBeenCalledWith({
        where: { id: 'card-1' },
        data: { providerSyncNeeded: true, activatedAt: expect.any(Date) },
      });
      expect(email.sendChargeCardCoopNotice).toHaveBeenCalledTimes(1);
      expect(email.sendChargeCardCoopNotice).toHaveBeenCalledWith(
        'coop-1',
        'info@bronsgroen.be',
        expect.objectContaining({ kind: 'reenable' }),
      );
    });

    it('refuses a re-enable for a card that is not ACTIVE', async () => {
      prisma.chargeCard.findFirst.mockResolvedValue(card({ status: 'BLOCKED', blockReason: 'ADMIN' }));

      await expect(service.requestReenable('sh-1', 'user-1', 'card-1')).rejects.toThrow(BadRequestException);
    });

    it('refuses a re-enable when the shareholder is not ACTIVE', async () => {
      prisma.shareholder.findUnique.mockResolvedValue(shareholder({ status: 'INACTIVE' }));
      prisma.chargeCard.findFirst.mockResolvedValue(card({ status: 'ACTIVE' }));

      await expect(service.requestReenable('sh-1', 'user-1', 'card-1')).rejects.toThrow(BadRequestException);
      expect(prisma.chargeCard.update).not.toHaveBeenCalled();
    });
  });
});
