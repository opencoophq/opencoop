// Sentry server-side (Node.js runtime) configuration.
// No-op when no GlitchTip DSN is set. SENTRY_DSN is a runtime env on the server;
// falls back to NEXT_PUBLIC_SENTRY_DSN (inlined at build) if the runtime var is unset.
// A sentry.io host is ignored. The environment tag is acc or prod.
import * as Sentry from '@sentry/nextjs';
import { scrubSentryBreadcrumb, scrubSentryEvent } from '@opencoop/shared';
import { sentryDsn, sentryEnvironment } from './src/lib/sentry-environment';

const dsn = sentryDsn(process.env.SENTRY_DSN) || sentryDsn(process.env.NEXT_PUBLIC_SENTRY_DSN);

if (dsn) {
  Sentry.init({
    dsn,
    environment: sentryEnvironment(
      process.env.NEXTAUTH_URL,
      process.env.SENTRY_ENVIRONMENT,
      process.env.NODE_ENV,
    ),
    tracesSampleRate: 0.1,
    // Never send personal data: no IP or cookies from the SDK, and every
    // event and breadcrumb passes through the shared scrubber.
    sendDefaultPii: false,
    beforeSend: (event) => scrubSentryEvent(event),
    beforeSendTransaction: (event) => scrubSentryEvent(event),
    beforeBreadcrumb: (breadcrumb) => scrubSentryBreadcrumb(breadcrumb),
  });
}
