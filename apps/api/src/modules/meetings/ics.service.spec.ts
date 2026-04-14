import { Test } from '@nestjs/testing';
import { IcsService } from './ics.service';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ical = require('node-ical');

describe('IcsService', () => {
  let service: IcsService;
  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({ providers: [IcsService] }).compile();
    service = moduleRef.get(IcsService);
  });

  it('generates parseable iCalendar for a meeting', () => {
    const result = service.generate({
      uid: 'meeting-m1@opencoop.be',
      title: 'Jaarlijkse AV Bronsgroen',
      start: new Date('2026-05-09T10:00:00+02:00'),
      durationMinutes: 120,
      location: 'Theresiastraat 29, 3500 Hasselt',
      description: 'Agenda: ...',
      organizerName: 'Bronsgroen cv',
      organizerEmail: 'bestuur@bronsgroen.be',
    });
    expect(result).toContain('BEGIN:VCALENDAR');
    expect(result).toContain('SUMMARY:Jaarlijkse AV Bronsgroen');
    const parsed = ical.parseICS(result);
    const vevent = Object.values(parsed).find((x: any) => x.type === 'VEVENT');
    expect(vevent).toBeDefined();
  });
});
