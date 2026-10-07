import * as Sentry from '@sentry/nestjs';
import { scrubSentryEvent } from './common/sentry-scrub';

// Only initialize Sentry if DSN is configured (skip in dev environments).
// GlitchTip (errors.armlab.com) handles errors only: no tracing, no replay,
// no profiling, so tracesSampleRate stays at 0.
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT || 'production',
    tracesSampleRate: 0,
    sendDefaultPii: false,
    beforeSend: scrubSentryEvent,
  });
}
