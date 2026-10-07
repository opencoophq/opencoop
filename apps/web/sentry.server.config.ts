// Sentry (GlitchTip) server-side (Node.js runtime) configuration.
// SENTRY_DSN is a runtime env on the server; falls back to
// NEXT_PUBLIC_SENTRY_DSN (inlined at build), then the committed self-hosted
// GlitchTip DSN. GlitchTip is errors-only: no tracing, no replay, no profiling.
import * as Sentry from '@sentry/nextjs';
import { getServerSentryDsn, getServerSentryEnvironment } from './src/lib/sentry';

Sentry.init({
  dsn: getServerSentryDsn(),
  environment: getServerSentryEnvironment(),
  tracesSampleRate: 0,
});
