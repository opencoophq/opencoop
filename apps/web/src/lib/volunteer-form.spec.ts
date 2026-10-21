import { DEFAULT_VOLUNTEER_INTERESTS } from '@opencoop/shared';
import { isKnownInterest, isVolunteerSignupValid, parseInterestList } from './volunteer-form';

const valid = {
  name: 'An Peeters',
  email: 'an@example.be',
  postalCode: '3600',
  municipality: 'Genk',
  interests: ['flyers'],
  consent: true,
};

describe('volunteer signup validation', () => {
  it('accepts a complete signup with consent', () => {
    expect(isVolunteerSignupValid(valid)).toBe(true);
  });

  it('rejects a missing consent checkbox', () => {
    expect(isVolunteerSignupValid({ ...valid, consent: false })).toBe(false);
  });

  it('rejects an empty interest list', () => {
    expect(isVolunteerSignupValid({ ...valid, interests: [] })).toBe(false);
  });

  it('rejects a missing municipality or postcode', () => {
    expect(isVolunteerSignupValid({ ...valid, municipality: '  ' })).toBe(false);
    expect(isVolunteerSignupValid({ ...valid, postalCode: '' })).toBe(false);
  });

  it('parses comma-separated tags without duplicates', () => {
    expect(parseInterestList(' flyers, Flyers, keuken ')).toEqual(['flyers', 'keuken']);
  });

  it('translates board without making it a default tag', () => {
    expect(isKnownInterest('board')).toBe(true);
    expect(isKnownInterest('technical')).toBe(true);
    expect(isKnownInterest('technisch')).toBe(false);
    expect(isKnownInterest('administratie')).toBe(false);
    expect(DEFAULT_VOLUNTEER_INTERESTS).not.toContain('board');
  });
});
