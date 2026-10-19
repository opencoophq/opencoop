import * as Sentry from '@sentry/nestjs';
import { sentryEnvironment } from './sentry-environment';

// Only initialize Sentry if DSN is configured (skip in dev environments)
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: sentryEnvironment(process.env.FRONTEND_URL, process.env.SENTRY_ENVIRONMENT, process.env.NODE_ENV),
    tracesSampleRate: 0.2,
  });
}
