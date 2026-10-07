// Sentry (GlitchTip) server-side (Node.js runtime) configuration.
// Uses the web app's own committed DSN (never SENTRY_DSN, which on fsn1
// belongs to the API in the shared .env); NEXT_PUBLIC_SENTRY_DSN can still
// override it. GlitchTip is errors-only: no tracing, no replay, no profiling.
import * as Sentry from '@sentry/nextjs';
import { getServerSentryDsn, getServerSentryEnvironment, scrubSentryEvent } from './src/lib/sentry';

Sentry.init({
  dsn: getServerSentryDsn(),
  environment: getServerSentryEnvironment(),
  tracesSampleRate: 0,
  sendDefaultPii: false,
  beforeSend: scrubSentryEvent,
});
