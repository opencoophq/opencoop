import { normalize, levenshtein, matchByName } from './proxy-name-matcher';

describe('proxy-name-matcher', () => {
  describe('normalize', () => {
    it('lowercases', () => {
      expect(normalize('Jan Peeters')).toBe('jan peeters');
    });
    it('strips diacritics', () => {
      expect(normalize('Émile Müller')).toBe('emile muller');
    });
    it('collapses and trims whitespace', () => {
      expect(normalize('  Jan   Peeters  ')).toBe('jan peeters');
    });
  });

  describe('levenshtein', () => {
    it('returns 0 for identical strings', () => {
      expect(levenshtein('abc', 'abc')).toBe(0);
    });
    it('counts single-character substitutions', () => {
      expect(levenshtein('peters', 'peeters')).toBe(1);
    });
    it('counts multi-character differences', () => {
      expect(levenshtein('kitten', 'sitting')).toBe(3);
    });
    it('handles empty strings', () => {
      expect(levenshtein('', 'abc')).toBe(3);
      expect(levenshtein('abc', '')).toBe(3);
    });
  });

  describe('matchByName', () => {
    const candidates = [
      { id: 'a', firstName: 'Jan', lastName: 'Peeters' },
      { id: 'b', firstName: 'Maria', lastName: 'de Bruyn' },
      { id: 'c', firstName: 'Émile', lastName: 'Janssens' },
    ];

    it('returns unique on exact match (case + diacritic insensitive)', () => {
      expect(matchByName({ firstName: 'JAN', lastName: 'peeters' }, candidates)).toEqual({
        kind: 'unique',
        candidate: candidates[0],
      });
      expect(matchByName({ firstName: 'emile', lastName: 'janssens' }, candidates)).toEqual({
        kind: 'unique',
        candidate: candidates[2],
      });
    });

    it('returns ambiguous when two candidates share a normalised exact name', () => {
      const dupes = [
        { id: 'a', firstName: 'Jan', lastName: 'Peeters' },
        { id: 'b', firstName: 'jan', lastName: 'peeters' },
      ];
      expect(matchByName({ firstName: 'Jan', lastName: 'Peeters' }, dupes)).toEqual({
        kind: 'ambiguous',
      });
    });

    it('returns unique on close fuzzy match (typo)', () => {
      // "Jan Peters" vs "Jan Peeters" → distance 1, no other candidate close
      expect(matchByName({ firstName: 'Jan', lastName: 'Peters' }, candidates)).toEqual({
        kind: 'unique',
        candidate: candidates[0],
      });
    });

    it('returns not_found when no candidate is within threshold', () => {
      expect(matchByName({ firstName: 'Hans', lastName: 'Schmidt' }, candidates)).toEqual({
        kind: 'not_found',
      });
    });

    it('returns ambiguous when two candidates are equally close (gap < 2)', () => {
      const tied = [
        { id: 'a', firstName: 'Jan', lastName: 'Peters' },
        { id: 'b', firstName: 'Jan', lastName: 'Peeters' },
      ];
      // Query "Jan Petersz" → distance 1 to Peters, distance 2 to Peeters
      // Gap is 1 < 2 → ambiguous
      expect(matchByName({ firstName: 'Jan', lastName: 'Petersz' }, tied)).toEqual({
        kind: 'ambiguous',
      });
    });

    it('returns unique when best beats runner-up by ≥ 2', () => {
      const candidates2 = [
        { id: 'a', firstName: 'Jan', lastName: 'Peeters' }, // dist 1 to "Jan Peters"
        { id: 'b', firstName: 'Janus', lastName: 'Peeters' }, // dist 3 to "Jan Peters" (above threshold)
      ];
      expect(matchByName({ firstName: 'Jan', lastName: 'Peters' }, candidates2)).toEqual({
        kind: 'unique',
        candidate: candidates2[0],
      });
    });

    it('exact match wins over fuzzy candidates', () => {
      const candidates3 = [
        { id: 'a', firstName: 'Jan', lastName: 'Peters' }, // exact for "Jan Peters"
        { id: 'b', firstName: 'Jan', lastName: 'Peeters' }, // dist 1
      ];
      expect(matchByName({ firstName: 'Jan', lastName: 'Peters' }, candidates3)).toEqual({
        kind: 'unique',
        candidate: candidates3[0],
      });
    });
  });
});
