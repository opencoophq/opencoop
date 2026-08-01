import { MeetingStatus, RSVPStatus } from '@opencoop/database';
import { ReminderProcessor } from './reminder.processor';

describe('ReminderProcessor', () => {
  let prisma: any;
  let email: any;
  let processor: ReminderProcessor;

  beforeEach(() => {
    prisma = {
      meeting: {
        findMany: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    email = { send: jest.fn().mockResolvedValue(undefined) };
    processor = new ReminderProcessor(prisma, email);
  });

  it('sends scheduled meeting reminders in the user preferred language', async () => {
    const scheduledAt = new Date(Date.now() + 2.5 * 24 * 3600 * 1000);
    prisma.meeting.findMany.mockResolvedValue([
      {
        id: 'm1',
        coopId: 'c1',
        title: 'AGM 2026',
        scheduledAt,
        remindersSent: null,
        reminderDaysBefore: [3],
        attendances: [
          {
            rsvpToken: 'token-s1',
            shareholderId: 's1',
            shareholder: {
              email: null,
              user: { email: 'marie@example.com', preferredLanguage: 'fr' },
              firstName: 'Marie',
              lastName: 'Dupont',
            },
          },
        ],
      },
    ]);

    await processor.tick();

    expect(prisma.meeting.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: MeetingStatus.CONVOKED },
        include: expect.objectContaining({
          attendances: expect.objectContaining({
            where: { rsvpStatus: RSVPStatus.UNKNOWN },
            include: {
              shareholder: {
                select: {
                  email: true,
                  firstName: true,
                  lastName: true,
                  user: { select: { email: true, preferredLanguage: true } },
                },
              },
            },
          }),
        }),
      }),
    );
    expect(email.send).toHaveBeenCalledTimes(1);
    expect(email.send.mock.calls[0][0].templateData).toEqual(
      expect.objectContaining({
        language: 'fr',
        shareholderName: 'Marie Dupont',
      }),
    );
    expect(prisma.meeting.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'm1' },
      }),
    );
  });

  it('falls back to Dutch when the user has no preferred language', async () => {
    const scheduledAt = new Date(Date.now() + 2.5 * 24 * 3600 * 1000);
    prisma.meeting.findMany.mockResolvedValue([
      {
        id: 'm1',
        coopId: 'c1',
        title: 'AGM 2026',
        scheduledAt,
        remindersSent: null,
        reminderDaysBefore: [3],
        attendances: [
          {
            rsvpToken: 'token-s1',
            shareholderId: 's1',
            shareholder: {
              email: 'fallback@example.com',
              user: null,
              firstName: 'Fallback',
              lastName: 'User',
            },
          },
        ],
      },
    ]);

    await processor.tick();

    expect(email.send.mock.calls[0][0].templateData.language).toBe('nl');
  });
});
