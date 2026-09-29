import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mockDemo } from './fixtures';
import { statuses } from '../../shared/contracts';
test('explicit purchase, delivered JSON, recovery on reopen and analytics deduplication', async ({
  page,
}) => {
  const stats = await mockDemo(page);
  await page.addInitScript(() => {
    (window as any).testEvents = [];
    window.agenticAnalytics = (name, properties) =>
      (window as any).testEvents.push({ name, properties });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Try it out' }).click();
  await expect(page.getByText('Preview — no payment is sent')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Run the demo' })).toBeEnabled();
  expect(stats.runs).toBe(0);
  await page.screenshot({ path: 'test-results/demo-ready.png', fullPage: true });
  await page.getByRole('button', { name: 'Run the demo' }).click();
  await expect(page.getByRole('heading', { name: 'Invoice extracted' })).toBeVisible();
  expect(stats.runs).toBe(1);
  await page.getByText('Verified settlement receipt').click();
  await expect(page.getByRole('link', { name: 'View on Stablescan' })).toHaveCount(0);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download JSON' }).click();
  const stream = await (await download).createReadStream();
  let json = '';
  for await (const chunk of stream!) json += chunk;
  expect(JSON.parse(json)).toMatchObject({ vendor: 'Example Studio', total: '50.00' });
  await page.screenshot({ path: 'test-results/demo-result.png', fullPage: true });
  const a11y = await new AxeBuilder({ page }).analyze();
  expect(a11y.violations.filter((v) => ['serious', 'critical'].includes(v.impact || ''))).toEqual(
    [],
  );
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Try it out' }).click();
  await expect(page.getByRole('heading', { name: 'Invoice extracted' })).toBeVisible();
  expect(stats.runs).toBe(1);
  const events = await page.evaluate(() => (window as any).testEvents);
  expect(events.filter((e: any) => e.name === 'result_delivered')).toHaveLength(1);
});
test('lost mutation response preserves the idempotency key across retry', async ({ page }) => {
  const stats = await mockDemo(page, { lostResponse: true });
  await page.goto('/');
  await page.getByRole('button', { name: 'Try it out' }).click();
  await page.getByRole('button', { name: 'Run the demo' }).click();
  await expect(page.getByRole('alert')).toContainText('Connection interrupted');
  await page.getByRole('button', { name: 'Check again' }).click();
  await expect(page.getByRole('heading', { name: 'Invoice extracted' })).toBeVisible();
  expect(stats.keys).toHaveLength(2);
  expect(new Set(stats.keys).size).toBe(1);
});
for (const status of statuses) {
  test(`maps ${status} to its correct recovery controls`, async ({ page }) => {
    await mockDemo(page, { status });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await page.getByRole('button', { name: 'Try it out' }).click();
    await page.getByRole('button', { name: 'Run the demo' }).click();
    await expect(page.getByText(`Fixture: ${status}`, { exact: true }).first()).toBeVisible();
    if (!['settled', 'completed'].includes(status)) await expect(page.locator('.event-success')).toHaveCount(0);
    if (['payment_unknown', 'delivery_failed'].includes(status)) {
      await expect(page.getByRole('button', { name: 'Resume this purchase' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Review another purchase' })).toHaveCount(0);
    }
    if (!['completed', 'delivery_failed', 'settled', 'delivering'].includes(status))
      await expect(page.getByText('Verified settlement receipt')).toHaveCount(0);
    expect(await page.locator('dialog').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
      true,
    );
    if (['completed', 'payment_unknown', 'delivery_failed'].includes(status))
      await page.screenshot({ path: `test-results/demo-${status}-mobile.png`, fullPage: true });
  });
}
test('expired quote requires renewed visible acceptance', async ({ page }) => {
  const stats = await mockDemo(page, { expiredQuote: true });
  await page.goto('/');
  await page.getByRole('button', { name: 'Try it out' }).click();
  await expect(page.getByRole('button', { name: 'Refresh quote' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Run the demo' })).toHaveCount(0);
  expect(stats.runs).toBe(0);
});
test('funding exposes no purchase action', async ({ page }) => {
  const stats = await mockDemo(page, { funding: true });
  await page.goto('/');
  await page.getByRole('button', { name: 'Try it out' }).click();
  await expect(page.getByRole('status')).toContainText('Preparing your testnet wallet');
  await expect(page.getByRole('button', { name: 'Run the demo' })).toHaveCount(0);
  expect(stats.runs).toBe(0);
});
test('rate limiting honors Retry-After before another network request', async ({ page }) => {
  let requests = 0;
  await page.route('**/api/agentic/v1/capabilities', async (route) => {
    requests++;
    await route.fulfill({
      status: 429,
      contentType: 'application/json',
      headers: { 'Retry-After': '60' },
      body: JSON.stringify({
        error: { code: 'RATE_LIMITED', message: 'Please wait before trying again.' },
      }),
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Try it out' }).click();
  await expect(page.getByRole('alert')).toContainText('Please wait');
  await page.getByRole('button', { name: 'Check again' }).click();
  await expect(page.getByRole('alert')).toContainText('Please wait');
  expect(requests).toBe(1);
});
for (const code of ['BUDGET_EXCEEDED', 'INSUFFICIENT_FUNDS', 'QUOTE_EXPIRED']) {
  test(`${code} cannot look like a successful purchase`, async ({ page }) => {
    await mockDemo(page, { failRun: code });
    await page.goto('/');
    await page.getByRole('button', { name: 'Try it out' }).click();
    await page.getByRole('button', { name: 'Run the demo' }).click();
    await expect(page.getByRole('alert')).toContainText('Fixture rejection');
    await expect(page.getByText('Verified settlement receipt')).toHaveCount(0);
  });
}
