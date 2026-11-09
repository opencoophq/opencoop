/**
 * Sanitized EmailLog payload for platform SMTP (sendPlatformEmail).
 *
 * The row records who we tried to reach and what the SMTP server said.
 * It must not contain the login code, a magic-link or reset token, the
 * mail body, or the SMTP password. Those values are stripped here, before
 * anything is handed to Prisma.
 */

const TEXT_MAX = 500;
const MESSAGE_ID_MAX = 200;
const RECIPIENT_MAX = 320;

const QUEUED_AS = /queued as\s+<?([^<>\s,;]+)>?/i;
const ID_EQ = /(?:^|[\s;])id[=:]\s*<?([^<>\s,;]+)>?/i;

function querySecretPattern(): RegExp {
  return /(?:[?&#]|\b)(?:token|code|resetToken|reset_token|password|secret|passwd)=([^&\s"'<>]+)/gi;
}

export type PlatformDeliveryStatus = 'ACCEPTED' | 'REJECTED' | 'ERROR';

export interface PlatformEmailLogData {
  coopId: string | null;
  recipientEmail: string;
  subject: string;
  templateKey: string;
  status: PlatformDeliveryStatus;
  sentAt: Date | null;
  errorMessage: string | null;
  providerMessageId: string | null;
  smtpResponse: string | null;
}

export interface SmtpAcceptedInfo {
  accepted?: unknown;
  rejected?: unknown;
  response?: unknown;
  messageId?: unknown;
}

export function collectMailSecrets(...parts: Array<string | null | undefined>): string[] {
  const source = parts.filter((part): part is string => typeof part === 'string').join('\n');
  const found = new Set<string>();

  for (const match of source.matchAll(querySecretPattern())) {
    addSecret(found, match[1]);
    try {
      const decoded = decodeURIComponent(match[1]);
      if (decoded !== match[1]) addSecret(found, decoded);
    } catch {
      // The raw value is already recorded.
    }
  }
  for (const match of source.matchAll(/\b[a-f0-9]{32,128}\b/gi)) addSecret(found, match[0]);
  for (const match of source.matchAll(/\b\d{6}\b/g)) addSecret(found, match[0]);

  return [...found];
}

export function redactSecrets(value: string, secrets: string[]): string {
  let out = value;
  const sorted = [...new Set(secrets)]
    .filter((secret) => secret.length >= 6)
    .sort((a, b) => b.length - a.length);
  for (const secret of sorted) {
    if (!out.includes(secret)) continue;
    out = out.split(secret).join('[redacted]');
  }
  out = out.replace(querySecretPattern(), (full) => {
    const eq = full.indexOf('=');
    return eq === -1 ? full : `${full.slice(0, eq + 1)}[redacted]`;
  });
  return out.replace(/[\r\n]+/g, ' ').trim();
}

/**
 * Brevo returns the provider id in the SMTP reply, typically
 * `250 2.0.0 Ok: queued as <id@smtp-relay.mailin.fr>`. Some relays use
 * `id=<id>`. When the reply has no id, keep the Message-ID nodemailer
 * submitted — Brevo stores that header as the message id.
 */
export function extractProviderMessageId(
  response: string | null | undefined,
  messageId: string | null | undefined,
): string | null {
  const fromResponse = response
    ? (response.match(QUEUED_AS)?.[1] ?? response.match(ID_EQ)?.[1])
    : undefined;
  const raw = (fromResponse ?? stripAngles(messageId) ?? '').trim();
  if (!raw) return null;
  return raw.slice(0, MESSAGE_ID_MAX);
}

export function outcomeFromSmtpResult(info: SmtpAcceptedInfo): {
  status: 'ACCEPTED' | 'REJECTED';
  smtpResponse: string | null;
  providerMessageId: string | null;
  errorMessage: string | null;
} {
  const response = typeof info.response === 'string' ? info.response : null;
  const messageId = typeof info.messageId === 'string' ? info.messageId : null;
  const accepted = Array.isArray(info.accepted) ? info.accepted : [];
  const rejected = Array.isArray(info.rejected) ? info.rejected : [];
  const providerMessageId = extractProviderMessageId(response, messageId);

  if (rejected.length > 0 && accepted.length === 0) {
    const line = response?.replace(/[\r\n]+/g, ' ').trim();
    return {
      status: 'REJECTED',
      smtpResponse: response,
      providerMessageId,
      errorMessage: line || 'SMTP rejected the recipient',
    };
  }

  return {
    status: 'ACCEPTED',
    smtpResponse: response,
    providerMessageId,
    errorMessage: null,
  };
}

export function outcomeFromSmtpError(error: unknown): {
  status: 'REJECTED' | 'ERROR';
  smtpResponse: string | null;
  providerMessageId: string | null;
  errorMessage: string;
} {
  const record =
    error && typeof error === 'object'
      ? (error as { response?: unknown; responseCode?: unknown; code?: unknown })
      : {};
  const response = typeof record.response === 'string' ? record.response : null;
  const responseCode = typeof record.responseCode === 'number' ? record.responseCode : undefined;
  const code = typeof record.code === 'string' ? record.code : undefined;
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string' && error
        ? error
        : 'Unknown error';
  const rejected =
    code === 'EENVELOPE' ||
    (responseCode !== undefined && responseCode >= 400 && responseCode < 600);

  return {
    status: rejected ? 'REJECTED' : 'ERROR',
    smtpResponse: response,
    providerMessageId: extractProviderMessageId(response, null),
    errorMessage: message || 'Unknown error',
  };
}

export function buildPlatformEmailLog(input: {
  to: string;
  subject: string;
  templateKey?: string | null;
  coopId?: string | null;
  status: PlatformDeliveryStatus;
  smtpResponse: string | null;
  providerMessageId: string | null;
  errorMessage: string | null;
  sentAt: Date | null;
  secrets: string[];
}): PlatformEmailLogData {
  const clip = (value: string | null, max: number): string | null => {
    if (!value) return null;
    const cleaned = redactSecrets(value, input.secrets);
    if (!cleaned) return null;
    return cleaned.slice(0, max);
  };

  return {
    coopId: input.coopId?.trim() ? input.coopId.trim() : null,
    recipientEmail: clip(input.to, RECIPIENT_MAX) ?? 'unknown',
    subject: clip(input.subject, TEXT_MAX) ?? '(no subject)',
    templateKey: normalizeTemplateKey(input.templateKey, input.secrets),
    status: input.status,
    sentAt: input.status === 'ACCEPTED' ? (input.sentAt ?? new Date()) : null,
    errorMessage: input.status === 'ACCEPTED' ? null : clip(input.errorMessage, TEXT_MAX),
    providerMessageId: clip(input.providerMessageId, MESSAGE_ID_MAX),
    smtpResponse: clip(input.smtpResponse, TEXT_MAX),
  };
}

export function normalizeTemplateKey(
  templateKey: string | null | undefined,
  secrets: string[] = [],
): string {
  const value = (templateKey ?? '').trim().toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) || value.length > 64) return 'platform';
  // A template key is a short label (`magic-link`), never a token or login code.
  if (/^[a-f0-9]{32,}$/.test(value) || /^\d{6,}$/.test(value)) return 'platform';
  const leaked = secrets.some(
    (secret) => secret.length >= 6 && value.includes(secret.toLowerCase()),
  );
  return leaked ? 'platform' : value;
}

function addSecret(found: Set<string>, value: string | undefined): void {
  if (!value || value.length < 6) return;
  found.add(value);
}

function stripAngles(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.trim().replace(/^<|>$/g, '');
}
