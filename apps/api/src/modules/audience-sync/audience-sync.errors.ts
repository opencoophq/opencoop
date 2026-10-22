/**
 * Brevo failures stored on a sync run.
 * `code` is an internal code. `message` is that code or other non-Brevo text
 * with email addresses masked. The raw Brevo body is never persisted.
 */
export interface SyncErrorDetail {
  shareholderId?: string;
  email: string | null;
  code: string;
  message: string;
}

const BREVO_CODE_MAP: Record<string, string> = {
  duplicate_parameter: 'DUPLICATE_EMAIL',
  duplicate_identifiers: 'DUPLICATE_EMAIL',
  invalid_parameter: 'INVALID_PARAMETER',
  missing_parameter: 'MISSING_PARAMETER',
  unauthorized: 'UNAUTHORIZED',
  document_not_found: 'CONTACT_NOT_FOUND',
  method_not_allowed: 'METHOD_NOT_ALLOWED',
  not_enough_credits: 'NOT_ENOUGH_CREDITS',
};

const EMAIL_IN_TEXT = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

/** First character of the local part plus the domain. Null stays null. */
export function maskEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const trimmed = email.trim();
  const at = trimmed.indexOf('@');
  if (at <= 0) return '***';
  return `${trimmed.slice(0, 1)}***@${trimmed.slice(at + 1)}`;
}

export function maskEmailsInText(text: string): string {
  return text.replace(EMAIL_IN_TEXT, (match) => maskEmail(match) ?? '***');
}

export class AudienceProviderError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = 'AudienceProviderError';
    this.code = code;
  }
}

export function mapBrevoHttpError(status: number, bodyText: string): AudienceProviderError {
  let brevoCode: string | undefined;
  try {
    const parsed = JSON.parse(bodyText) as { code?: unknown };
    if (typeof parsed.code === 'string') brevoCode = parsed.code;
  } catch {
    brevoCode = undefined;
  }

  if (brevoCode && BREVO_CODE_MAP[brevoCode]) {
    return new AudienceProviderError(BREVO_CODE_MAP[brevoCode]);
  }
  if (status === 401 || status === 403 || brevoCode === 'unauthorized') {
    return new AudienceProviderError(status === 403 ? 'FORBIDDEN' : 'UNAUTHORIZED');
  }
  if (status === 404) return new AudienceProviderError('CONTACT_NOT_FOUND');
  if (status === 429) return new AudienceProviderError('RATE_LIMITED');
  if (status === 400) return new AudienceProviderError('BREVO_BAD_REQUEST');
  return new AudienceProviderError('BREVO_ERROR');
}

export function toSyncErrorDetail(
  err: unknown,
  shareholderId?: string,
  email?: string | null,
): SyncErrorDetail {
  if (err instanceof AudienceProviderError) {
    return {
      shareholderId,
      email: maskEmail(email),
      code: err.code,
      message: err.code,
    };
  }
  const raw = err instanceof Error ? err.message : String(err);
  return {
    shareholderId,
    email: maskEmail(email),
    code: 'SYNC_FAILED',
    message: maskEmailsInText(raw),
  };
}
