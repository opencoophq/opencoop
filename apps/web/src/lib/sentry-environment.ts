/**
 * GlitchTip environment tag for the Sentry SDK. acc and prod run the same
 * image with NODE_ENV=production, so the tag comes from the public URL.
 * Order: SENTRY_ENVIRONMENT if set, "acc" when the app URL is an acc.* host,
 * otherwise NODE_ENV. "acceptance" and "production" normalize to "acc" and "prod".
 */
export function sentryEnvironment(appUrl?: string | null, explicit?: string, nodeEnv?: string): string {
  const explicitValue = explicit?.trim();
  if (explicitValue) return normalizeSentryEnvironment(explicitValue);
  if (appUrl) {
    try {
      if (new URL(appUrl).hostname.startsWith('acc.')) return 'acc';
    } catch {
      // Not a URL; fall through.
    }
  }
  return normalizeSentryEnvironment(nodeEnv || 'development');
}

function normalizeSentryEnvironment(value: string): string {
  const key = value.trim().toLowerCase();
  if (key === 'acc' || key === 'acceptance') return 'acc';
  if (key === 'prod' || key === 'production') return 'prod';
  return value.trim() || 'development';
}

/**
 * DSN from the environment. Missing values and sentry.io hosts are ignored so
 * events are not sent off the GlitchTip project configured for this deploy.
 */
export function sentryDsn(value: string | undefined | null): string | undefined {
  const dsn = value?.trim();
  if (!dsn) return undefined;
  try {
    const host = new URL(dsn).hostname.toLowerCase();
    if (host === 'sentry.io' || host.endsWith('.sentry.io')) return undefined;
  } catch {
    return undefined;
  }
  return dsn;
}
