// Sentry edge runtime configuration (middleware, edge routes).
// No-op when no GlitchTip DSN is set. A sentry.io host is ignored.
import * as Sentry from '@sentry/nextjs';
import { sentryDsn, sentryEnvironment } from './src/lib/sentry-environment';

const dsn = sentryDsn(process.env.SENTRY_DSN) || sentryDsn(process.env.NEXT_PUBLIC_SENTRY_DSN);

if (dsn) {
  Sentry.init({
    dsn,
    environment: sentryEnvironment(process.env.NEXTAUTH_URL, process.env.SENTRY_ENVIRONMENT, process.env.NODE_ENV),
    tracesSampleRate: 0.1,
  });
}
