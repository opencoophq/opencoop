import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@opencoop/database';
import { ChargeCardsAdminService } from './charge-cards-admin.service';

const OGM = '+++090/9337/55493+++';

function card(overrides: Record<string, unknown> = {}) {
  return {
    id: 'card-1',
    coopId: 'coop-1',
    shareholderId: 'sh-1',
    label: 'Auto Anna',
    status: 'PAID',
    blockReason: null,
    ogmCode: OGM,
    cardNumber: null,
    feeInclVat: new Prisma.Decimal('6.00'),
    isReplacement: false,
    replacesCardId: null,
    providerSyncNeeded: false,
    requestedAt: new Date('2026-10-01T08:00:00Z'),
    paidAt: new Date('2026-10-12T08:00:00Z'),
    issuedAt: null,
    blockedAt: null,
    activatedAt: null,
    shareholder: {
      firstName: 'Jan',
      lastName: 'Peeters',
      companyName: null,
      status: 'ACTIVE',
      email: 'jan@example.com',
      user: null,
    },
    payments: [{ amount: new Prisma.Decimal('6.00') }],
    ...overrides,
  };
}

describe('ChargeCardsAdminService', () => {
  let prisma: any;
  let email: { sendChargeCardIssued: jest.Mock };
  let service: ChargeCardsAdminService;
  let audit: { log: jest.Mock };
  const originalFrontendUrl = process.env.FRONTEND_URL;

  beforeEach(() => {
    process.env.FRONTEND_URL = 'https://opencoop.test';
    prisma = {
      chargeCard: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn(),
      },
      // SELECT ... FOR UPDATE on the card row, mirroring ChargeCardsService.cancel().
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'card-1' }]),
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(prisma)),
    };
    email = { sendChargeCardIssued: jest.fn().mockResolvedValue(undefined) };
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    service = new ChargeCardsAdminService(prisma, email as any, audit as any);
  });

  afterAll(() => {
    process.env.FRONTEND_URL = originalFrontendUrl;
  });

  describe('list', () => {
    const now = new Date('2026-10-13T09:00:00Z'); // Tuesday

    it('adds waiting working days and flags overdue REQUESTED and PAID cards', async () => {
      prisma.chargeCard.findMany.mockResolvedValue([
        card({
          id: 'r',
          status: 'REQUESTED',
          paidAt: null,
          requestedAt: new Date('2026-10-05T08:00:00Z'),
          payments: [],
        }),
        card({ id: 'p', status: 'PAID', paidAt: new Date('2026-10-12T08:00:00Z') }),
        card({ id: 'a', status: 'ACTIVE', cardNumber: 'NL-1' }),
      ]);

      const rows = await service.list('coop-1', {}, now);

      expect(rows.map((r) => [r.id, r.waitingWorkingDays, r.overdue])).toEqual([
        ['r', 6, true],
        ['p', 1, false],
        ['a', null, false],
      ]);
      expect(rows[1]).toMatchObject({
        shareholderName: 'Jan Peeters',
        shareholderStatus: 'ACTIVE',
        totalPaid: 6,
        feeInclVat: 6,
      });
    });

    it('returns who registered the card: email (login first) and member number', async () => {
      prisma.chargeCard.findMany.mockResolvedValue([
        card({
          id: 'with-login',
          shareholder: {
            firstName: 'Fien',
            lastName: 'Vermeulen',
            companyName: null,
            status: 'ACTIVE',
            memberNumber: 42,
            email: 'fien.oud@example.be',
            user: { email: 'fien@example.be' },
          },
        }),
        card({
          id: 'no-email',
          shareholder: {
            firstName: 'Wim',
            lastName: 'Claes',
            companyName: null,
            status: 'ACTIVE',
            memberNumber: null,
            email: null,
            user: null,
          },
        }),
      ]);

      const rows = await service.list('coop-1', {}, now);

      expect(rows[0]).toMatchObject({
        shareholderName: 'Fien Vermeulen',
        shareholderEmail: 'fien@example.be',
        shareholderNumber: 42,
      });
      expect(rows[1]).toMatchObject({ shareholderEmail: null, shareholderNumber: null });
      expect(prisma.chargeCard.findMany.mock.calls[0][0].include.shareholder.select).toMatchObject({
        memberNumber: true,
        email: true,
        user: { select: { email: true } },
      });
    });

    it('filters on status and on the provider to-do flag, within the coop', async () => {
      await service.list('coop-1', { status: 'BLOCKED', todo: true }, now);

      expect(prisma.chargeCard.findMany.mock.calls[0][0].where).toEqual({
        coopId: 'coop-1',
        status: 'BLOCKED',
        providerSyncNeeded: true,
      });
    });
  });

  describe('issue', () => {
    it('trims the card number, activates the card and emails the shareholder', async () => {
      // First call: the service's own PAID/ACTIVE-shareholder validation.
      // Second call: transitionCard's own guard, inside the locked transaction.
      prisma.chargeCard.findFirst
        .mockResolvedValueOnce(card())
        .mockResolvedValueOnce({ id: 'card-1' });
      prisma.chargeCard.findUniqueOrThrow.mockResolvedValue(
        card({ status: 'ACTIVE', cardNumber: 'NL-123' }),
      );

      const result = await service.issue('coop-1', 'card-1', '  NL-123 ');

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(prisma.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
        prisma.chargeCard.updateMany.mock.invocationCallOrder[0],
      );
      expect(prisma.chargeCard.updateMany).toHaveBeenCalledWith({
        where: { AND: [{ id: 'card-1' }, { status: 'PAID', shareholder: { status: 'ACTIVE' } }] },
        data: {
          status: 'ACTIVE',
          cardNumber: 'NL-123',
          issuedAt: expect.any(Date),
          activatedAt: expect.any(Date),
          providerSyncNeeded: false,
        },
      });
      expect(email.sendChargeCardIssued).toHaveBeenCalledWith('coop-1', 'jan@example.com', {
        shareholderName: 'Jan Peeters',
        label: 'Auto Anna',
        cardNumber: 'NL-123',
        dashboardUrl: 'https://opencoop.test/dashboard/charge-cards',
      });
      expect(result.status).toBe('ACTIVE');
    });

    it('refuses a blank card number without touching the database', async () => {
      await expect(service.issue('coop-1', 'card-1', '   ')).rejects.toThrow(BadRequestException);
      expect(prisma.chargeCard.findFirst).not.toHaveBeenCalled();
    });

    it('returns 404 for a card of another coop', async () => {
      prisma.chargeCard.findFirst.mockResolvedValue(null);

      await expect(service.issue('coop-1', 'card-9', 'NL-1')).rejects.toThrow(NotFoundException);
      expect(prisma.chargeCard.findFirst.mock.calls[0][0].where).toEqual({
        id: 'card-9',
        coopId: 'coop-1',
      });
    });

    it('refuses a card that is not PAID', async () => {
      prisma.chargeCard.findFirst.mockResolvedValue(card({ status: 'REQUESTED' }));

      await expect(service.issue('coop-1', 'card-1', 'NL-1')).rejects.toThrow(BadRequestException);
      expect(prisma.chargeCard.updateMany).not.toHaveBeenCalled();
    });

    it('refuses to issue to a shareholder who is no longer ACTIVE', async () => {
      prisma.chargeCard.findFirst.mockResolvedValue(
        card({ shareholder: { ...card().shareholder, status: 'INACTIVE' } }),
      );

      await expect(service.issue('coop-1', 'card-1', 'NL-1')).rejects.toThrow(BadRequestException);
      expect(prisma.chargeCard.updateMany).not.toHaveBeenCalled();
    });

    it('answers 409 when the card number is already used in the coop', async () => {
      prisma.chargeCard.findFirst
        .mockResolvedValueOnce(card())
        .mockResolvedValueOnce({ id: 'card-1' });
      prisma.chargeCard.updateMany.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: '6.2.0',
          meta: { target: ['coopId', 'cardNumber'] },
        }),
      );

      await expect(service.issue('coop-1', 'card-1', 'NL-1')).rejects.toThrow(ConflictException);
    });

    it('issues without an email when the shareholder has no address', async () => {
      prisma.chargeCard.findFirst
        .mockResolvedValueOnce(
          card({ shareholder: { ...card().shareholder, email: null, user: null } }),
        )
        .mockResolvedValueOnce({ id: 'card-1' });
      prisma.chargeCard.findUniqueOrThrow.mockResolvedValue(
        card({ status: 'ACTIVE', cardNumber: 'NL-1' }),
      );

      await service.issue('coop-1', 'card-1', 'NL-1');

      expect(email.sendChargeCardIssued).not.toHaveBeenCalled();
    });

    it('returns 404 without touching updateMany when the row lock finds nothing', async () => {
      prisma.chargeCard.findFirst.mockResolvedValueOnce(card());
      prisma.$queryRaw.mockResolvedValueOnce([]);

      await expect(service.issue('coop-1', 'card-1', 'NL-1')).rejects.toThrow(NotFoundException);
      expect(prisma.chargeCard.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('state changes', () => {
    beforeEach(() => {
      prisma.chargeCard.findFirst.mockResolvedValue({ id: 'card-1' });
      prisma.chargeCard.findUniqueOrThrow.mockResolvedValue(card());
    });

    const lastUpdate = () => prisma.chargeCard.updateMany.mock.calls[0][0];

    it('block: ACTIVE → BLOCKED/ADMIN and flags the provider sync', async () => {
      await service.block('coop-1', 'card-1');

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(lastUpdate()).toEqual({
        where: { AND: [{ id: 'card-1' }, { status: 'ACTIVE' }] },
        data: {
          status: 'BLOCKED',
          blockReason: 'ADMIN',
          blockedAt: expect.any(Date),
          providerSyncNeeded: true,
        },
      });
    });

    it('unblock: only an ADMIN block of an ACTIVE shareholder; sets activatedAt and the sync flag', async () => {
      await service.unblock('coop-1', 'card-1');

      expect(lastUpdate()).toEqual({
        where: {
          AND: [
            { id: 'card-1' },
            { status: 'BLOCKED', blockReason: 'ADMIN', shareholder: { status: 'ACTIVE' } },
          ],
        },
        data: {
          status: 'ACTIVE',
          blockReason: null,
          blockedAt: null,
          activatedAt: expect.any(Date),
          providerSyncNeeded: true,
        },
      });
    });

    it('unblock refuses a NO_SHARES or LOST block', async () => {
      prisma.chargeCard.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.unblock('coop-1', 'card-1')).rejects.toThrow(BadRequestException);
    });

    it('markLost uses the shared lost rule', async () => {
      await service.markLost('coop-1', 'card-1');

      expect(lastUpdate().where).toEqual({
        AND: [
          { id: 'card-1' },
          { OR: [{ status: 'ACTIVE' }, { status: 'BLOCKED', blockReason: { not: 'LOST' } }] },
        ],
      });
      expect(lastUpdate().data).toMatchObject({
        status: 'BLOCKED',
        blockReason: 'LOST',
        providerSyncNeeded: true,
      });
    });

    it('markProviderSyncDone clears the flag', async () => {
      await service.markProviderSyncDone('coop-1', 'card-1');

      expect(lastUpdate()).toEqual({
        where: { AND: [{ id: 'card-1' }, { providerSyncNeeded: true }] },
        data: { providerSyncNeeded: false },
      });
    });

    it('cancel: REQUESTED or PAID → CANCELLED and clears replacesCardId', async () => {
      await service.cancel('coop-1', 'card-1');

      expect(lastUpdate()).toEqual({
        where: { AND: [{ id: 'card-1' }, { status: { in: ['REQUESTED', 'PAID'] } }] },
        data: { status: 'CANCELLED', replacesCardId: null },
      });
    });

    it('cancel succeeds on a PAID card that already holds a payment (admin handles the refund)', async () => {
      prisma.chargeCard.findUniqueOrThrow.mockResolvedValue(card({ status: 'CANCELLED' }));

      await expect(service.cancel('coop-1', 'card-1')).resolves.toMatchObject({
        status: 'CANCELLED',
      });
      expect(lastUpdate().data).toEqual({ status: 'CANCELLED', replacesCardId: null });
    });

    it('scopes every change to the coop and locks the row before checking state', async () => {
      await service.block('coop-1', 'card-1');

      expect(prisma.$queryRaw.mock.calls[0].join(' ')).toContain('FOR UPDATE');
      expect(prisma.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
        prisma.chargeCard.updateMany.mock.invocationCallOrder[0],
      );
    });

    it('returns 404 when the row lock finds no card in this coop', async () => {
      prisma.$queryRaw.mockResolvedValue([]);

      await expect(service.block('coop-1', 'card-1')).rejects.toThrow(NotFoundException);
      expect(prisma.chargeCard.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('markPaid', () => {
    const now = new Date('2026-11-16T10:00:00Z');
    const requested = () =>
      card({
        status: 'REQUESTED',
        paidAt: null,
        feeInclVat: new Prisma.Decimal('6.00'),
        payments: [],
      });

    beforeEach(() => {
      prisma.$queryRaw.mockResolvedValue([{ id: 'card-1', status: 'REQUESTED' }]);
      prisma.chargeCard.findFirstOrThrow = jest.fn().mockResolvedValue(requested());
      // transitionCard's scoped lookup before the guarded REQUESTED -> PAID update.
      prisma.chargeCard.findFirst.mockResolvedValue({ id: 'card-1' });
      prisma.chargeCard.findUniqueOrThrow.mockResolvedValue(card({ status: 'PAID' }));
      prisma.payment = {
        create: jest.fn().mockResolvedValue({ id: 'pay-1' }),
        findMany: jest.fn().mockResolvedValue([{ amount: 6 }]),
      };
    });

    it('books the fee without a bank row, marks the card PAID on the given day and audits method and note', async () => {
      await service.markPaid(
        'coop-1',
        'card-1',
        { paidAt: '2026-11-10', method: 'CASH', note: '  Betaald aan de balie  ' },
        'admin-1',
        now,
      );

      const day = new Date('2026-11-10T00:00:00.000Z');
      expect(prisma.chargeCard.findFirstOrThrow).toHaveBeenCalledWith({
        where: { id: 'card-1', coopId: 'coop-1' },
        include: { payments: { select: { amount: true } } },
      });
      expect(prisma.payment.create).toHaveBeenCalledWith({
        data: {
          chargeCardId: 'card-1',
          coopId: 'coop-1',
          amount: 6,
          bankDate: day,
          bankTransactionId: null,
          matchedByUserId: 'admin-1',
          matchedAt: expect.any(Date),
        },
      });
      expect(prisma.chargeCard.updateMany).toHaveBeenCalledWith({
        where: { AND: [{ id: 'card-1' }, { status: 'REQUESTED' }] },
        data: { status: 'PAID', paidAt: day },
      });
      expect(audit.log).toHaveBeenCalledWith(
        {
          coopId: 'coop-1',
          entity: 'ChargeCard',
          entityId: 'card-1',
          action: 'UPDATE',
          actorId: 'admin-1',
          changes: [
            { field: 'status', oldValue: 'REQUESTED', newValue: 'PAID' },
            { field: 'paidAt', oldValue: null, newValue: '2026-11-10' },
            { field: 'paymentMethod', oldValue: null, newValue: 'CASH' },
            { field: 'amount', oldValue: null, newValue: 6 },
            { field: 'note', oldValue: null, newValue: 'Betaald aan de balie' },
          ],
        },
        prisma,
      );
    });

    it('books only the open part of the fee when a partial payment exists', async () => {
      prisma.chargeCard.findFirstOrThrow.mockResolvedValue({
        ...requested(),
        payments: [{ amount: new Prisma.Decimal('2.40') }],
      });

      await service.markPaid('coop-1', 'card-1', { method: 'BANK_TRANSFER' }, 'admin-1', now);

      expect(prisma.payment.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ amount: 3.6 }),
      });
      const changes = audit.log.mock.calls[0][0].changes;
      expect(changes).toContainEqual({ field: 'amount', oldValue: null, newValue: 3.6 });
      expect(changes.map((c: { field: string }) => c.field)).not.toContain('note');
    });

    it('defaults to today in Europe/Brussels, not UTC', async () => {
      // 23:30 UTC on the 15th is already the 16th in Brussels.
      await service.markPaid(
        'coop-1',
        'card-1',
        { method: 'OTHER' },
        'admin-1',
        new Date('2026-11-15T23:30:00Z'),
      );

      expect(prisma.chargeCard.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: 'PAID', paidAt: new Date('2026-11-16T00:00:00.000Z') },
        }),
      );
    });

    it.each(['2026-11-17', '2026-02-31'])(
      'refuses paidAt %s with 400 before touching the database',
      async (paidAt) => {
        await expect(
          service.markPaid('coop-1', 'card-1', { paidAt, method: 'CASH' }, 'admin-1', now),
        ).rejects.toThrow(BadRequestException);
        expect(prisma.$transaction).not.toHaveBeenCalled();
      },
    );

    it('refuses a paidAt before the Brussels day of the request with 400 and writes nothing', async () => {
      // requestedAt 2026-10-01T08:00Z is 1 October in Brussels.
      await expect(
        service.markPaid(
          'coop-1',
          'card-1',
          { paidAt: '2026-09-30', method: 'CASH' },
          'admin-1',
          now,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.payment.create).not.toHaveBeenCalled();
      expect(audit.log).not.toHaveBeenCalled();
    });

    it('accepts a paidAt on the day of the request', async () => {
      await service.markPaid(
        'coop-1',
        'card-1',
        { paidAt: '2026-10-01', method: 'CASH' },
        'admin-1',
        now,
      );
      expect(prisma.payment.create).toHaveBeenCalled();
    });

    it.each(['PAID', 'ACTIVE', 'CANCELLED'])(
      'answers 409 for a %s card and writes nothing',
      async (status) => {
        prisma.chargeCard.findFirstOrThrow.mockResolvedValue({ ...requested(), status });

        await expect(
          service.markPaid('coop-1', 'card-1', { method: 'CASH' }, 'admin-1', now),
        ).rejects.toThrow(ConflictException);
        expect(prisma.payment.create).not.toHaveBeenCalled();
        expect(audit.log).not.toHaveBeenCalled();
      },
    );

    it('answers 409 when the payment path finds the card no longer REQUESTED', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([{ id: 'card-1', status: 'REQUESTED' }])
        .mockResolvedValueOnce([{ id: 'card-1', status: 'PAID' }]);

      await expect(
        service.markPaid('coop-1', 'card-1', { method: 'CASH' }, 'admin-1', now),
      ).rejects.toThrow(ConflictException);
      expect(prisma.payment.create).not.toHaveBeenCalled();
    });

    it('returns 404 when the row lock finds no card in this coop', async () => {
      prisma.$queryRaw.mockResolvedValue([]);

      await expect(
        service.markPaid('coop-1', 'card-1', { method: 'CASH' }, 'admin-1', now),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.payment.create).not.toHaveBeenCalled();
    });
  });
});
