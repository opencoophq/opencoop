import { recordChargeCardPayment } from './charge-card-payments';
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
      payment: { create: jest.fn().mockResolvedValue({ id: 'pay-1' }), findMany: jest.fn() },
      chargeCard: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
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
    expect(tx.chargeCard.updateMany).toHaveBeenCalledWith({
      where: { id: 'card-1', status: 'REQUESTED' },
      data: { status: 'PAID', paidAt: expect.any(Date) },
    });
    expect(result).toEqual({ payment: { id: 'pay-1' }, paid: true });
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

  it('reports paid=false when the card was cancelled in the meantime', async () => {
    tx.payment.findMany.mockResolvedValue([{ amount: 6.05 }]);
    tx.chargeCard.updateMany.mockResolvedValue({ count: 0 });

    const result = await recordChargeCardPayment(tx, card, { amount: 6.05, bankDate: new Date() });

    expect(result.paid).toBe(false);
  });
});
