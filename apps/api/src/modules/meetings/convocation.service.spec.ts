import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ConvocationService } from './convocation.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { EmailProcessor } from '../email/email.processor';

describe('ConvocationService', () => {
  let service: ConvocationService;
  let prisma: any;
  let emailService: any;
  let emailProcessor: any;

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
      coop: { name: 'Co', minConvocationDays: 15 },
      convocationSentAt: null,
      customSubject: null,
      customBody: null,
      ...overrides,
    };
  }

  beforeEach(async () => {
    emailService = { send: jest.fn().mockResolvedValue(undefined) };
    emailProcessor = { renderTemplate: jest.fn().mockReturnValue('<html>preview</html>') };
    prisma = {
      meeting: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
      shareholder: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn() },
      meetingAttendance: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        ConvocationService,
        { provide: PrismaService, useValue: prisma },
        { provide: EmailService, useValue: emailService },
        { provide: EmailProcessor, useValue: emailProcessor },
      ],
    }).compile();
    service = moduleRef.get(ConvocationService);
  });

  describe('notice-period validation', () => {
    it('rejects convocation less than the coop-configured minimum days without override', async () => {
      const scheduledAt = new Date(Date.now() + 10 * 24 * 3600 * 1000);
      prisma.meeting.findUnique.mockResolvedValue(makeMeeting({ scheduledAt }));
      await expect(service.send('c1', 'm1', { confirmShortNotice: false })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('honors a custom per-coop minConvocationDays (e.g. Bronsgroen at 14)', async () => {
      // 14 days away passes the check for a coop configured with min=14.
      const scheduledAt = new Date(Date.now() + 14 * 24 * 3600 * 1000 + 60_000);
      prisma.meeting.findUnique.mockResolvedValue(
        makeMeeting({ scheduledAt, coop: { name: 'Co', minConvocationDays: 14 } }),
      );
      // Empty shareholder list — focus is the threshold, not the send.
      prisma.shareholder.findMany.mockResolvedValue([]);
      await expect(service.send('c1', 'm1', {})).resolves.toBeDefined();
    });

    it('rejects a 14-day-away convocation when the coop requires the WVV-default 15', async () => {
      const scheduledAt = new Date(Date.now() + 14 * 24 * 3600 * 1000);
      prisma.meeting.findUnique.mockResolvedValue(
        makeMeeting({ scheduledAt, coop: { name: 'Co', minConvocationDays: 15 } }),
      );
      await expect(service.send('c1', 'm1', {})).rejects.toThrow(BadRequestException);
    });

    it('allows short notice if confirmed (no shareholders = not marked CONVOKED)', async () => {
      const scheduledAt = new Date(Date.now() + 10 * 24 * 3600 * 1000);
      prisma.meeting.findUnique.mockResolvedValue(makeMeeting({ scheduledAt }));
      prisma.shareholder.findMany.mockResolvedValue([]);
      const result = await service.send('c1', 'm1', { confirmShortNotice: true });
      // No shareholders to send to → returns alreadySent for empty needsSend set.
      expect(prisma.meeting.update).not.toHaveBeenCalled();
      expect(result).toEqual({ alreadySent: true });
    });
  });

  describe('retry safety', () => {
    it('returns alreadySent when every shareholder has convocationSentAt set', async () => {
      prisma.meeting.findUnique.mockResolvedValue(makeMeeting());
      prisma.shareholder.findMany.mockResolvedValue([
        { id: 's1', email: 'a@x.com', user: null, firstName: 'A', lastName: 'X' },
      ]);
      prisma.meetingAttendance.findMany.mockResolvedValue([
        { shareholderId: 's1', rsvpToken: 'tok-s1', convocationSentAt: new Date() },
      ]);

      const res = await service.send('c1', 'm1', {});

      expect(res).toEqual({ alreadySent: true });
      expect(emailService.send).not.toHaveBeenCalled();
      expect(prisma.meetingAttendance.create).not.toHaveBeenCalled();
    });

    it('re-sends only to shareholders without convocationSentAt (partial-failure recovery)', async () => {
      prisma.meeting.findUnique.mockResolvedValue(makeMeeting());
      prisma.shareholder.findMany.mockResolvedValue([
        { id: 's1', email: 'a@x.com', user: null, firstName: 'A', lastName: 'X' },
        { id: 's2', email: 'b@x.com', user: null, firstName: 'B', lastName: 'X' },
        { id: 's3', email: 'c@x.com', user: null, firstName: 'C', lastName: 'X' },
      ]);
      // s1 already mailed; s2 and s3 are still pending (e.g. previous send failed for them).
      prisma.meetingAttendance.findMany.mockResolvedValue([
        { shareholderId: 's1', rsvpToken: 'tok-s1', convocationSentAt: new Date() },
        { shareholderId: 's2', rsvpToken: 'tok-s2', convocationSentAt: null },
        { shareholderId: 's3', rsvpToken: 'tok-s3', convocationSentAt: null },
      ]);

      const res = await service.send('c1', 'm1', {});
      const sent = (res as any).sent as Array<{ to: string; shareholderIds: string[] }>;

      expect(sent.map((s) => s.to).sort()).toEqual(['b@x.com', 'c@x.com']);
      expect(emailService.send).toHaveBeenCalledTimes(2);
      expect(prisma.meetingAttendance.create).not.toHaveBeenCalled(); // existing attendances reused
    });

    it('preserves existing rsvpToken on retry — does not rotate it', async () => {
      prisma.meeting.findUnique.mockResolvedValue(makeMeeting());
      prisma.shareholder.findMany.mockResolvedValue([
        { id: 's1', email: 'a@x.com', user: null, firstName: 'A', lastName: 'X' },
      ]);
      prisma.meetingAttendance.findMany.mockResolvedValue([
        { shareholderId: 's1', rsvpToken: 'persisted-token', convocationSentAt: null },
      ]);

      await service.send('c1', 'm1', {});

      expect(prisma.meetingAttendance.create).not.toHaveBeenCalled();
      const sentCall = emailService.send.mock.calls[0][0];
      expect(sentCall.templateData.rsvpUrl).toContain('persisted-token');
    });

    it('marks convocationSentAt for all shareholders in a successfully-mailed inbox group', async () => {
      prisma.meeting.findUnique.mockResolvedValue(makeMeeting());
      prisma.shareholder.findMany.mockResolvedValue([
        { id: 's1', email: null, user: { email: 'shared@x.com' }, firstName: 'A', lastName: '' },
        { id: 's2', email: null, user: { email: 'shared@x.com' }, firstName: 'B', lastName: '' },
      ]);
      // No prior attendances → both will be created fresh.
      prisma.meetingAttendance.findMany.mockResolvedValue([]);

      await service.send('c1', 'm1', { confirmShortNotice: true });

      expect(prisma.meetingAttendance.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { meetingId: 'm1', shareholderId: { in: expect.arrayContaining(['s1', 's2']) } },
          data: { convocationSentAt: expect.any(Date) },
        }),
      );
    });

    it('does not mark convocationSentAt when the email send throws', async () => {
      prisma.meeting.findUnique.mockResolvedValue(makeMeeting());
      prisma.shareholder.findMany.mockResolvedValue([
        { id: 's1', email: 'a@x.com', user: null, firstName: 'A', lastName: 'X' },
      ]);
      prisma.meetingAttendance.findMany.mockResolvedValue([]);
      emailService.send.mockRejectedValueOnce(new Error('SMTP exploded'));

      const res = await service.send('c1', 'm1', { confirmShortNotice: true });

      expect(prisma.meetingAttendance.updateMany).not.toHaveBeenCalled();
      const failures = (res as any).failures;
      expect(failures).toHaveLength(1);
      expect(failures[0].to).toBe('a@x.com');
      // All-fail → meeting NOT marked CONVOKED so admin can retry.
      expect(prisma.meeting.update).not.toHaveBeenCalled();
    });
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

      expect(emailService.send).toHaveBeenCalledTimes(2);
      expect(result.sent).toBe(2);

      const recipients = emailService.send.mock.calls.map((c: any[]) => c[0].to).sort();
      expect(recipients).toEqual(['jan@x.com', 'piet@x.com']);

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
      prisma.meeting.findUnique.mockResolvedValue(makeMeeting());
      prisma.shareholder.findMany.mockResolvedValue([
        { id: 's1', email: null, user: { email: 'jan@x.com' }, firstName: 'Jan', lastName: 'A', coopId: 'c1' },
        { id: 's2', email: null, user: { email: 'jan@x.com' }, firstName: 'Jan', lastName: 'B', coopId: 'c1' },
        { id: 's3', email: null, user: { email: 'piet@x.com' }, firstName: 'Piet', lastName: 'C', coopId: 'c1' },
      ]);

      const result = await service.send('c1', 'm1', { confirmShortNotice: true });

      expect(result).toHaveProperty('sent');
      const sent = (result as any).sent as Array<{ to: string; shareholderIds: string[] }>;
      expect(sent).toHaveLength(2);

      const recipients = sent.map((s) => s.to).sort();
      expect(recipients).toEqual(['jan@x.com', 'piet@x.com']);

      const jansEmail = sent.find((s) => s.to === 'jan@x.com')!;
      expect(jansEmail.shareholderIds).toHaveLength(2);
      expect(jansEmail.shareholderIds.sort()).toEqual(['s1', 's2']);

      expect(emailService.send).toHaveBeenCalledTimes(2);
    });

    it('skips attendees whose shareholders have no resolvable email (postal-only)', async () => {
      prisma.meeting.findUnique.mockResolvedValue(makeMeeting());
      prisma.shareholder.findMany.mockResolvedValue([
        { id: 's1', email: 'real@x.com', user: null, firstName: 'Real', lastName: 'Person', coopId: 'c1' },
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
