const createNextIntlPlugin = require('next-intl/plugin');
const { withSentryConfig } = require('@sentry/nextjs');

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  transpilePackages: ['@opencoop/shared'],
  // Next 14.2: the instrumentation hook (src/instrumentation.ts) is experimental.
  // Required for Sentry server/edge init to run.
  experimental: {
    instrumentationHook: true,
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

// Build options: disable source-map upload so no SENTRY_AUTH_TOKEN is needed and
// the build never fails on missing credentials. Keep it quiet and telemetry-free.
const sentryBuildOptions = {
  silent: true,
  telemetry: false,
  sourcemaps: {
    disable: true,
  },
};

module.exports = withSentryConfig(withNextIntl(nextConfig), sentryBuildOptions);
