import * as Sentry from '@sentry/nestjs';
import { scrubSentryBreadcrumb, scrubSentryEvent } from '@opencoop/shared';
import { sentryDsn, sentryEnvironment } from './sentry-environment';

// Only initialize when a GlitchTip DSN is configured. A sentry.io DSN is ignored.
const dsn = sentryDsn(process.env.SENTRY_DSN);
if (dsn) {
  Sentry.init({
    dsn,
    environment: sentryEnvironment(
      process.env.FRONTEND_URL,
      process.env.SENTRY_ENVIRONMENT,
      process.env.NODE_ENV,
    ),
    tracesSampleRate: 0.2,
    // Never send personal data: no IP or cookies from the SDK, and every
    // event and breadcrumb passes through the shared scrubber.
    sendDefaultPii: false,
    beforeSend: (event) => scrubSentryEvent(event),
    beforeSendTransaction: (event) => scrubSentryEvent(event),
    beforeBreadcrumb: (breadcrumb) => scrubSentryBreadcrumb(breadcrumb),
  });
}
