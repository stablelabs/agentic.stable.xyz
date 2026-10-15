import { expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { build } from 'vite';

const execute = promisify(execFile);
const root = resolve('.');
it('installs packed CLI and SDK artifacts outside the repo with only production dependencies', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'agent-wallet-consumer-'));
  try {
    const tarballs: string[] = [];
    for (const name of ['cli', 'sdk']) {
      const result = await execute('npm', ['pack', resolve(root, `packages/${name}`), '--json', '--pack-destination', directory], { cwd: directory });
      const pack = JSON.parse(result.stdout)[0];
      expect(pack.files.every((file: { path: string }) => /^(package\.json|README\.md|dist\/)/.test(file.path))).toBe(true);
      expect(pack.files.some((file: { path: string }) => file.path.startsWith(name === 'sdk' ? 'dist/agent/' : 'dist/client/'))).toBe(false);
      expect(pack.files.some((file: { path: string }) => /key|journal|\.env|wallet-config/.test(file.path))).toBe(false);
      tarballs.push(resolve(directory, pack.filename));
    }
    const viem = JSON.parse(await readFile(resolve(root, 'node_modules/viem/package.json'), 'utf8')).version;
    await writeFile(resolve(directory, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
    await execute('npm', ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', ...tarballs, `viem@${viem}`], { cwd: directory, timeout: 120_000 });
    const cli = await execute(resolve(directory, 'node_modules/.bin/agent-wallet'), ['--help', '--json'], { cwd: directory });
    expect(JSON.parse(cli.stdout).data).toContain('payments resume');
    const deps = JSON.parse((await execute('npm', ['ls', '--omit=dev', '--all', '--json'], { cwd: directory })).stdout);
    const installed: string[] = [];
    function visit(tree: { dependencies?: Record<string, { version?: string; dependencies?: unknown }> }) {
      for (const [name, record] of Object.entries(tree.dependencies ?? {})) {
        // npm also lists absent optional peers as {}, which are not installed packages.
        if (record.version) installed.push(name);
        visit(record as Parameters<typeof visit>[0]);
      }
    }
    visit(deps);
    for (const name of ['react', 'tsx', 'typescript', 'vite', 'dotenv']) expect(installed).not.toContain(name);
    const entry = resolve(directory, 'consumer.mts');
    await writeFile(entry, `import { createOwnerClient, type WalletConfig } from 'agent-wallet-sdk';
import { createPublicClient, createWalletClient, http } from 'viem';
export const connect = (config: WalletConfig) => createOwnerClient({ config,
  publicClient: createPublicClient({ transport: http(config.rpcUrl) }),
  walletClient: createWalletClient({ transport: http(config.rpcUrl) }),
});\n`);
    await execute(process.execPath, [resolve(root, 'node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--skipLibCheck', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--target', 'ES2022', entry], { cwd: directory });
    const bundle = await build({ configFile: false, root: directory, logLevel: 'silent', build: { write: false, lib: { entry, formats: ['es'] } } });
    const outputs = Array.isArray(bundle) ? bundle.flatMap(item => item.output) : 'output' in bundle ? bundle.output : [];
    const chunks = outputs.filter(item => item.type === 'chunk');
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.some(chunk => chunk.type === 'chunk' && Object.keys(chunk.modules).some(path => /agent-wallet-sdk.*\/dist\/index\.js$/.test(path)))).toBe(true);
    for (const chunk of chunks) if (chunk.type === 'chunk') {
      expect(chunk.code).not.toMatch(/node:fs|node:path|from ["']react["']/);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
}, 120_000);
