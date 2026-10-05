import { AdminNotificationsService } from './admin-notifications.service';

describe('AdminNotificationsService digests', () => {
  it('reports charge-card payments and does not crash on a payment without a registration', async () => {
    const prisma = {
      coopAdmin: {
        findMany: jest.fn().mockResolvedValue([
          {
            coopId: 'coop-1',
            user: { email: 'admin@coop.be', name: 'Admin' },
            coop: { id: 'coop-1', name: 'Coop' },
            notificationSettings: {
              notifyOnNewShareholder: false,
              notifyOnSharePurchase: false,
              notifyOnShareSell: false,
              notifyOnPaymentReceived: true,
            },
          },
        ]),
      },
      payment: {
        findMany: jest.fn().mockResolvedValue([
          {
            amount: 100,
            registration: { shareholder: { firstName: 'Jan', lastName: 'Peeters', companyName: null } },
            chargeCard: null,
          },
          {
            amount: 6,
            registration: null,
            chargeCard: { shareholder: { firstName: null, lastName: null, companyName: 'Bakkerij Janssens' } },
          },
        ]),
      },
    };
    const email = { sendAdminDigest: jest.fn().mockResolvedValue(undefined) };
    const service = new AdminNotificationsService(prisma as any, email as any);

    await (service as any).sendDigests('DAILY', new Date(0), 8);

    expect(prisma.payment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ include: expect.objectContaining({ chargeCard: expect.anything() }) }),
    );
    expect(email.sendAdminDigest).toHaveBeenCalledWith(
      'coop-1',
      'admin@coop.be',
      expect.objectContaining({
        events: [
          { event: 'payment_received', data: { shareholderName: 'Jan Peeters', paymentAmount: 100 } },
          { event: 'payment_received', data: { shareholderName: 'Bakkerij Janssens', paymentAmount: 6 } },
        ],
      }),
    );
  });
});
