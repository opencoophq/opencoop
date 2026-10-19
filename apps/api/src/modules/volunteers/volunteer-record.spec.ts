import {
  VOLUNTEER_VIEW_KEYS,
  VOLUNTEER_VIEW_SELECT,
  interestCatalog,
  toVolunteerView,
  volunteerWhere,
  volunteersToCsv,
} from './volunteer-record';

describe('volunteer records stay clear of the share register', () => {
  const row = {
    id: 'v1',
    name: 'An Peeters',
    email: 'an@example.be',
    phone: null,
    postalCode: '3600',
    municipality: 'Genk',
    interests: ['flyers'],
    status: 'ACTIVE',
    consentAt: new Date('2026-10-19T08:00:00.000Z'),
    consentTextVersion: 'volunteer-consent-v1',
    createdAt: new Date('2026-10-19T08:00:00.000Z'),
    shareholderId: 'sh-1',
    nationalId: '00.00.00-000.00',
    registrations: [{ quantity: 12, totalAmount: 300 }],
    shareholder: { nationalId: '00.00.00-000.00', registrations: [{ quantity: 12 }] },
    bankIban: 'BE00',
    withdrawToken: 'secret',
  };

  it('exposes only volunteer fields, with a member flag instead of a shareholder id', () => {
    const view = toVolunteerView(row);
    expect(Object.keys(view).sort()).toEqual([...VOLUNTEER_VIEW_KEYS].sort());
    expect(view.memberLinked).toBe(true);
    expect(JSON.stringify(view)).not.toContain('nationalId');
    expect(JSON.stringify(view)).not.toContain('registrations');
    expect(JSON.stringify(view)).not.toContain('sh-1');
    expect(JSON.stringify(view)).not.toContain('secret');
    expect(JSON.stringify(view)).not.toContain('BE00');
  });

  it('does not select shareholding columns', () => {
    const selected = Object.keys(VOLUNTEER_VIEW_SELECT);
    for (const forbidden of [
      'nationalId',
      'registrations',
      'address',
      'bankIban',
      'user',
      'shareholder',
    ]) {
      expect(selected).not.toContain(forbidden);
    }
  });

  it('filters volunteers inside one coop and never joins shareholders', () => {
    const where = volunteerWhere('coop-1', {
      municipality: 'Genk',
      postalCode: '360',
      interest: 'flyers',
    });
    expect(where).toEqual({
      coopId: 'coop-1',
      status: 'ACTIVE',
      municipality: { equals: 'Genk', mode: 'insensitive' },
      postalCode: { startsWith: '360' },
      interests: { has: 'flyers' },
    });
    expect(where).not.toHaveProperty('shareholder');
    expect(where).not.toHaveProperty('registrations');
  });

  it('uses the default interest tags when a coop has not configured any', () => {
    expect(interestCatalog([])).toEqual(['flyers', 'stands', 'workshops', 'technical', 'admin']);
    expect(interestCatalog([' flyers ', 'Keuken'])).toEqual(['flyers', 'Keuken']);
  });

  it('exports csv without share columns and neutralises spreadsheet formulas', () => {
    const csv = volunteersToCsv([toVolunteerView({ ...row, name: '=cmd', shareholderId: null })]);
    expect(csv).toContain("'=cmd");
    expect(csv).not.toContain('nationalId');
    expect(csv).not.toContain('quantity');
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.slice(1).split('\n')[0]).toBe(
      'name,email,phone,postalCode,municipality,interests,status,consentAt,consentTextVersion,memberLinked,createdAt',
    );
  });

  it('matches nobody when the volunteer id list is empty', () => {
    expect(volunteerWhere('coop-1', { volunteerIds: [] })).toEqual({
      coopId: 'coop-1',
      status: 'ACTIVE',
      id: { in: [] },
    });
  });
});
