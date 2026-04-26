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
});
