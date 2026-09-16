import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;

export default defineConfig({
  testDir: './tests',
  // tests/*.test.mjs are node:test files (npm run test:rules), not browser tests.
  testMatch: '**/*.spec.mjs',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? 'list' : [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'mobile-chromium',
      use: {
        ...devices['Pixel 7'],
        // CI images often ship their own browser. Point CHROMIUM_PATH at it to skip
        // `npx playwright install`; unset, Playwright uses its own download.
        launchOptions: { executablePath: process.env.CHROMIUM_PATH || undefined },
      },
    },
    {
      // Same engine WKWebView uses on iOS. Not run by `npm test`; see `npm run test:webkit`.
      name: 'mobile-webkit',
      use: {
        ...devices['iPhone 14'],
      },
    },
  ],
  webServer: {
    command: 'node tests/server.mjs',
    url: `http://127.0.0.1:${PORT}/index.html`,
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
});
