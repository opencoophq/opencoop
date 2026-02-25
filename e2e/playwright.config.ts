import { defineConfig, devices } from '@playwright/test';

const isCI = !!process.env.CI;

export default defineConfig({
  testDir: './tests',
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
      testMatch: /global-setup\.ts/,
    },
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: '.auth/admin.json',
      },
      dependencies: ['setup'],
    },
  ],

  webServer: [
    {
      command: isCI
        ? 'cd .. && node apps/api/dist/main'
        : 'cd .. && pnpm dev --filter @opencoop/api',
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
      command: isCI
        ? 'cd ../apps/web && npx next start -p 3002'
        : 'cd .. && pnpm dev --filter @opencoop/web',
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
