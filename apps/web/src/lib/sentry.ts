// Shared helpers for the client/server/edge Sentry (GlitchTip) configs.
//
// DSN: NEXT_PUBLIC_SENTRY_DSN is a GitHub Actions secret, inlined at build
// time via a Docker build arg. Fall back to the committed self-hosted
// GlitchTip DSN when the secret is unset (`undefined`) or empty (`""`).
const FALLBACK_SENTRY_DSN = 'https://fc042137f1984c4588e9e22a1efd875c@errors.armlab.com/12';

export function getSentryDsn(): string {
  return process.env.NEXT_PUBLIC_SENTRY_DSN || FALLBACK_SENTRY_DSN;
}

// Server/edge DSN: prefer the runtime SENTRY_DSN (same var the API uses),
// then the build-time NEXT_PUBLIC_SENTRY_DSN, then the committed fallback.
export function getServerSentryDsn(): string {
  return process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN || FALLBACK_SENTRY_DSN;
}

// Client-side environment: "acc" on acceptance hosts, "production" otherwise.
// Matches hostnames like acc.opencoop.be, app-acc.opencoop.be, acc-app.opencoop.be.
export function getClientSentryEnvironment(): string {
  if (/(^|[.-])acc([.-]|$)/.test(window.location.hostname)) {
    return 'acc';
  }
  return 'production';
}

// Server/edge environment: from SENTRY_ENVIRONMENT, never NODE_ENV (acc runs
// with NODE_ENV=production).
export function getServerSentryEnvironment(): string {
  return process.env.SENTRY_ENVIRONMENT || 'production';
}
