import { BadRequestException } from '@nestjs/common';
import { ChargeCardNotPayableError, recordChargeCardPayment } from './charge-card-payments';
import { ChargeCardTarget } from '../ogm/payment-target';

const card: ChargeCardTarget = {
  kind: 'chargeCard',
  id: 'card-1',
  coopId: 'coop-1',
  shareholderId: 'sh-1',
  status: 'REQUESTED',
  feeInclVat: 6.05,
  ogmCode: '+++090/9337/55493+++',
};

describe('recordChargeCardPayment', () => {
  let tx: any;

  beforeEach(() => {
    tx = {
      // SELECT ... FOR UPDATE on the card row.
      $queryRaw: jest.fn().mockResolvedValue([{ status: 'REQUESTED' }]),
      payment: { create: jest.fn().mockResolvedValue({ id: 'pay-1' }), findMany: jest.fn() },
      chargeCard: {
        findFirst: jest.fn().mockResolvedValue({ id: 'card-1' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'card-1', status: 'PAID' }),
      },
    };
  });

  it('books the payment on the card and marks it PAID once the fee is reached', async () => {
    tx.payment.findMany.mockResolvedValue([{ amount: '6.05' }]);

    const result = await recordChargeCardPayment(tx, card, {
      amount: 6.05,
      bankDate: new Date('2026-10-06'),
      bankTransactionId: 'btx-1',
      matchedByUserId: 'user-1',
    });

    expect(tx.payment.create).toHaveBeenCalledWith({
      data: {
        chargeCardId: 'card-1',
        coopId: 'coop-1',
        amount: 6.05,
        bankDate: new Date('2026-10-06'),
        bankTransactionId: 'btx-1',
        matchedByUserId: 'user-1',
        matchedAt: expect.any(Date),
      },
    });
    // transitionCard: scoped lookup, then the guarded REQUESTED -> PAID update.
    expect(tx.chargeCard.findFirst).toHaveBeenCalledWith({
      where: { id: 'card-1', coopId: 'coop-1' },
      select: { id: true },
    });
    expect(tx.chargeCard.updateMany).toHaveBeenCalledWith({
      where: { AND: [{ id: 'card-1' }, { status: 'REQUESTED' }] },
      data: { status: 'PAID', paidAt: expect.any(Date) },
    });
    expect(result).toEqual({ payment: { id: 'pay-1' }, paid: true });
  });

  it('locks the card row, scoped to the coop, before it writes anything', async () => {
    tx.payment.findMany.mockResolvedValue([{ amount: 3 }]);

    await recordChargeCardPayment(tx, card, { amount: 3, bankDate: new Date() });

    const [sql, ...values] = tx.$queryRaw.mock.calls[0];
    expect(sql.join('?')).toMatch(/FROM "charge_cards"[\s\S]*FOR UPDATE/);
    expect(values).toEqual(['card-1', 'coop-1']);
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.payment.create.mock.invocationCallOrder[0]);
  });

  it('keeps the card REQUESTED while the payments are short', async () => {
    tx.payment.findMany.mockResolvedValue([{ amount: 3 }]);

    const result = await recordChargeCardPayment(tx, card, { amount: 3, bankDate: new Date() });

    expect(tx.chargeCard.updateMany).not.toHaveBeenCalled();
    expect(result.paid).toBe(false);
  });

  it('adds up partial payments in cents', async () => {
    tx.payment.findMany.mockResolvedValue([{ amount: 0.1 }, { amount: 0.2 }, { amount: 5.75 }]);

    const result = await recordChargeCardPayment(tx, card, { amount: 5.75, bankDate: new Date() });

    expect(result.paid).toBe(true);
  });

  it.each(['PAID', 'CANCELLED'] as const)('writes no payment when the locked card is %s', async (status) => {
    tx.$queryRaw.mockResolvedValue([{ status }]);

    await expect(recordChargeCardPayment(tx, card, { amount: 6.05, bankDate: new Date() })).rejects.toEqual(
      new ChargeCardNotPayableError(status),
    );
    expect(tx.payment.create).not.toHaveBeenCalled();
  });

  it('writes no payment when the card is gone or belongs to another coop', async () => {
    tx.$queryRaw.mockResolvedValue([]);

    await expect(recordChargeCardPayment(tx, card, { amount: 6.05, bankDate: new Date() })).rejects.toBeInstanceOf(
      ChargeCardNotPayableError,
    );
    expect(tx.payment.create).not.toHaveBeenCalled();
  });

  it('throws when transitionCard refuses, so the caller rolls the payment back', async () => {
    tx.payment.findMany.mockResolvedValue([{ amount: 6.05 }]);
    tx.chargeCard.updateMany.mockResolvedValue({ count: 0 });

    await expect(recordChargeCardPayment(tx, card, { amount: 6.05, bankDate: new Date() })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
