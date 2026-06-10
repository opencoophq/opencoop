// Next.js instrumentation hook. Loads the Sentry runtime-specific config so
// server / edge errors are captured. Each config no-ops when no DSN is set.
import * as Sentry from '@sentry/nextjs';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('../sentry.server.config');
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('../sentry.edge.config');
  }
}

// Captures errors from nested React Server Components (Sentry v8.28+).
export const onRequestError = Sentry.captureRequestError;
