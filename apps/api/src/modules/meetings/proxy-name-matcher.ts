export interface NameCandidate {
  id: string;
  firstName: string | null;
  lastName: string | null;
}

export interface NameQuery {
  firstName: string;
  lastName: string;
}

export type MatchResult =
  | { kind: 'unique'; candidate: NameCandidate }
  | { kind: 'ambiguous' }
  | { kind: 'not_found' };

export function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prev = new Array(b.length + 1);
  let curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1, // insertion
        prev[j] + 1, // deletion
        prev[j - 1] + cost, // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

function fullName(c: { firstName: string | null; lastName: string | null }): string {
  return normalize(`${c.firstName ?? ''} ${c.lastName ?? ''}`);
}

export function matchByName(query: NameQuery, candidates: NameCandidate[]): MatchResult {
  const q = normalize(`${query.firstName} ${query.lastName}`);
  if (!q) return { kind: 'not_found' };

  // Pass 1: exact match on normalised full name
  const exact = candidates.filter((c) => fullName(c) === q);
  if (exact.length === 1) return { kind: 'unique', candidate: exact[0] };
  if (exact.length >= 2) return { kind: 'ambiguous' };

  // Pass 2: Levenshtein with length-scaled threshold
  const threshold = Math.max(2, Math.floor(q.length * 0.2));
  const scored = candidates
    .map((c) => ({ c, d: levenshtein(fullName(c), q) }))
    .filter((x) => x.d <= threshold)
    .sort((a, b) => a.d - b.d);

  if (scored.length === 0) return { kind: 'not_found' };
  if (scored.length === 1) return { kind: 'unique', candidate: scored[0].c };

  // Multiple within threshold: best must beat runner-up by ≥ 2
  if (scored[1].d - scored[0].d >= 2) {
    return { kind: 'unique', candidate: scored[0].c };
  }
  return { kind: 'ambiguous' };
}
