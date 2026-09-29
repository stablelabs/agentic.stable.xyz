import 'dotenv/config';
import { strict as assert } from 'node:assert';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium, expect } from '@playwright/test';
import type { Run, Session } from '../shared/contracts';

if (process.env.LIVE_BROWSER_TEST !== '1')
  throw new Error('Set LIVE_BROWSER_TEST=1 only after authorizing a funded testnet purchase.');
const origin = process.env.PUBLIC_ORIGIN || 'http://localhost:5173';
const caps = await fetch(`${origin}/api/agentic/v1/capabilities`).then((r) => r.json());
assert.equal(caps.environment, 'testnet');
assert.equal(caps.network.chainId, 2201);
assert.equal(caps.services[0].available, true, 'Live testnet payments must be ready.');
mkdirSync('evidence/live', { recursive: true });
const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  let mutations = 0;
  let run: Run | undefined;
  const responses: Promise<void>[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/runs'))
      mutations++;
  });
  page.on('response', (response) => {
    if (/\/api\/agentic\/v1\/runs(?:\/[^/]+)?$/.test(new URL(response.url()).pathname))
      responses.push(response.json().then((value: Run) => { run = value; }));
  });
  await page.goto(origin);
  await page.getByRole('button', { name: 'Try it out' }).click();
  await expect(page.getByRole('button', { name: 'Run the demo' })).toBeEnabled({ timeout: 120_000 });
  assert.equal(mutations, 0, 'Opening must not purchase.');
  const ready: Session = await context.request.get(`${origin}/api/agentic/v1/session`).then((r) => r.json());
  assert.equal(ready.activeRunId, null);
  await page.screenshot({ path: 'evidence/live/browser-ready.png', fullPage: true });
  await page.getByRole('button', { name: 'Run the demo' }).click();
  await expect(page.getByRole('heading', { name: 'Invoice extracted' })).toBeVisible({ timeout: 180_000 });
  await Promise.all(responses);
  assert.equal(run?.status, 'completed');
  assert.ok(run?.receipt);
  const completed = run;
  await page.getByText('Verified settlement receipt').click();
  await expect(page.getByRole('link', { name: 'View on Stablescan' })).toHaveAttribute('href', completed.receipt!.explorerUrl);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download JSON' }).click();
  const stream = await (await download).createReadStream();
  assert.ok(stream);
  let json = '';
  for await (const chunk of stream) json += chunk;
  assert.deepEqual(JSON.parse(json), completed.result);
  await page.screenshot({ path: 'evidence/live/browser-result.png', fullPage: true });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Try it out' }).click();
  await expect(page.getByRole('heading', { name: 'Invoice extracted' })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Try it out' }).click();
  await expect(page.getByRole('heading', { name: 'Invoice extracted' })).toBeVisible();
  await Promise.all(responses);
  assert.equal(mutations, 1, 'Reopen and refresh must not purchase again.');
  assert.equal(run?.id, completed.id);
  assert.equal(run?.txHash, completed.txHash);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'evidence/live/browser-result-mobile.png', fullPage: true });
  writeFileSync('evidence/live/browser.json', JSON.stringify({
    checkedAt: new Date().toISOString(), run: completed,
    runMutations: mutations, downloadedJsonMatches: true, recoveredAfterReload: true,
  }, null, 2));
  console.log(`Live browser purchase verified: ${completed.id}. Receipt: ${completed.receipt!.explorerUrl}`);
} finally {
  await browser.close();
}
