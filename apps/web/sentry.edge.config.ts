// Sentry (GlitchTip) edge runtime configuration (middleware, edge routes).
// Same DSN/environment resolution as sentry.server.config.ts. GlitchTip is
// errors-only: no tracing, no replay, no profiling.
import * as Sentry from '@sentry/nextjs';
import { getServerSentryDsn, getServerSentryEnvironment, scrubSentryEvent } from './src/lib/sentry';

Sentry.init({
  dsn: getServerSentryDsn(),
  environment: getServerSentryEnvironment(),
  tracesSampleRate: 0,
  sendDefaultPii: false,
  beforeSend: scrubSentryEvent,
});
