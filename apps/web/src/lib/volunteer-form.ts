import { DEFAULT_VOLUNTEER_INTERESTS } from '@opencoop/shared';

export { DEFAULT_VOLUNTEER_INTERESTS };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseInterestList(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(',')) {
    const tag = part.trim().replace(/\s+/g, ' ');
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}

export function isKnownInterest(tag: string): boolean {
  return (DEFAULT_VOLUNTEER_INTERESTS as readonly string[]).includes(tag);
}

export interface VolunteerSignupInput {
  name: string;
  email: string;
  postalCode: string;
  municipality: string;
  interests: string[];
  consent: boolean;
}

/** Client-side mirror of the public signup rules. The API remains the source of truth. */
export function isVolunteerSignupValid(input: VolunteerSignupInput): boolean {
  return (
    input.name.trim().length > 0 &&
    EMAIL.test(input.email.trim()) &&
    input.postalCode.trim().length > 0 &&
    input.municipality.trim().length > 0 &&
    input.interests.length > 0 &&
    input.consent === true
  );
}
