import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
test('desktop fold, guides, keyboard and honest outage', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'This is how agents settle on Stable.',
  );
  await expect(page.locator('footer')).toBeInViewport();
  await page.evaluate(() => document.fonts.ready);
  const footer = await page.locator('footer').boundingBox();
  expect(footer!.y + footer!.height).toBeLessThanOrEqual(900);
  await expect(page.locator('.invoice')).toBeVisible();
  await page.screenshot({ path: 'test-results/default-desktop.png', fullPage: true });
  const a11y = await new AxeBuilder({ page }).analyze();
  expect(a11y.violations.filter((v) => ['serious', 'critical'].includes(v.impact || ''))).toEqual(
    [],
  );
  const button = page.getByRole('button', { name: 'Try it out' });
  await button.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('temporarily unavailable');
  await expect(page.getByRole('button', { name: 'Run the demo' })).toHaveCount(0);
  await page.screenshot({ path: 'test-results/unavailable-desktop.png', fullPage: true });
  await page.keyboard.press('Escape');
  await expect(button).toBeFocused();
  await page.getByRole('button', { name: 'Use with your agent', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('npm run buyer');
  await page.getByRole('link', { name: 'Read the full guide' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Use with your agent');
});
for (const width of [390, 320, 720]) {
  test(`responsive and accessibility at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 720 ? 450 : 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: `test-results/default-${width}.png`, fullPage: true });
    await page.getByRole('button', { name: 'Try it out' }).click();
    await expect(page.getByRole('alert')).toContainText('temporarily unavailable');
    expect(await page.locator('dialog').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
      true,
    );
    const result = await new AxeBuilder({ page }).analyze();
    expect(
      result.violations.filter((v) => ['serious', 'critical'].includes(v.impact || '')),
    ).toEqual([]);
    await page.screenshot({ path: `test-results/unavailable-${width}.png`, fullPage: true });
  });
}
test('narrative and guides remain available without JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto('http://localhost:5173');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('settle on Stable');
  await page.getByRole('link', { name: 'Quickstart', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Run the Stable agentic demo');
  await context.close();
});
