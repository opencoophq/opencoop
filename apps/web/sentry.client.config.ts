// Sentry client-side configuration.
// No-op when NEXT_PUBLIC_SENTRY_DSN is unset or points at sentry.io.
// The DSN is inlined at build time by Next.js. The environment tag is acc or prod.
import * as Sentry from '@sentry/nextjs';
import { scrubSentryBreadcrumb, scrubSentryEvent } from '@opencoop/shared';
import { sentryDsn, sentryEnvironment } from './src/lib/sentry-environment';

const dsn = sentryDsn(process.env.NEXT_PUBLIC_SENTRY_DSN);
if (dsn) {
  Sentry.init({
    dsn,
    environment: sentryEnvironment(window.location.origin, undefined, process.env.NODE_ENV),
    tracesSampleRate: 0.1,
    // Never send personal data: no IP or cookies from the SDK, and every
    // event and breadcrumb passes through the shared scrubber.
    sendDefaultPii: false,
    beforeSend: (event) => scrubSentryEvent(event),
    beforeSendTransaction: (event) => scrubSentryEvent(event),
    beforeBreadcrumb: (breadcrumb) => scrubSentryBreadcrumb(breadcrumb),
  });
}
