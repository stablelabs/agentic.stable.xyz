import { afterEach, expect, it } from 'vitest';
import { createServer, type ViteDevServer } from 'vite';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
let server: ViteDevServer | undefined;
let directory: string | undefined;
afterEach(async () => {
  const http = server?.httpServer;
  if (http && 'closeAllConnections' in http) http.closeAllConnections();
  await server?.close(); server = undefined;
  if (directory) await rm(directory, {recursive: true, force: true}); directory = undefined;
});
it('serves the web app and shared token code while denying signer source and private state', async () => {
  // Only a disposable sentinel is used; tests never fetch the real agent key.
  directory = await mkdtemp(resolve('.agent-wallet-fixture-'));
  const sentinel = resolve(directory, 'not-a-key.txt');
  await writeFile(sentinel, 'PRIVATE_FIXTURE_DO_NOT_SERVE');
  server = await createServer({configFile: resolve('web/vite.config.ts'), cacheDir: resolve(directory, 'vite-cache'), logLevel: 'silent', optimizeDeps: {noDiscovery: true, include: []}, server: {port: 0, strictPort: false, preTransformRequests: false}});
  await server.listen();
  const port = (server.httpServer!.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;
  expect((await fetch(base, {signal: AbortSignal.timeout(5000), headers: {connection: 'close'}})).status).toBe(200);
  const shared = await fetch(`${base}/@fs${resolve('shared/client/config.ts')}`, {signal: AbortSignal.timeout(5000), headers: {connection: 'close'}});
  expect(shared.status).toBe(200); expect(await shared.text()).toContain('2201');
  for (const filename of [sentinel, resolve('agent/state.ts')]) {
    const response = await fetch(`${base}/@fs${filename}`, {signal: AbortSignal.timeout(5000), headers: {connection: 'close'}});
    expect(response.status).toBe(403); expect(await response.text()).not.toContain('PRIVATE_FIXTURE_DO_NOT_SERVE');
  }
});
