import { expect, it } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

async function sources(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(entry => entry.isDirectory() ? sources(resolve(directory, entry.name)) : /\.tsx?$/.test(entry.name) ? [resolve(directory, entry.name)] : []))).flat();
}

it('defines four source-owning workspace packages with explicit SDK dependencies', async () => {
  const root = JSON.parse(await readFile('package.json', 'utf8'));
  expect(root.workspaces).toEqual(['packages/sdk', 'packages/cli', 'packages/web', 'packages/contracts']);
  expect(root.dependencies?.react).toBeUndefined();
  const sdk = JSON.parse(await readFile('packages/sdk/package.json', 'utf8'));
  for (const name of ['sdk', 'cli', 'web', 'contracts']) {
    const manifest = JSON.parse(await readFile(`packages/${name}/package.json`, 'utf8'));
    expect(manifest.name).toBe(['cli', 'sdk'].includes(name) ? `@stablechain/agent-wallet-${name}` : `agent-wallet-${name}`);
    expect(manifest.scripts.build).toBeTruthy();
    expect(manifest.scripts.check).toBeTruthy();
    expect(manifest.scripts.test).toBeTruthy();
    if (name === 'contracts') {
      expect(await readFile('packages/contracts/src/AgentWallet.sol', 'utf8')).toContain('contract AgentWallet');
      expect(await readFile('packages/contracts/foundry.toml', 'utf8')).toContain('src = "src"');
      expect(manifest.dependencies).toBeUndefined();
    } else {
      expect((await sources(`packages/${name}/src`)).length).toBeGreaterThan(0);
      if (name !== 'sdk') expect(manifest.dependencies['@stablechain/agent-wallet-sdk']).toBe(sdk.version);
    }
  }
});

it('keeps source imports inside each package and consumes shared code by package export', async () => {
  for (const name of ['sdk', 'cli', 'web']) {
    const directory = resolve(`packages/${name}`);
    const imports: string[] = [];
    for (const filename of await sources(resolve(directory, 'src'))) {
      const text = await readFile(filename, 'utf8');
      const modules = [...text.matchAll(/(?:from\s*|import\s*\()(['"])([^'"]+)\1/g)].map(match => match[2]);
      imports.push(...modules);
      for (const module of modules.filter(module => module.startsWith('.'))) {
        expect(resolve(dirname(filename), module).startsWith(directory + sep)).toBe(true);
      }
    }
    if (name === 'sdk') {
      expect(imports.some(module => module.startsWith('node:') || module.startsWith('@stablechain/agent-wallet-cli') || module === 'react')).toBe(false);
    } else expect(imports).toContain(name === 'web' ? '@stablechain/agent-wallet-sdk' : '@stablechain/agent-wallet-sdk/protocol');
  }
});

it('preserves root CLI state paths when invoked through the root npm command', async () => {
  const probe = `workspace-state-probe-${process.pid}`;
  const output = await promisify(execFile)('npm', ['--silent', 'run', 'wallet', '--', 'status', '--json', '--state-dir', probe]);
  expect(JSON.parse(output.stdout).data.stateDir).toBe(resolve(probe));
});
