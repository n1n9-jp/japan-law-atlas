import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.BASE_URL ?? 'http://127.0.0.1:3000';

export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  fullyParallel: false,
  retries: 1,
  use: {
    baseURL,
    locale: 'ja-JP',
    trace: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: process.env.BASE_URL
    ? undefined
    : {
        command: 'npm run start',
        url: 'http://127.0.0.1:3000',
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
