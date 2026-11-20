import fs from 'node:fs';
import { defineConfig } from '@playwright/test';

const CONTAINER_HEADLESS_SHELL =
  '/ms-playwright/chrome-headless-shell-linux64/chrome-headless-shell';

const executablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
  (fs.existsSync(CONTAINER_HEADLESS_SHELL) ? CONTAINER_HEADLESS_SHELL : undefined);

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: {
    timeout: 7_000,
  },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000',
    headless: true,
    browserName: 'chromium',
    launchOptions: executablePath ? { executablePath } : undefined,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop-1440x900',
      grep: /Desktop \(1440x900\)/,
      use: {
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: 'mobile-390x844',
      grep: /Mobile \(390x844\)/,
      use: {
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        isMobile: true,
      },
    },
  ],
});
