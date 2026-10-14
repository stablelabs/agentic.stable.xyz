import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  outputDir: './test-results',
  fullyParallel: false,
  use: { baseURL: 'http://127.0.0.1:5174', browserName: 'chromium', viewport: { width: 1280, height: 900 } },
  webServer: { command: 'npm run wallet:dev', cwd: '..', url: 'http://127.0.0.1:5174', reuseExistingServer: !process.env.CI },
});
