import { readFileSync } from 'fs';
import { join } from 'path';
import { BadRequestException } from '@nestjs/common';
import { KNOWN_VOLUNTEER_INTERESTS, VOLUNTEER_INTEREST_LABELS } from '@opencoop/shared';
import {
  VOLUNTEER_VIEW_KEYS,
  VOLUNTEER_VIEW_SELECT,
  applyVolunteerInterestUpdate,
  describeVolunteerInterests,
  interestCatalog,
  sanitizeInterestTags,
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
    expect(interestCatalog([])).not.toContain('board');
    expect(interestCatalog([' flyers ', 'Keuken'])).toEqual(['flyers', 'Keuken']);
    expect(interestCatalog(['evenementen/standen'])).toEqual(['evenementen/standen']);
    expect(sanitizeInterestTags(['bad!tag', "Conseil d'administration"])).toEqual([]);
  });

  it('lists every status when asked and still scopes the query to one coop', () => {
    expect(volunteerWhere('coop-1', { interest: 'board' }, 'ALL')).toEqual({
      coopId: 'coop-1',
      interests: { has: 'board' },
    });
  });

  it('renames, appends, reorders and deactivates without adding board to the defaults', () => {
    const bronsgroen = ['flyers', 'stands', 'workshops', 'technisch', 'administratie'];
    expect(
      applyVolunteerInterestUpdate(bronsgroen, {
        rename: [
          { from: 'technisch', to: 'technical' },
          { from: 'administratie', to: 'admin' },
        ],
        add: ['board'],
      }),
    ).toEqual(['flyers', 'stands', 'workshops', 'technical', 'admin', 'board']);

    expect(
      applyVolunteerInterestUpdate(
        ['flyers', 'stands', 'workshops', 'technical', 'admin', 'board'],
        {
          deactivate: ['board'],
          reorder: ['admin', 'technical', 'workshops', 'stands', 'flyers'],
        },
      ),
    ).toEqual(['admin', 'technical', 'workshops', 'stands', 'flyers']);

    expect(applyVolunteerInterestUpdate([], { add: ['board'] })).toEqual([
      'flyers',
      'stands',
      'workshops',
      'technical',
      'admin',
      'board',
    ]);
    expect(() => applyVolunteerInterestUpdate([], { add: ["Conseil d'administration"] })).toThrow(
      BadRequestException,
    );
    expect(describeVolunteerInterests([]).options.map((option) => option.tag)).not.toContain(
      'board',
    );
    expect(describeVolunteerInterests(['technisch']).options[0].labels.nl).toBe('technisch');
    expect(describeVolunteerInterests(['board']).options[0].labels.fr).toBe(
      "Conseil d'administration",
    );
  });

  it('keeps the four message catalogs aligned with the known interest labels', () => {
    for (const locale of ['nl', 'fr', 'de', 'en'] as const) {
      const messages = JSON.parse(
        readFileSync(join(__dirname, '../../../../web/messages', `${locale}.json`), 'utf8'),
      ) as { volunteers: { interestTags: Record<string, string> } };
      for (const tag of KNOWN_VOLUNTEER_INTERESTS) {
        expect(messages.volunteers.interestTags[tag]).toBe(VOLUNTEER_INTEREST_LABELS[tag][locale]);
      }
    }
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
