// Sentry edge runtime configuration (middleware, edge routes).
// No-op when no DSN is set.
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
