import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const [command = 'build', ...options] = process.argv.slice(2);
const flags = [command, '--root', root, ...options];
if (process.env.WALLET_SOLC && (command === 'build' || command === 'test')) {
  flags.push('--use', process.env.WALLET_SOLC);
}

const result = spawnSync('forge', flags, { stdio: 'inherit' });
if (result.error) {
  console.error('Foundry is required. Install forge: https://getfoundry.sh/introduction/installation');
}
process.exitCode = result.status ?? 1;
