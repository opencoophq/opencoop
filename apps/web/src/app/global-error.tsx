'use client';

// Global error boundary for the App Router. Reports uncaught React render
// errors to Sentry (no-op when no DSN is configured) so client-side crashes
// — e.g. a kiosk toDataURL() exception during an AGM — are visible.
import * as Sentry from '@sentry/nextjs';
import NextError from 'next/error';
import { useEffect } from 'react';

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html>
      <body>
        <NextError statusCode={0} />
      </body>
    </html>
  );
}
