/**
 * Removes personal data and credentials from Sentry/GlitchTip events before
 * they leave the process. Used by the API and the web app as `beforeSend`,
 * `beforeSendTransaction` and `beforeBreadcrumb`.
 *
 * The types are structural so this package does not depend on a Sentry SDK.
 */

export const FILTERED = '[Filtered]';

// Values that carry a secret: everything after `key=` up to the next separator.
const SECRET_QUERY =
  /\b((?:[a-z_]*token|code|password|passwd|secret|api_?key|otp|signature)=)[^&\s#"';,]+/gi;
// Capability tokens in URL paths: web pages (/invite/<token>, /meetings/rsvp/<token>,
// /vrijwilligers/bevestig/<token>, ...) and the matching API routes.
const PATH_TOKEN =
  /(\/(?:invite|invitation|emancipate|rsvp|kiosk|bevestig|afmelden|gift)\/)[^/?#\s"']+/gi;
const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi;
const JWT = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g;
const API_KEY = /\boc_[A-Za-z0-9_-]{8,}/g;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
// IBAN: country code, check digits, 11-30 alphanumerics, optionally in groups of four.
// Upper case only, so lower-case database ids are not mangled. Belgian IBANs are
// all digits after `BE`, so that form is also matched in lower case.
const IBAN = /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]){11,30}\b/g;
const BE_IBAN = /\bBE\d{2}(?:[ ]?\d{4}){3}\b/gi;
// Belgian national register number: YY.MM.DD-XXX.CC, with or without separators.
const NATIONAL_NUMBER = /\b\d{2}[.\s]?\d{2}[.\s]?\d{2}[-.\s]?\d{3}[.\s]?\d{2}\b/g;

// Keys whose value is secret or personal, whatever it looks like.
const SENSITIVE_KEY =
  /pass(word|wd)?|secret|token|authori[sz]ation|cookie|session|api[-_]?key|iban|bic|email|phone|national|rijksregister|ssn|otp|mfa|signature|^code$|^name$|full_?name|first_?name|last_?name|address|street|postal|postcode|zip|city|birth/i;

// Span attributes that name a host, not a person; keep them for tracing.
const SAFE_KEYS = new Set(['server.address', 'network.peer.address', 'net.peer.name']);

const DROPPED_HEADERS =
  /^(authorization|cookie|set-cookie|x-session-token|x-api-key|proxy-authorization|x-forwarded-for|x-real-ip|cf-connecting-ip|true-client-ip|forwarded)$/i;

const MAX_DEPTH = 8;

/** Masks every secret or personal value inside a string. */
export function scrubString(value: string): string {
  return value
    .replace(SECRET_QUERY, `$1${FILTERED}`)
    .replace(PATH_TOKEN, `$1${FILTERED}`)
    .replace(BEARER, `$1 ${FILTERED}`)
    .replace(JWT, FILTERED)
    .replace(API_KEY, FILTERED)
    .replace(EMAIL, FILTERED)
    .replace(BE_IBAN, FILTERED)
    .replace(IBAN, FILTERED)
    .replace(NATIONAL_NUMBER, FILTERED);
}

/**
 * Deep copy of `value` with every string scrubbed. With `maskKeys`, the value
 * of a key that names a secret or personal field is replaced as a whole.
 */
export function scrubValue(
  value: unknown,
  maskKeys = true,
  depth = 0,
  seen = new WeakSet<object>(),
): unknown {
  if (typeof value === 'string') return scrubString(value);
  if (value === null || typeof value !== 'object') return value;
  // Breadcrumbs arrive before Sentry normalises them; keep errors and dates readable.
  if (value instanceof Error) return scrubString(String(value));
  if (value instanceof Date) return value.toISOString();
  if (depth >= MAX_DEPTH || seen.has(value)) return FILTERED;
  seen.add(value);

  let out: unknown;
  if (Array.isArray(value)) {
    out = value.map((item) => scrubValue(item, maskKeys, depth + 1, seen));
  } else {
    const copy: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      const mask =
        maskKeys &&
        !SAFE_KEYS.has(key) &&
        SENSITIVE_KEY.test(key) &&
        item !== null &&
        item !== undefined &&
        item !== '';
      copy[key] = mask ? FILTERED : scrubValue(item, maskKeys, depth + 1, seen);
    }
    out = copy;
  }
  // Only cycles are cut: an object referenced twice is scrubbed both times.
  seen.delete(value);
  return out;
}

// A request body can arrive as a raw JSON string. Parse it so keys such as
// `password` are masked; anything else that is not JSON is dropped whole.
function scrubBody(data: unknown): unknown {
  if (typeof data !== 'string') return scrubValue(data);
  try {
    return JSON.stringify(scrubValue(JSON.parse(data)));
  } catch {
    return FILTERED;
  }
}

function scrubHeaders(headers: unknown): unknown {
  if (!headers || typeof headers !== 'object') return headers;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
    out[key] = DROPPED_HEADERS.test(key) ? FILTERED : scrubValue(value);
  }
  return out;
}

// Sentry sends a query string as a string, an object, or a list of [key, value] pairs.
function scrubQueryString(query: unknown): unknown {
  if (!Array.isArray(query)) return scrubValue(query);
  return query.map((pair) =>
    Array.isArray(pair) && pair.length === 2 && typeof pair[0] === 'string'
      ? [pair[0], SENSITIVE_KEY.test(pair[0]) ? FILTERED : scrubValue(pair[1])]
      : scrubValue(pair),
  );
}

interface ScrubbableRequest {
  url?: string;
  data?: unknown;
  query_string?: unknown;
  headers?: unknown;
  cookies?: unknown;
  env?: unknown;
}

interface ScrubbableBreadcrumb {
  message?: string;
  data?: unknown;
}

interface ScrubbableEvent {
  message?: unknown;
  transaction?: string;
  logentry?: unknown;
  exception?: { values?: Array<{ value?: string }> };
  request?: ScrubbableRequest;
  user?: { id?: string | number } | null;
  extra?: unknown;
  contexts?: unknown;
  tags?: unknown;
  breadcrumbs?: ScrubbableBreadcrumb[];
  spans?: Array<{ description?: string; data?: unknown }>;
}

/** Scrubs one breadcrumb. Use as `beforeBreadcrumb`. */
export function scrubSentryBreadcrumb<T extends ScrubbableBreadcrumb>(breadcrumb: T): T {
  const out = { ...breadcrumb };
  if (typeof out.message === 'string') out.message = scrubString(out.message);
  if (out.data !== undefined) out.data = scrubValue(out.data);
  return out;
}

/** Scrubs a whole event. Use as `beforeSend` and `beforeSendTransaction`. */
export function scrubSentryEvent<T extends ScrubbableEvent>(event: T): T {
  const out: ScrubbableEvent = { ...event };

  if (out.message !== undefined) out.message = scrubValue(out.message);
  if (out.logentry !== undefined) out.logentry = scrubValue(out.logentry);
  if (typeof out.transaction === 'string') out.transaction = scrubString(out.transaction);

  if (out.exception?.values) {
    out.exception = {
      ...out.exception,
      values: out.exception.values.map((ex) => ({
        ...ex,
        ...(typeof ex.value === 'string' ? { value: scrubString(ex.value) } : {}),
      })),
    };
  }

  if (out.request) {
    const req = { ...out.request };
    if (typeof req.url === 'string') req.url = scrubString(req.url);
    if (req.data !== undefined) req.data = scrubBody(req.data);
    if (req.query_string !== undefined) req.query_string = scrubQueryString(req.query_string);
    if (req.headers !== undefined) req.headers = scrubHeaders(req.headers);
    if (req.cookies !== undefined) req.cookies = FILTERED;
    if (req.env !== undefined) req.env = FILTERED;
    out.request = req;
  }

  if (out.user) {
    out.user = out.user.id !== undefined ? { id: out.user.id } : {};
  }

  if (out.extra !== undefined) out.extra = scrubValue(out.extra);
  // Contexts and tags hold SDK metadata such as `os.name`; scrub strings only.
  if (out.contexts !== undefined) out.contexts = scrubValue(out.contexts, false);
  if (out.tags !== undefined) out.tags = scrubValue(out.tags, false);
  if (out.breadcrumbs) out.breadcrumbs = out.breadcrumbs.map(scrubSentryBreadcrumb);
  if (out.spans) {
    out.spans = out.spans.map((span) => ({
      ...span,
      ...(typeof span.description === 'string'
        ? { description: scrubString(span.description) }
        : {}),
      ...(span.data !== undefined ? { data: scrubValue(span.data) } : {}),
    }));
  }

  return out as T;
}
