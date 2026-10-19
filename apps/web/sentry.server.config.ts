// Sentry server-side (Node.js runtime) configuration.
// No-op when no DSN is set. SENTRY_DSN is a runtime env on the server; falls
// back to NEXT_PUBLIC_SENTRY_DSN (inlined at build) if the runtime var is unset.
import * as Sentry from '@sentry/nextjs';
import { sentryEnvironment } from './src/lib/sentry-environment';

const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: sentryEnvironment(process.env.NEXTAUTH_URL, process.env.SENTRY_ENVIRONMENT, process.env.NODE_ENV),
    tracesSampleRate: 0.1,
  });
}
