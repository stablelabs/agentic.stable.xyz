import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { root } from './local';

const flags = [process.argv[2] === 'test' ? 'test' : 'build', '--root', resolve(root, 'agent-wallet')];
if (process.env.WALLET_SOLC) flags.push('--use', process.env.WALLET_SOLC);
const result = spawnSync('forge', flags, { stdio: 'inherit' });
if (result.error) console.error('Foundry is required. Install forge: https://getfoundry.sh/introduction/installation');
process.exitCode = result.status ?? 1;
