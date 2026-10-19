// Sentry client-side configuration.
// No-op when NEXT_PUBLIC_SENTRY_DSN is unset (e.g. local dev), mirroring the
// API's instrument.ts pattern. The DSN is inlined at build time by Next.js.
import * as Sentry from '@sentry/nextjs';
import { sentryEnvironment } from './src/lib/sentry-environment';

if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: sentryEnvironment(window.location.origin, undefined, process.env.NODE_ENV),
    tracesSampleRate: 0.1,
  });
}
