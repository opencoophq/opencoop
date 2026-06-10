// Sentry server-side (Node.js runtime) configuration.
// No-op when no DSN is set. SENTRY_DSN is a runtime env on the server; falls
// back to NEXT_PUBLIC_SENTRY_DSN (inlined at build) if the runtime var is unset.
import * as Sentry from '@sentry/nextjs';

const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: 0.1,
  });
}
