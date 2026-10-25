import { sentryEnvironment } from '../../sentry-environment';

export const DEFAULT_COOP_SIGNUP_NOTIFY_EMAIL = 'info@opencoop.be';

export interface CoopCreatedNotice {
  coopId: string;
  name: string;
  slug: string;
  plan: string;
  legalForm?: string | null;
  country?: string | null;
  adminEmail?: string | null;
  language?: string | null;
  createdAt: Date | string;
  source: 'self-signup' | 'superadmin';
  createdByEmail?: string | null;
}

/**
 * Recipient for the internal "a coop was created" mail.
 * Unset or blank keeps the default. `off` disables sending so acceptance can
 * stay quiet without a code change. Non-production subjects are prefixed with
 * the environment (`[acc]`, `[development]`, …) so those mails can be filtered.
 * Production mail has no prefix and does not name its environment.
 */
export function coopSignupNotifyRecipient(
  raw: string | undefined,
): string | null {
  if (raw === undefined || raw.trim() === '') return DEFAULT_COOP_SIGNUP_NOTIFY_EMAIL;
  const value = raw.trim().replace(/[\r\n]/g, '');
  if (value.toLowerCase() === 'off') return null;
  return value;
}

export function countryFromAddress(address: unknown): string | null {
  if (!address || typeof address !== 'object' || Array.isArray(address)) return null;
  const country = (address as { country?: unknown }).country;
  if (typeof country !== 'string') return null;
  const trimmed = country.trim();
  return trimmed ? trimmed : null;
}

export function coopPlatformUrl(coopId: string, frontendUrl?: string): string {
  const base = (frontendUrl || 'http://localhost:3002').replace(/\/$/, '');
  return `${base}/nl/dashboard/system/coops/${encodeURIComponent(coopId)}/admins`;
}

export function buildCoopCreatedMail(
  notice: CoopCreatedNotice,
  env: NodeJS.ProcessEnv = process.env,
): { to: string; subject: string; text: string } | null {
  const to = coopSignupNotifyRecipient(env.COOP_SIGNUP_NOTIFY_EMAIL);
  if (!to) return null;

  const environment = visibleEnvironment(env.FRONTEND_URL, env.SENTRY_ENVIRONMENT, env.NODE_ENV);
  const sourceLabel = notice.source === 'self-signup' ? 'zelfregistratie' : 'superadmin';
  const createdAt = notice.createdAt instanceof Date ? notice.createdAt : new Date(notice.createdAt);
  const when = Number.isNaN(createdAt.getTime())
    ? String(notice.createdAt)
    : `${formatBrussels(createdAt)} (${createdAt.toISOString()})`;

  const lines = [
    `Er is een nieuwe coöperatie aangemaakt via ${sourceLabel}.`,
    '',
    `Naam: ${oneLine(notice.name)}`,
    `Slug: ${oneLine(notice.slug)}`,
    `Plan: ${oneLine(notice.plan)}`,
    `Rechtsvorm: ${oneLine(notice.legalForm) || 'onbekend'}`,
    `Land: ${oneLine(notice.country) || 'onbekend'}`,
    `Beheerder: ${oneLine(notice.adminEmail) || 'nog niet ingesteld'}`,
    `Taal: ${oneLine(notice.language) || 'onbekend'}`,
    `Aangemaakt: ${when}`,
  ];
  if (environment) lines.push(`Omgeving: ${environment}`);
  lines.push(`Bron: ${sourceLabel}`);
  if (notice.createdByEmail) {
    lines.push(`Aangemaakt door: ${oneLine(notice.createdByEmail)}`);
  }
  lines.push('', `Platform: ${coopPlatformUrl(notice.coopId, env.FRONTEND_URL)}`);

  const title = `Nieuwe coöperatie: ${oneLine(notice.name).slice(0, 120)}`;
  return {
    to,
    subject: environment ? `[${environment}] ${title}` : title,
    text: lines.join('\n'),
  };
}

/**
 * Label for user- and admin-visible text. Same short name as the GlitchTip tag,
 * except production is unlabeled: the live site must never mention its environment.
 */
function visibleEnvironment(appUrl?: string | null, explicit?: string, nodeEnv?: string): string | null {
  const tag = sentryEnvironment(appUrl, explicit, nodeEnv);
  if (tag === 'prod') return null;
  return tag;
}

function oneLine(value: string | null | undefined): string {
  if (!value) return '';
  return value.replace(/[\r\n]+/g, ' ').trim();
}

function formatBrussels(date: Date): string {
  return new Intl.DateTimeFormat('nl-BE', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/Brussels',
  }).format(date);
}
