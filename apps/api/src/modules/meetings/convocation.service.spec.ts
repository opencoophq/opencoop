import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ConvocationService } from './convocation.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../email/email.service';

describe('ConvocationService', () => {
  let service: ConvocationService;
  let prisma: any;
  let emailService: any;

  const FAR_FUTURE = new Date(Date.now() + 30 * 24 * 3600 * 1000);

  function makeMeeting(overrides: Record<string, any> = {}) {
    return {
      id: 'm1',
      coopId: 'c1',
      status: 'DRAFT',
      scheduledAt: FAR_FUTURE,
      title: 'AGM 2026',
      location: 'Brussels',
      agendaItems: [],
      coop: { name: 'Co' },
      ...overrides,
    };
  }

  beforeEach(async () => {
    emailService = { send: jest.fn().mockResolvedValue(undefined) };
    prisma = {
      meeting: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
      shareholder: { findMany: jest.fn() },
      meetingAttendance: { upsert: jest.fn().mockResolvedValue({}), findMany: jest.fn() },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        ConvocationService,
        { provide: PrismaService, useValue: prisma },
        { provide: EmailService, useValue: emailService },
      ],
    }).compile();
    service = moduleRef.get(ConvocationService);
  });

  it('rejects convocation less than 15 days before meeting without override', async () => {
    const scheduledAt = new Date(Date.now() + 10 * 24 * 3600 * 1000);
    prisma.meeting.findUnique.mockResolvedValue(makeMeeting({ scheduledAt }));
    await expect(service.send('c1', 'm1', { confirmShortNotice: false })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('allows short notice if confirmed (no shareholders = not marked CONVOKED)', async () => {
    const scheduledAt = new Date(Date.now() + 10 * 24 * 3600 * 1000);
    prisma.meeting.findUnique.mockResolvedValue(makeMeeting({ scheduledAt }));
    prisma.shareholder.findMany.mockResolvedValue([]);
    const result = await service.send('c1', 'm1', { confirmShortNotice: true });
    // No shareholders → no emails sent → meeting NOT marked CONVOKED (to allow retry when shareholders exist)
    expect(prisma.meeting.update).not.toHaveBeenCalled();
    expect((result as any).sent).toHaveLength(0);
  });

  it('is idempotent if meeting is already CONVOKED', async () => {
    prisma.meeting.findUnique.mockResolvedValue(makeMeeting({ status: 'CONVOKED' }));
    const res = await service.send('c1', 'm1', {});
    expect(res).toEqual({ alreadySent: true });
  });

  describe('sendReminderNow with shared households', () => {
    function makeMeetingForReminder(overrides: Record<string, any> = {}) {
      return {
        id: 'm1',
        coopId: 'c1',
        title: 'AGM 2026',
        scheduledAt: FAR_FUTURE,
        ...overrides,
      };
    }

    it('sends one email per distinct inbox when multiple shareholders share a User', async () => {
      prisma.meeting.findUnique.mockResolvedValue(makeMeetingForReminder());
      // Three attendances: s1 & s2 share jan@x.com (via user.email), s3 has own piet@x.com
      prisma.meetingAttendance.findMany.mockResolvedValue([
        {
          rsvpToken: 'token-s1',
          shareholderId: 's1',
          shareholder: { email: null, user: { email: 'jan@x.com' }, firstName: 'Jan', lastName: 'A' },
        },
        {
          rsvpToken: 'token-s2',
          shareholderId: 's2',
          shareholder: { email: null, user: { email: 'jan@x.com' }, firstName: 'Jan', lastName: 'B' },
        },
        {
          rsvpToken: 'token-s3',
          shareholderId: 's3',
          shareholder: { email: null, user: { email: 'piet@x.com' }, firstName: 'Piet', lastName: 'C' },
        },
      ]);

      const result = await service.sendReminderNow('c1', 'm1');

      // Only 2 emails sent (one per distinct inbox)
      expect(emailService.send).toHaveBeenCalledTimes(2);
      expect(result.sent).toBe(2);

      const recipients = emailService.send.mock.calls.map((c: any[]) => c[0].to).sort();
      expect(recipients).toEqual(['jan@x.com', 'piet@x.com']);

      // jan@x.com should use the first shareholder's token
      const janCall = emailService.send.mock.calls.find((c: any[]) => c[0].to === 'jan@x.com');
      expect(janCall[0].templateData.rsvpUrl).toContain('token-s1');
    });

    it('skips postal-only shareholders in reminders', async () => {
      prisma.meeting.findUnique.mockResolvedValue(makeMeetingForReminder());
      prisma.meetingAttendance.findMany.mockResolvedValue([
        {
          rsvpToken: 'token-s1',
          shareholderId: 's1',
          shareholder: { email: 'real@x.com', user: null, firstName: 'Real', lastName: 'Person' },
        },
        {
          rsvpToken: 'token-s2',
          shareholderId: 's2',
          shareholder: { email: null, user: null, firstName: 'Postal', lastName: 'Only' },
        },
      ]);

      const result = await service.sendReminderNow('c1', 'm1');

      expect(emailService.send).toHaveBeenCalledTimes(1);
      expect(result.sent).toBe(1);
      expect(emailService.send.mock.calls[0][0].to).toBe('real@x.com');
    });
  });

  describe('sendConvocation with shared households', () => {
    it('sends one email per distinct User when multiple shareholders share a User', async () => {
      // User U1 (jan@x.com) owns S1 and S2 (both email=null), User U2 (piet@x.com) owns S3 (email=null)
      prisma.meeting.findUnique.mockResolvedValue(makeMeeting());
      prisma.shareholder.findMany.mockResolvedValue([
        { id: 's1', email: null, user: { email: 'jan@x.com' }, firstName: 'Jan', lastName: 'A', coopId: 'c1' },
        { id: 's2', email: null, user: { email: 'jan@x.com' }, firstName: 'Jan', lastName: 'B', coopId: 'c1' },
        { id: 's3', email: null, user: { email: 'piet@x.com' }, firstName: 'Piet', lastName: 'C', coopId: 'c1' },
      ]);

      const result = await service.send('c1', 'm1', { confirmShortNotice: true });

      // result is { sent: Array<{to, shareholderIds}>, ... } — extract sent array
      expect(result).toHaveProperty('sent');
      const sent = (result as any).sent as Array<{ to: string; shareholderIds: string[] }>;
      expect(sent).toHaveLength(2);

      const recipients = sent.map((s) => s.to).sort();
      expect(recipients).toEqual(['jan@x.com', 'piet@x.com']);

      const jansEmail = sent.find((s) => s.to === 'jan@x.com')!;
      expect(jansEmail.shareholderIds).toHaveLength(2);
      expect(jansEmail.shareholderIds.sort()).toEqual(['s1', 's2']);

      // Email service should be called exactly twice (one per distinct inbox)
      expect(emailService.send).toHaveBeenCalledTimes(2);
    });

    it('skips attendees whose shareholders have no resolvable email (postal-only)', async () => {
      prisma.meeting.findUnique.mockResolvedValue(makeMeeting());
      prisma.shareholder.findMany.mockResolvedValue([
        { id: 's1', email: 'real@x.com', user: null, firstName: 'Real', lastName: 'Person', coopId: 'c1' },
        // postal-only: neither shareholder.email nor user.email
        { id: 's2', email: null, user: null, firstName: 'Postal', lastName: 'Only', coopId: 'c1' },
        { id: 's3', email: null, user: { email: null }, firstName: 'Also', lastName: 'Postal', coopId: 'c1' },
      ]);

      const result = await service.send('c1', 'm1', { confirmShortNotice: true });
      const sent = (result as any).sent as Array<{ to: string; shareholderIds: string[] }>;

      expect(sent.map((s) => s.to)).not.toContain(null);
      expect(sent).toHaveLength(1);
      expect(sent[0].to).toBe('real@x.com');
      expect(emailService.send).toHaveBeenCalledTimes(1);
    });
  });
});
