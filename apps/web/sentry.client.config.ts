// Sentry (GlitchTip) client-side configuration.
// DSN comes from NEXT_PUBLIC_SENTRY_DSN (inlined at build time), falling back
// to the committed self-hosted GlitchTip DSN when the secret isn't set.
// GlitchTip is errors-only: no tracing, no replay, no profiling.
import * as Sentry from '@sentry/nextjs';
import { getClientSentryEnvironment, getSentryDsn, scrubBreadcrumb, scrubBrowserEvent } from './src/lib/sentry';

Sentry.init({
  dsn: getSentryDsn(),
  environment: getClientSentryEnvironment(),
  tracesSampleRate: 0,
  sendDefaultPii: false,
  beforeSend: scrubBrowserEvent,
  beforeBreadcrumb: scrubBreadcrumb,
});
