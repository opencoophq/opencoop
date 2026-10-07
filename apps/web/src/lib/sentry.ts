// Shared helpers for the client/server/edge Sentry (GlitchTip) configs.
//
// DSN: NEXT_PUBLIC_SENTRY_DSN is a GitHub Actions secret, inlined at build
// time via a Docker build arg. Fall back to the committed self-hosted
// GlitchTip DSN when the secret is unset (`undefined`) or empty (`""`).
import type { ErrorEvent } from '@sentry/nextjs';

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

function stripQuery(url: string | undefined): string | undefined {
  if (!url) return url;
  const index = url.indexOf('?');
  return index === -1 ? url : url.slice(0, index);
}

// Strips request bodies, cookies, query strings, and sensitive headers
// before an event leaves the server/edge runtime.
export function scrubSentryEvent(event: ErrorEvent): ErrorEvent {
  if (event.request) {
    delete event.request.data;
    delete event.request.cookies;
    delete event.request.query_string;
    event.request.url = stripQuery(event.request.url);

    if (event.request.headers) {
      for (const key of Object.keys(event.request.headers)) {
        if (SENSITIVE_HEADERS.has(key.toLowerCase())) {
          delete event.request.headers[key];
        }
      }
    }
  }

  if (event.breadcrumbs) {
    for (const breadcrumb of event.breadcrumbs) {
      const data = breadcrumb.data;
      if (data) {
        if (typeof data.url === 'string') data.url = stripQuery(data.url);
        if (typeof data.from === 'string') data.from = stripQuery(data.from);
        if (typeof data.to === 'string') data.to = stripQuery(data.to);
      }
    }
  }

  return event;
}
