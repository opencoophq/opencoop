import { defineConfig, devices } from '@playwright/test';

const isCI = !!process.env.CI;

export default defineConfig({
  testDir: './tests',
  testMatch: /\.spec\.ts$/,
  fullyParallel: false,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  workers: 1,
  reporter: isCI ? 'github' : 'html',
  timeout: 30_000,

  use: {
    baseURL: 'http://localhost:3002',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'setup',
      testDir: '.',
      testMatch: /global-setup\.ts/,
    },
    {
      name: 'public',
      testMatch: /tests\/public\/.*/,
      use: {
        ...devices['Desktop Chrome'],
        storageState: {
          cookies: [],
          origins: [
            {
              origin: 'http://localhost:3002',
              localStorage: [
                { name: 'opencoop-cookie-notice-dismissed', value: '1' },
              ],
            },
          ],
        },
      },
      dependencies: ['setup'],
    },
    {
      name: 'admin',
      testMatch: /tests\/admin\/.*/,
      use: {
        ...devices['Desktop Chrome'],
        storageState: '.auth/admin.json',
      },
      dependencies: ['setup'],
    },
    {
      name: 'shareholder',
      testMatch: /tests\/shareholder\/.*/,
      use: {
        ...devices['Desktop Chrome'],
        storageState: '.auth/shareholder.json',
      },
      dependencies: ['setup'],
    },
  ],

  webServer: [
    {
      // Local: run the package's own "dev" script through `pnpm --filter`
      // directly, bypassing root `turbo dev`. Turbo 2's default strict
      // envMode silently drops undeclared env vars (DATABASE_URL,
      // JWT_SECRET, ...) from spawned tasks, which crashed the API with
      // "JwtStrategy requires a secret or key" even though they were set
      // right here. `pnpm --filter` runs the script directly, no turbo in
      // between, so the `env` below reaches the process unfiltered.
      command: isCI
        ? 'cd .. && node apps/api/dist/main'
        : 'cd .. && pnpm --filter @opencoop/api dev',
      url: 'http://localhost:3001/docs',
      reuseExistingServer: !isCI,
      stdout: 'pipe',
      timeout: isCI ? 60_000 : 120_000,
      env: {
        DATABASE_URL: 'postgresql://opencoop:opencoop@localhost:5433/opencoop_test',
        REDIS_URL: 'redis://localhost:6380',
        JWT_SECRET: 'test-jwt-secret',
        FRONTEND_URL: 'http://localhost:3002',
      },
    },
    {
      // Same reason as the API entry above: bypass turbo so `env` below is
      // not subject to its strict envMode filtering.
      command: isCI
        ? 'cd ../apps/web && npx next start -p 3002'
        : 'cd .. && pnpm --filter @opencoop/web dev',
      url: 'http://localhost:3002',
      reuseExistingServer: !isCI,
      stdout: 'pipe',
      timeout: isCI ? 60_000 : 120_000,
      env: {
        API_URL: 'http://localhost:3001',
        NEXT_PUBLIC_API_URL: 'http://localhost:3001',
        NEXTAUTH_SECRET: 'test-nextauth-secret',
        NEXTAUTH_URL: 'http://localhost:3002',
      },
    },
  ],
});
