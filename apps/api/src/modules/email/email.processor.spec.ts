import { EmailProcessor } from './email.processor';

describe('EmailProcessor', () => {
  const meetingDate = '2026-05-09T08:00:00.000Z';
  const originalMeetingTimeZone = process.env.MEETING_TIME_ZONE;

  beforeEach(() => {
    process.env.MEETING_TIME_ZONE = 'Europe/Brussels';
  });

  afterAll(() => {
    if (originalMeetingTimeZone === undefined) {
      delete process.env.MEETING_TIME_ZONE;
    } else {
      process.env.MEETING_TIME_ZONE = originalMeetingTimeZone;
    }
  });

  function createProcessor() {
    return new EmailProcessor({} as any);
  }

  it('renders Brussels time in convocation custom-body placeholders', () => {
    const processor = createProcessor();

    const html = processor.renderTemplate(
      'meeting-convocation',
      {
        language: 'nl',
        shareholderName: 'Jan Peeters',
        meetingTitle: 'Algemene Vergadering 2026',
        meetingDate,
        meetingLocation: 'Theresiastraat 29, 3500 Hasselt',
        agendaItems: [],
        rsvpUrl: 'https://opencoop.test/meetings/rsvp/token',
        customBody: '<p>{{meetingDate}}</p>',
        coopName: 'Bronsgroen',
      },
      'Bronsgroen',
    );

    expect(html).toContain('10:00');
    expect(html).not.toContain('08:00');
    expect(html).not.toContain(meetingDate);
  });

  it('renders Brussels time in RSVP confirmation emails', () => {
    const processor = createProcessor();

    const html = processor.renderTemplate(
      'meeting-rsvp-confirmation',
      {
        language: 'nl',
        shareholderName: 'Jan Peeters',
        meetingTitle: 'Algemene Vergadering 2026',
        meetingDate,
        meetingLocation: 'Theresiastraat 29, 3500 Hasselt',
        rsvpStatus: 'ATTENDING',
        coopName: 'Bronsgroen',
      },
      'Bronsgroen',
    );

    expect(html).toContain('10:00');
    expect(html).not.toContain('08:00');
    expect(html).not.toContain(meetingDate);
  });

  it('renders Brussels time in reminder emails', () => {
    const processor = createProcessor();

    const html = processor.renderTemplate(
      'meeting-reminder',
      {
        language: 'nl',
        shareholderName: 'Jan Peeters',
        meetingTitle: 'Algemene Vergadering 2026',
        meetingDate,
        daysUntil: 3,
        rsvpUrl: 'https://opencoop.test/meetings/rsvp/token',
      },
      'Bronsgroen',
    );

    expect(html).toContain('10:00');
    expect(html).not.toContain('08:00');
    expect(html).not.toContain(meetingDate);
  });

  describe('HTML escaping of user-controlled interpolations', () => {
    const xss = '<script>alert(1)</script>';

    it('escapes shareholder name and coop name in the welcome template', () => {
      const processor = createProcessor();

      const html = processor.renderTemplate(
        'welcome',
        { language: 'en', shareholderName: xss },
        'Coop & Co',
      );

      // Shareholder name must be escaped, not rendered as a live tag.
      expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
      expect(html).not.toContain('<script>alert(1)</script>');
      // Coop display name escaped (& -> &amp;).
      expect(html).toContain('Coop &amp; Co');
    });

    it('escapes shareholder name, meeting title and location in convocation', () => {
      const processor = createProcessor();

      const html = processor.renderTemplate(
        'meeting-convocation',
        {
          language: 'en',
          shareholderName: xss,
          meetingTitle: '<b>AGM</b>',
          meetingDate,
          meetingLocation: '<img src=x onerror=alert(1)>',
          agendaItems: [{ order: 1, title: '<i>Item</i>', description: '<u>desc</u>' }],
          rsvpUrl: 'https://opencoop.test/meetings/rsvp/token?a=1&b=2',
          coopName: 'Coop & Co',
        },
        'Coop & Co',
      );

      expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
      expect(html).not.toContain('<script>alert(1)</script>');
      expect(html).toContain('&lt;b&gt;AGM&lt;/b&gt;');
      expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
      expect(html).toContain('Coop &amp; Co');
      // Agenda items escaped too.
      expect(html).toContain('&lt;i&gt;Item&lt;/i&gt;');
      // The trusted RSVP URL must be left intact (query params NOT escaped).
      expect(html).toContain('href="https://opencoop.test/meetings/rsvp/token?a=1&b=2"');
    });

    it('escapes shareholder name and subject, but not messageBody, in message-notification', () => {
      const processor = createProcessor();

      const html = processor.renderTemplate(
        'message-notification',
        {
          language: 'en',
          shareholderName: xss,
          messageSubject: xss,
          messageBody: '<p>Trusted body</p>',
          inboxUrl: 'https://opencoop.test/inbox/1',
        },
        'Coop & Co',
      );

      expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
      expect(html).not.toContain('<script>alert(1)</script>');
      // messageBody is pre-sanitised HTML from message-body.ts; it is rendered unescaped by design.
      expect(html).toContain('<p>Trusted body</p>');
      // Trusted URL untouched.
      expect(html).toContain('href="https://opencoop.test/inbox/1"');
    });
  });

  describe('unknown template key', () => {
    it('throws instead of returning placeholder HTML', () => {
      expect(() => createProcessor().renderTemplate('no-such-template', {}, 'Coop')).toThrow(
        'Email template not found: no-such-template',
      );
    });

    it('marks the email log FAILED, rethrows and sends nothing', async () => {
      const prisma = {
        coop: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'coop-1',
            name: 'Coop',
            emailEnabled: true,
            emailProvider: null,
          }),
        },
        emailLog: { update: jest.fn().mockResolvedValue({}) },
      };
      const processor = new EmailProcessor(prisma as any);
      const sendViaPlatformSmtp = jest
        .spyOn(processor as any, 'sendViaPlatformSmtp')
        .mockResolvedValue(undefined);

      await expect(
        processor.handleSend({
          data: {
            emailLogId: 'log-1',
            coopId: 'coop-1',
            to: 'a@example.com',
            subject: 'Hi',
            templateKey: 'no-such-template',
            templateData: {},
          },
        } as any),
      ).rejects.toThrow('Email template not found: no-such-template');

      expect(sendViaPlatformSmtp).not.toHaveBeenCalled();
      expect(prisma.emailLog.update).toHaveBeenCalledWith({
        where: { id: 'log-1' },
        data: {
          status: 'FAILED',
          errorMessage: 'Email template not found: no-such-template',
        },
      });
    });
  });
});
