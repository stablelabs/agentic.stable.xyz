import { defineConfig } from '@playwright/test';

const port = Number(process.env.WALLET_TEST_PORT || 5175);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('WALLET_TEST_PORT must be a valid TCP port.');
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './tests',
  outputDir: './test-results',
  fullyParallel: false,
  use: { baseURL, browserName: 'chromium', viewport: { width: 1280, height: 900 } },
  webServer: { command: `npm run dev -- --port ${port}`, cwd: '.', url: baseURL, reuseExistingServer: !process.env.CI },
});
