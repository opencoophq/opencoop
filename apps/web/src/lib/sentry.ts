// Shared helpers for the client/server/edge Sentry (GlitchTip) configs.
//
// DSN: NEXT_PUBLIC_SENTRY_DSN is a GitHub Actions secret, inlined at build
// time via a Docker build arg. Fall back to the committed self-hosted
// GlitchTip DSN when the secret is unset (`undefined`) or empty (`""`).
import type { Breadcrumb, ErrorEvent } from '@sentry/nextjs';

const FALLBACK_SENTRY_DSN = 'https://fc042137f1984c4588e9e22a1efd875c@errors.armlab.com/12';

export function getSentryDsn(): string {
  return process.env.NEXT_PUBLIC_SENTRY_DSN || FALLBACK_SENTRY_DSN;
}

// Server/edge DSN: the web app's own committed DSN. SENTRY_DSN is never read
// here — on fsn1 each stack shares one `.env` where SENTRY_DSN holds the
// API's DSN, not this app's.
export function getServerSentryDsn(): string {
  return process.env.NEXT_PUBLIC_SENTRY_DSN || FALLBACK_SENTRY_DSN;
}

// Client-side environment: "acc" on acceptance hosts, "production" otherwise.
// Matches hostnames like acc.opencoop.be, app-acc.opencoop.be, acc-app.opencoop.be.
export function getClientSentryEnvironment(): string {
  if (/(^|[.-])acc([.-]|$)/.test(window.location.hostname)) {
    return 'acc';
  }
  return 'production';
}

// Server/edge environment: from SENTRY_ENVIRONMENT, never NODE_ENV (acc runs
// with NODE_ENV=production).
export function getServerSentryEnvironment(): string {
  return process.env.SENTRY_ENVIRONMENT || 'production';
}

const SENSITIVE_HEADERS = new Set(['authorization', 'cookie', 'set-cookie', 'x-api-key']);
const REFERER_HEADERS = new Set(['referer', 'referrer']);

// Strips everything from `?` or `#` onward, so query strings and fragments
// (magic-link / reset tokens) never leave the client.
export function stripQuery(url: string | undefined): string | undefined {
  if (!url) return url;
  const queryIndex = url.indexOf('?');
  const hashIndex = url.indexOf('#');
  const candidates = [queryIndex, hashIndex].filter((index) => index !== -1);
  if (candidates.length === 0) return url;
  return url.slice(0, Math.min(...candidates));
}

function scrubRequest(request: ErrorEvent['request'] | undefined): void {
  if (!request) return;

  delete request.data;
  delete request.cookies;
  delete request.query_string;
  request.url = stripQuery(request.url);

  if (request.headers) {
    for (const key of Object.keys(request.headers)) {
      const lower = key.toLowerCase();
      if (SENSITIVE_HEADERS.has(lower)) {
        delete request.headers[key];
      } else if (REFERER_HEADERS.has(lower)) {
        const stripped = stripQuery(request.headers[key]);
        if (stripped !== undefined) request.headers[key] = stripped;
      }
    }
  }
}

// Strips query strings/fragments from breadcrumb navigation and fetch URLs.
// Shared by beforeSend (existing breadcrumbs) and beforeBreadcrumb (new ones).
export function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb {
  const data = breadcrumb.data;
  if (data) {
    if (typeof data.url === 'string') data.url = stripQuery(data.url);
    if (typeof data.from === 'string') data.from = stripQuery(data.from);
    if (typeof data.to === 'string') data.to = stripQuery(data.to);
  }
  return breadcrumb;
}

// Strips request bodies, cookies, query strings, and sensitive headers
// before an event leaves the server/edge runtime.
export function scrubSentryEvent(event: ErrorEvent): ErrorEvent {
  scrubRequest(event.request);

  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map(scrubBreadcrumb);
  }

  return event;
}

// Browser-side beforeSend: the page URL and navigation/fetch breadcrumbs can
// carry magic-link or reset tokens in `?query`/`#fragment`.
export function scrubBrowserEvent(event: ErrorEvent): ErrorEvent {
  return scrubSentryEvent(event);
}
