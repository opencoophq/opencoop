import * as Sentry from '@sentry/nestjs';

// Only initialize Sentry if DSN is configured (skip in dev environments)
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: 0.2,
  });
}
