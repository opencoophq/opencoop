import { EmailProcessor } from './email.processor';

/**
 * Byte-exact render snapshots for EVERY transactional email template in ALL 4
 * supported languages (nl/en/fr/de). This is the safety net for the
 * locale-JSON refactor: the rendered HTML must remain byte-identical before and
 * after copy is moved out of TypeScript. Do NOT run with --updateSnapshot to
 * paper over diffs — a changed snapshot means the migration changed an email.
 */
describe('EmailProcessor render snapshots (byte-exact baseline)', () => {
  const meetingDate = '2026-05-09T08:00:00.000Z';
  const coopName = 'Coöp & Co';
  const languages = ['nl', 'en', 'fr', 'de'] as const;
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

  // Per-template representative sample data (excluding `language`, which is
  // injected per-case below). Construct data that exercises each field the
  // template reads, including the conditional branches.
  const sampleData: Record<string, Record<string, unknown>> = {
    welcome: {
      shareholderName: 'Jan Peeters',
    },
    'share-purchase': {
      shareholderName: 'Jan Peeters',
      shareClassName: 'Aandeel A',
      quantity: 3,
      totalAmount: 75,
      bankIban: 'BE68 5390 0754 7034',
      ogmCode: '+++123/4567/89012+++',
    },
    'payment-confirmed': {
      shareholderName: 'Jan Peeters',
      amount: 75,
      dashboardUrl: 'https://opencoop.test/dashboard',
    },
    'dividend-statement': {
      shareholderName: 'Jan Peeters',
      year: 2025,
      netAmount: 42.5,
    },
    'password-reset': {
      resetUrl: 'https://opencoop.test/reset?token=abc123',
    },
    'magic-link': {
      magicLinkUrl: 'https://opencoop.test/magic?token=abc123',
    },
    'minor-turned-adult': {
      firstName: 'Lotte',
      loginUrl: 'https://opencoop.test/login',
    },
    'parent-minor-turned-adult': {
      minorFirstName: 'Lotte',
      minorLastName: 'Janssens',
    },
    'minor-upgrade-notification': {
      minorFirstName: 'Lotte',
      minorLastName: 'Janssens',
      upgradeUrl: 'https://opencoop.test/upgrade?token=abc123',
    },
    'minor-upgrade-reminder': {
      minorFirstName: 'Lotte',
      minorLastName: 'Janssens',
      daysRemaining: 30,
      upgradeUrl: 'https://opencoop.test/upgrade?token=abc123',
    },
    'set-minor-email-reminder': {
      minorFirstName: 'Lotte',
      minorLastName: 'Janssens',
      yearsUntil18: 4,
      dashboardUrl: 'https://opencoop.test/dashboard',
    },
    'gift-certificate': {
      buyerName: 'Marie Dubois',
      shareClassName: 'Aandeel A',
      quantity: 2,
      totalValue: 50,
      giftCode: 'GIFT-1234',
    },
    'message-notification': {
      shareholderName: 'Jan Peeters',
      messageSubject: 'Belangrijk nieuws',
      messagePreview: 'Dit is een voorbeeld van een bericht.',
      inboxUrl: 'https://opencoop.test/inbox/1',
    },
    'admin-message-notification': {
      adminName: 'Beheerder',
      messageSubject: 'Belangrijk nieuws',
      messagePreview: 'Dit is een voorbeeld van een bericht.',
    },
    'admin-event-notification': {
      adminName: 'Beheerder',
      coopName: 'Coöp & Co',
      event: 'share_purchase',
      data: {
        shareholderName: 'Jan Peeters',
        shareClassName: 'Aandeel A',
        quantity: 3,
        totalAmount: 75,
        paymentAmount: 75,
      },
    },
    'admin-digest': {
      adminName: 'Beheerder',
      coopName: 'Coöp & Co',
      frequency: 'WEEKLY',
      events: [
        {
          event: 'new_shareholder',
          data: { shareholderName: 'Jan Peeters' },
        },
        {
          event: 'share_purchase',
          data: {
            shareholderName: 'Marie Dubois',
            shareClassName: 'Aandeel A',
            quantity: 2,
            totalAmount: 50,
          },
        },
        {
          event: 'payment_received',
          data: { shareholderName: 'Marie Dubois', paymentAmount: 50 },
        },
      ],
    },
    'meeting-convocation': {
      shareholderName: 'Jan Peeters',
      meetingTitle: 'Algemene Vergadering 2026',
      meetingDate,
      meetingLocation: 'Theresiastraat 29, 3500 Hasselt',
      agendaItems: [
        { order: 2, title: 'Tweede punt', description: 'Beschrijving twee' },
        { order: 1, title: 'Eerste punt', description: 'Beschrijving een' },
      ],
      rsvpUrl: 'https://opencoop.test/meetings/rsvp/token?a=1&b=2',
      coopName: 'Coöp & Co',
      coopLogoUrl: 'https://opencoop.test/logo.png',
      coopPrimaryColor: '#0E7C66',
    },
    'meeting-rsvp-confirmation': {
      shareholderName: 'Jan Peeters',
      meetingTitle: 'Algemene Vergadering 2026',
      meetingDate,
      meetingLocation: 'Theresiastraat 29, 3500 Hasselt',
      rsvpStatus: 'PROXY',
      delegateName: 'Marie Dubois',
      rsvpUrl: 'https://opencoop.test/meetings/rsvp/token',
      coopName: 'Coöp & Co',
      coopLogoUrl: 'https://opencoop.test/logo.png',
      coopPrimaryColor: '#0E7C66',
    },
    'meeting-reminder': {
      shareholderName: 'Jan Peeters',
      meetingTitle: 'Algemene Vergadering 2026',
      meetingDate,
      daysUntil: 3,
      rsvpUrl: 'https://opencoop.test/meetings/rsvp/token',
    },
    'referral-success': {
      referrerName: 'Jan Peeters',
      referredName: 'Marie Dubois',
      dashboardUrl: 'https://opencoop.test/dashboard',
    },
    'agenda-documents': {
      introHtml: '<p>Beste aandeelhouder, hier zijn de documenten.</p>',
      documents: [
        { fileName: 'Jaarverslag.pdf', downloadUrl: 'https://opencoop.test/doc/1' },
        { fileName: 'Balans.xlsx', downloadUrl: 'https://opencoop.test/doc/2' },
      ],
      meetingTitle: 'Algemene Vergadering 2026',
      meetingScheduledAt: '9 mei 2026 om 10:00',
      rsvpUrl: 'https://opencoop.test/meetings/rsvp/token',
      pixelUrl: 'https://opencoop.test/pixel.gif',
    },
  };

  const templateKeys = Object.keys(sampleData);

  // Cover the meeting-convocation custom-body branch separately — it has a
  // distinct code path that performs placeholder substitution.
  const extraCases: Array<{ name: string; key: string; data: Record<string, unknown> }> = [
    {
      name: 'meeting-convocation (custom body)',
      key: 'meeting-convocation',
      data: {
        shareholderName: 'Jan Peeters',
        meetingTitle: 'Algemene Vergadering 2026',
        meetingDate,
        meetingLocation: 'Theresiastraat 29, 3500 Hasselt',
        agendaItems: [{ order: 1, title: 'Eerste punt', description: 'Beschrijving een' }],
        rsvpUrl: 'https://opencoop.test/meetings/rsvp/token',
        customBody:
          '<p>Beste {{shareholderName}}, kom naar {{meetingTitle}} op {{meetingDate}} te {{meetingLocation}}.</p>{{agendaList}}<p>Groeten van {{coopName}}.</p>',
        coopName: 'Coöp & Co',
      },
    },
    {
      name: 'meeting-rsvp-confirmation (absent)',
      key: 'meeting-rsvp-confirmation',
      data: {
        shareholderName: 'Jan Peeters',
        meetingTitle: 'Algemene Vergadering 2026',
        meetingDate,
        meetingLocation: 'Theresiastraat 29, 3500 Hasselt',
        rsvpStatus: 'ABSENT',
        rsvpUrl: 'https://opencoop.test/meetings/rsvp/token',
        coopName: 'Coöp & Co',
      },
    },
    {
      name: 'meeting-rsvp-confirmation (attending, no location/logo)',
      key: 'meeting-rsvp-confirmation',
      data: {
        shareholderName: 'Jan Peeters',
        meetingTitle: 'Algemene Vergadering 2026',
        meetingDate,
        rsvpStatus: 'ATTENDING',
        coopName: 'Coöp & Co',
      },
    },
  ];

  describe.each(templateKeys)('template "%s"', (key) => {
    it.each(languages)('renders in %s', (lang) => {
      const processor = createProcessor();
      const data = { ...sampleData[key], language: lang };
      const html = processor.renderTemplate(key, data, coopName);
      expect(typeof html).toBe('string');
      expect(html.length).toBeGreaterThan(0);
      expect(html).toMatchSnapshot();
    });
  });

  describe('additional branch cases', () => {
    extraCases.forEach((c) => {
      it.each(languages)(`${c.name} in %s`, (lang) => {
        const processor = createProcessor();
        const data = { ...c.data, language: lang };
        const html = processor.renderTemplate(c.key, data, coopName);
        expect(typeof html).toBe('string');
        expect(html.length).toBeGreaterThan(0);
        expect(html).toMatchSnapshot();
      });
    });
  });
});
