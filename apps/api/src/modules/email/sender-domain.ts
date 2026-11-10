/**
 * Pure decisions for platform mail From / Reply-To.
 *
 * A cooperative's own address is used only when Brevo has both verified and
 * authenticated the domain and the stored status is "verified". Anything else
 * keeps the platform mailbox and the cooperative's display name.
 */

import { domainToASCII } from 'node:url';

export const BREVO_SPF_INCLUDE = 'include:spf.brevo.com';
export const BREVO_SPF_NEW_RECORD = 'v=spf1 include:spf.brevo.com ~all';
export const BREVO_DMARC_VALUE = 'v=DMARC1; p=none; rua=mailto:rua@dmarc.brevo.com';

/** Login codes, magic links, password resets, and account verification. */
const AUTH_CRITICAL_TEMPLATES = new Set(['magic-link', 'password-reset', 'email-verification']);

const DOMAIN_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const EMAIL_RE =
  /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

export type SenderDomainStatus = 'pending' | 'verified' | 'failed';

export interface CoopSenderFields {
  name: string;
  coopEmail: string | null;
  senderDomain: string | null;
  senderFromAddress: string | null;
  senderFromName: string | null;
  senderDomainStatus: string | null;
}

export interface MailEnvelope {
  from: string;
  fromAddress: string;
  replyTo?: string;
}

export interface PlatformEnvelopes {
  /** Envelope to try first. */
  selected: MailEnvelope;
  /** Platform mailbox, still carrying the cooperative's display name. */
  platform: MailEnvelope;
  /** True when `selected` is the cooperative's own authenticated address. */
  custom: boolean;
}

export function isAuthCriticalTemplate(templateKey: string | null | undefined): boolean {
  return AUTH_CRITICAL_TEMPLATES.has((templateKey ?? '').trim().toLowerCase());
}

export function normalizeDomain(input: string | null | undefined): string | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim().toLowerCase().replace(/\.$/, '');
  if (!trimmed || trimmed.includes('@') || trimmed.includes('/') || trimmed.includes(':')) {
    return null;
  }
  const ascii = domainToASCII(trimmed);
  if (!ascii || !DOMAIN_RE.test(ascii)) return null;
  if (isBlockedDomain(ascii)) return null;
  return ascii;
}

export function normalizeEmail(input: string | null | undefined): string | null {
  if (typeof input !== 'string') return null;
  const value = input.trim().toLowerCase();
  if (!value || value.length > 320 || !EMAIL_RE.test(value)) return null;
  return value;
}

export function emailDomain(email: string): string | null {
  const at = email.lastIndexOf('@');
  if (at < 1) return null;
  return email.slice(at + 1);
}

export function sanitizeDisplayName(input: string | null | undefined): string | null {
  if (typeof input !== 'string') return null;
  const value = input
    .replace(/[\r\n<>"]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!value) return null;
  return value.slice(0, 100);
}

export function parseFromHeader(raw: string): { name: string | null; address: string } {
  const trimmed = raw.trim();
  const match = trimmed.match(/^(.*)<([^>]+)>\s*$/);
  if (match) {
    const inside = match[2].trim();
    return {
      name: sanitizeDisplayName(match[1]),
      address: normalizeEmail(inside) ?? inside,
    };
  }
  return { name: null, address: normalizeEmail(trimmed) ?? trimmed };
}

/**
 * Custom From is eligible only when the stored status is verified and the
 * mailbox sits on that exact domain. A mismatched or unverified row falls
 * back to the platform address.
 */
export function resolvePlatformEnvelopes(input: {
  platformFrom: string;
  senderName?: string | null;
  coop: CoopSenderFields | null;
}): PlatformEnvelopes {
  const parsed = parseFromHeader(input.platformFrom || 'OpenCoop <noreply@opencoop.be>');
  const platformAddress = parsed.address || 'noreply@opencoop.be';
  const displayName = chooseDisplayName(input.coop, input.senderName, parsed.name);
  const platform = envelope(displayName, platformAddress, input.coop?.coopEmail);
  const customAddress = eligibleCustomAddress(input.coop);
  if (!customAddress) {
    return { selected: platform, platform, custom: false };
  }
  return {
    selected: envelope(displayName, customAddress, input.coop?.coopEmail),
    platform,
    custom: true,
  };
}

function chooseDisplayName(
  coop: CoopSenderFields | null,
  senderName: string | null | undefined,
  platformName: string | null,
): string | null {
  return (
    sanitizeDisplayName(coop?.senderFromName) ||
    sanitizeDisplayName(senderName) ||
    sanitizeDisplayName(coop?.name) ||
    platformName
  );
}

function eligibleCustomAddress(coop: CoopSenderFields | null): string | null {
  if (!coop) return null;
  if ((coop.senderDomainStatus ?? '').trim().toLowerCase() !== 'verified') return null;
  const domain = normalizeDomain(coop.senderDomain);
  const address = normalizeEmail(coop.senderFromAddress);
  if (!domain || !address) return null;
  if (emailDomain(address) !== domain) return null;
  return address;
}

function envelope(
  name: string | null,
  address: string,
  coopEmail: string | null | undefined,
): MailEnvelope {
  const reply = normalizeEmail(coopEmail);
  return {
    from: name ? `${formatDisplayName(name)} <${address}>` : address,
    fromAddress: address,
    replyTo: reply && reply !== address ? reply : undefined,
  };
}

/**
 * A display name with a comma, semicolon, colon, at-sign, bracket or dot is
 * not a valid bare phrase. Unquoted, "Coop, Inc <a@b.be>" is parsed as two
 * addresses. Quote it; quotes and CR/LF are already stripped.
 */
function formatDisplayName(name: string): string {
  if (!/[,;:@()[\]\\.]/.test(name)) return name;
  return `"${name.replace(/\\/g, '')}"`;
}

function isBlockedDomain(domain: string): boolean {
  if (domain === 'opencoop.be' || domain.endsWith('.opencoop.be')) return true;
  if (domain === 'localhost' || domain.endsWith('.localhost') || domain.endsWith('.local')) {
    return true;
  }
  return false;
}
