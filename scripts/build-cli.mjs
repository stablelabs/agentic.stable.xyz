import { build } from 'esbuild';
import { chmod, cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const target = join(root, 'packages/cli');
// Build only from explicit source paths; never copy local config, keys or journals.
for (const directory of ['dist', 'docs', 'skills']) await rm(join(target, directory), { recursive: true, force: true });
await mkdir(join(target, 'dist'), { recursive: true });
const result = await build({
  absWorkingDir: root,
  entryPoints: ['agent/main.ts'],
  outfile: join(target, 'dist/main.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  legalComments: 'linked',
  metafile: true,
});
await chmod(join(target, 'dist/main.js'), 0o755);

// Preserve license texts for the third-party code included in the bundle.
const dependencies = new Map();
for (const input of Object.keys(result.metafile.inputs)) {
  if (!input.includes('node_modules/')) continue;
  let directory = dirname(resolve(root, input));
  while (directory !== dirname(directory)) {
    try {
      const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
      if (manifest.name) { dependencies.set(directory, manifest); break; }
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    directory = dirname(directory);
  }
}
const notices = [];
for (const [directory, manifest] of [...dependencies].sort(([a], [b]) => a.localeCompare(b))) {
  const files = (await readdir(directory)).filter(name => /^(licen[cs]e|copying|notice)([.-]|$)/i.test(name));
  if (!files.length) throw new Error(`Missing license notice for bundled dependency ${manifest.name}.`);
  notices.push(`${manifest.name}@${manifest.version}\n${(await Promise.all(files.map(file => readFile(join(directory, file), 'utf8')))).join('\n')}`);
}
// esbuild can inspect optional modules that are later removed from its output.
// Their presence depends on the install platform, even when main.js is identical.
// Preserve the release's complete notice set, and reject a dependency/license
// change until its notice has been reviewed and added to this source file.
const releaseNotices = await readFile(join(target, 'runtime-notices.txt'), 'utf8');
for (const notice of notices) {
  if (!releaseNotices.includes(notice)) {
    throw new Error(`Update packages/cli/runtime-notices.txt for ${notice.split('\n')[0]}.`);
  }
}
await writeFile(join(target, 'dist/THIRD_PARTY_NOTICES.txt'), releaseNotices);
await mkdir(join(target, 'docs'), { recursive: true });
for (const name of ['cli.md', 'wallet.md']) await cp(join(root, 'docs', name), join(target, 'docs', name));
await cp(join(root, 'skills/agent-wallet-cli'), join(target, 'skills/agent-wallet-cli'), { recursive: true });
console.error('Built standalone agent-wallet with bundled runtime, docs, and skill.');
