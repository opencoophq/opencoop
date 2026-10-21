import { BadRequestException } from '@nestjs/common';
import {
  DEFAULT_VOLUNTEER_INTERESTS,
  KNOWN_VOLUNTEER_INTERESTS,
  VOLUNTEER_CONSENT_TEXT_VERSION,
  VOLUNTEER_INTEREST_LABELS,
} from '@opencoop/shared';

/** Letters, numbers, spaces, underscores, slashes and hyphens. No apostrophes. */
export const VOLUNTEER_INTEREST_TAG = /^[\p{L}\p{N}][\p{L}\p{N} _/-]{0,39}$/u;

export const CONSENT_TEXT_VERSION = VOLUNTEER_CONSENT_TEXT_VERSION;
export const CONFIRM_TTL_DAYS = 14;
export const UNCONFIRMED_RETENTION_DAYS = 30;

const SHARE_FIELD_NAMES = [
  'nationalId',
  'registrations',
  'shares',
  'shareCount',
  'shareholder',
  'user',
  'bankIban',
  'userId',
  'shareholderId',
  'confirmTokenHash',
  'confirmToken',
  'withdrawToken',
  'quantity',
  'totalAmount',
] as const;

/** Columns a volunteer admin is allowed to read. shareholderId is mapped to memberLinked and dropped. */
export const VOLUNTEER_VIEW_SELECT = {
  id: true,
  name: true,
  email: true,
  phone: true,
  postalCode: true,
  municipality: true,
  interests: true,
  status: true,
  consentAt: true,
  consentTextVersion: true,
  createdAt: true,
  shareholderId: true,
} as const;

export const VOLUNTEER_VIEW_KEYS = [
  'id',
  'name',
  'email',
  'phone',
  'postalCode',
  'municipality',
  'interests',
  'status',
  'consentAt',
  'consentTextVersion',
  'memberLinked',
  'createdAt',
] as const;

export interface VolunteerView {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  postalCode: string;
  municipality: string;
  interests: string[];
  status: string;
  consentAt: string | null;
  consentTextVersion: string;
  memberLinked: boolean;
  createdAt: string;
}

export interface VolunteerFilter {
  municipality?: string;
  postalCode?: string;
  interest?: string;
  interests?: string[];
  volunteerIds?: string[];
}

export type VolunteerListStatus = 'PENDING_CONFIRMATION' | 'ACTIVE' | 'WITHDRAWN' | 'ALL';

export interface VolunteerInterestLabels {
  nl: string;
  fr: string;
  de: string;
  en: string;
}

export interface VolunteerInterestOption {
  tag: string;
  position: number;
  active: true;
  labels: VolunteerInterestLabels;
}

export interface VolunteerInterestUpdate {
  interests?: string[];
  add?: string[];
  rename?: { from: string; to: string }[];
  deactivate?: string[];
  reorder?: string[];
}

export function interestCatalog(stored: string[] | null | undefined): string[] {
  const cleaned = sanitizeInterestTags(stored ?? []);
  return cleaned.length > 0 ? cleaned : [...DEFAULT_VOLUNTEER_INTERESTS];
}

export function volunteerInterestLabel(tag: string): VolunteerInterestLabels {
  if ((KNOWN_VOLUNTEER_INTERESTS as readonly string[]).includes(tag)) {
    const labels = VOLUNTEER_INTEREST_LABELS[tag as (typeof KNOWN_VOLUNTEER_INTERESTS)[number]];
    return { ...labels };
  }
  return { nl: tag, fr: tag, de: tag, en: tag };
}

export function describeVolunteerInterests(stored: string[] | null | undefined): {
  source: 'configured' | 'default';
  options: VolunteerInterestOption[];
} {
  const configured = sanitizeInterestTags(stored ?? []).length > 0;
  return {
    source: configured ? 'configured' : 'default',
    options: interestCatalog(stored).map((tag, position) => ({
      tag,
      position,
      active: true,
      labels: volunteerInterestLabel(tag),
    })),
  };
}

/** Reject tags the sanitiser would drop or rewrite, including apostrophes and duplicates. */
export function assertExactInterestTags(tags: string[]): string[] {
  if (tags.length > 20) {
    throw new BadRequestException('At most 20 interest tags');
  }
  const cleaned = sanitizeInterestTags(tags);
  const unchanged =
    cleaned.length === tags.length && cleaned.every((tag, index) => tag === tags[index]);
  if (!unchanged) {
    throw new BadRequestException(
      'Interest tags may contain letters, numbers, spaces, underscores, slashes and hyphens only, with no duplicates',
    );
  }
  return cleaned;
}

export function hasVolunteerInterestUpdate(update: VolunteerInterestUpdate): boolean {
  return (
    update.interests !== undefined ||
    (update.add?.length ?? 0) > 0 ||
    (update.rename?.length ?? 0) > 0 ||
    (update.deactivate?.length ?? 0) > 0 ||
    (update.reorder?.length ?? 0) > 0
  );
}

/**
 * Next ordered form list. An empty `interests` array restores the built-in
 * defaults. Add, rename, reorder and deactivate edit the current list.
 * Deactivated tags are removed; there is no separate inactive row.
 * Rename does not rewrite tags already stored on sign-ups.
 */
export function applyVolunteerInterestUpdate(
  stored: string[] | null | undefined,
  update: VolunteerInterestUpdate,
): string[] {
  const hasOps =
    (update.add?.length ?? 0) > 0 ||
    (update.rename?.length ?? 0) > 0 ||
    (update.deactivate?.length ?? 0) > 0 ||
    (update.reorder?.length ?? 0) > 0;
  if (update.interests !== undefined && hasOps) {
    throw new BadRequestException('Send either a full interest list or one edit, not both');
  }
  if (update.interests !== undefined) {
    return assertExactInterestTags(update.interests);
  }

  let tags = [...interestCatalog(stored)];
  for (const change of update.rename ?? []) {
    const to = assertExactInterestTags([change.to])[0];
    const index = tags.findIndex((tag) => tag.toLowerCase() === change.from.trim().toLowerCase());
    if (index < 0) throw new BadRequestException(`Unknown interest: ${change.from}`);
    if (tags.some((tag, i) => i !== index && tag.toLowerCase() === to.toLowerCase())) {
      throw new BadRequestException('Duplicate interest');
    }
    tags[index] = to;
  }
  for (const raw of update.add ?? []) {
    const tag = assertExactInterestTags([raw])[0];
    if (tags.some((current) => current.toLowerCase() === tag.toLowerCase())) continue;
    if (tags.length >= 20) throw new BadRequestException('At most 20 interest tags');
    tags.push(tag);
  }
  for (const raw of update.deactivate ?? []) {
    const key = raw.trim().toLowerCase();
    tags = tags.filter((tag) => tag.toLowerCase() !== key);
  }
  if (tags.length === 0) {
    throw new BadRequestException(
      'Keep at least one interest, or send an empty interests list to restore the defaults',
    );
  }
  if (update.reorder) {
    const order = assertExactInterestTags(update.reorder);
    const same =
      order.length === tags.length &&
      order.every((tag) => tags.some((current) => current.toLowerCase() === tag.toLowerCase()));
    if (!same) {
      throw new BadRequestException('reorder must list exactly the current interests');
    }
    tags = order.map(
      (tag) => tags.find((current) => current.toLowerCase() === tag.toLowerCase()) as string,
    );
  }
  return tags;
}

export function sanitizeInterestTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const tag = raw.trim().replace(/\s+/g, ' ');
    if (!tag || tag.length > 40) continue;
    if (!VOLUNTEER_INTEREST_TAG.test(tag)) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= 20) break;
  }
  return out;
}

export function normalizeChosenInterests(chosen: string[], catalog: string[]): string[] {
  if (!chosen?.length) {
    throw new BadRequestException('Choose at least one interest');
  }
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const raw of chosen) {
    const match = catalog.find((tag) => tag.toLowerCase() === raw.trim().toLowerCase());
    if (!match) throw new BadRequestException('Unknown interest');
    if (seen.has(match)) continue;
    seen.add(match);
    normalized.push(match);
  }
  if (normalized.length === 0) {
    throw new BadRequestException('Choose at least one interest');
  }
  return normalized;
}

export function volunteerWhere(
  coopId: string,
  filter: VolunteerFilter,
  status: VolunteerListStatus = 'ACTIVE',
) {
  const where: Record<string, unknown> = { coopId };
  if (status !== 'ALL') where.status = status;
  const municipality = filter.municipality?.trim();
  if (municipality) {
    where.municipality = { equals: municipality, mode: 'insensitive' };
  }
  const postalCode = filter.postalCode?.trim();
  if (postalCode) {
    where.postalCode = { startsWith: postalCode };
  }
  const interests = (filter.interests ?? []).map((tag) => tag.trim()).filter(Boolean);
  if (interests.length > 0) {
    where.interests = { hasSome: interests };
  } else if (filter.interest?.trim()) {
    where.interests = { has: filter.interest.trim() };
  }
  if (filter.volunteerIds) {
    where.id = { in: filter.volunteerIds };
  }
  return where;
}

export function toVolunteerView(row: {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  postalCode: string;
  municipality: string;
  interests: string[];
  status: string;
  consentAt: Date | null;
  consentTextVersion: string;
  createdAt: Date;
  shareholderId?: string | null;
}): VolunteerView {
  const view: VolunteerView = {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    postalCode: row.postalCode,
    municipality: row.municipality,
    interests: [...row.interests],
    status: row.status,
    consentAt: row.consentAt ? row.consentAt.toISOString() : null,
    consentTextVersion: row.consentTextVersion,
    memberLinked: Boolean(row.shareholderId),
    createdAt: row.createdAt.toISOString(),
  };
  for (const forbidden of SHARE_FIELD_NAMES) {
    if (forbidden in view) {
      delete (view as unknown as Record<string, unknown>)[forbidden];
    }
  }
  return view;
}

function csvCell(value: string): string {
  let cell = value;
  if (/^[=+\-@]/.test(cell)) cell = `'${cell}`;
  if (/[",\n\r]/.test(cell)) return `"${cell.replace(/"/g, '""')}"`;
  return cell;
}

export function volunteersToCsv(rows: VolunteerView[]): string {
  const header = [
    'name',
    'email',
    'phone',
    'postalCode',
    'municipality',
    'interests',
    'status',
    'consentAt',
    'consentTextVersion',
    'memberLinked',
    'createdAt',
  ];
  const lines = rows.map((row) =>
    [
      row.name,
      row.email,
      row.phone ?? '',
      row.postalCode,
      row.municipality,
      row.interests.join('|'),
      row.status,
      row.consentAt ?? '',
      row.consentTextVersion,
      row.memberLinked ? 'yes' : 'no',
      row.createdAt,
    ]
      .map((value) => csvCell(String(value)))
      .join(','),
  );
  return `\uFEFF${[header.join(','), ...lines].join('\n')}\n`;
}

export function addressParts(address: unknown): { postalCode: string; municipality: string } {
  if (!address || typeof address !== 'object') return { postalCode: '', municipality: '' };
  const record = address as Record<string, unknown>;
  return {
    postalCode: typeof record.postalCode === 'string' ? record.postalCode : '',
    municipality: typeof record.city === 'string' ? record.city : '',
  };
}

export function displayName(person: {
  type: string;
  companyName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
}): string {
  if (person.type === 'COMPANY' && person.companyName?.trim()) return person.companyName.trim();
  return [person.firstName, person.lastName].filter(Boolean).join(' ').trim();
}
