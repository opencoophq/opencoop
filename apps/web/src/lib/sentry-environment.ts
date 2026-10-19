/**
 * The GlitchTip/Sentry environment tag. acc and prod run the same image with
 * NODE_ENV=production, so NODE_ENV alone tags acc events as "production".
 * Order: SENTRY_ENVIRONMENT if set, "acceptance" when the app's own URL is an
 * acc.* host, otherwise NODE_ENV.
 */
export function sentryEnvironment(appUrl?: string | null, explicit?: string, nodeEnv?: string): string {
  if (explicit) return explicit;
  if (appUrl) {
    try {
      if (new URL(appUrl).hostname.startsWith('acc.')) return 'acceptance';
    } catch {
      // Not a URL; fall through.
    }
  }
  return nodeEnv || 'development';
}
