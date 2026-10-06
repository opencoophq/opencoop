import { EmailService } from './email.service';

describe('EmailService charge-card emails', () => {
  it('queues the coop notice in the recipient language with a localised subject', async () => {
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ preferredLanguage: 'fr' }) },
      emailLog: { create: jest.fn().mockResolvedValue({ id: 'log-1' }) },
    };
    const queue = { add: jest.fn().mockResolvedValue({}) };
    const service = new EmailService(prisma as any, queue as any);

    await service.sendChargeCardCoopNotice('coop-1', 'info@bronsgroen.be', {
      kind: 'requested',
      shareholderName: 'Jan Peeters',
      label: null,
      ogmCode: '+++090/9337/55493+++',
      amount: 6,
      isReplacement: false,
    });

    expect(queue.add).toHaveBeenCalledWith(
      'send',
      expect.objectContaining({
        subject: 'Nouvelle demande de carte de recharge',
        templateKey: 'charge-card-coop-notice',
        templateData: expect.objectContaining({ language: 'fr', kind: 'requested' }),
      }),
    );
  });

  it('queues the card-issued email in the recipient language', async () => {
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ preferredLanguage: 'de' }) },
      emailLog: { create: jest.fn().mockResolvedValue({ id: 'log-2' }) },
    };
    const queue = { add: jest.fn().mockResolvedValue({}) };
    const service = new EmailService(prisma as any, queue as any);

    await service.sendChargeCardIssued('coop-1', 'jan@example.com', {
      shareholderName: 'Jan Peeters',
      label: 'Auto Anna',
      cardNumber: 'NL-123',
      dashboardUrl: 'https://opencoop.test/dashboard/charge-cards',
    });

    expect(queue.add).toHaveBeenCalledWith(
      'send',
      expect.objectContaining({
        subject: 'Ihre Ladekarte ist bereit',
        templateKey: 'charge-card-issued',
        templateData: expect.objectContaining({ language: 'de', cardNumber: 'NL-123' }),
      }),
    );
  });
});
