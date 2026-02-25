import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'html',
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
      command: 'cd .. && pnpm dev --filter @opencoop/api',
      url: 'http://localhost:3001/api/docs',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        DATABASE_URL: 'postgresql://opencoop:opencoop@localhost:5433/opencoop_test',
        REDIS_URL: 'redis://localhost:6380',
        JWT_SECRET: 'test-jwt-secret',
        FRONTEND_URL: 'http://localhost:3002',
      },
    },
    {
      command: 'cd .. && pnpm dev --filter @opencoop/web',
      url: 'http://localhost:3002',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        API_URL: 'http://localhost:3001',
        NEXT_PUBLIC_API_URL: 'http://localhost:3001',
        NEXTAUTH_SECRET: 'test-nextauth-secret',
        NEXTAUTH_URL: 'http://localhost:3002',
      },
    },
  ],
});
