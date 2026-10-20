import { parseArgs } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { validateConfig, CHAIN_ID, TOKEN, RPC, publicClient } from '../shared/owner.js';
import { verifyNetwork } from '../shared/protocol.js';

// Only public settings: no owner key, activation, deployment, or signing.
const { values } = parseArgs({ options: { owner: { type: 'string' }, agent: { type: 'string' }, rpc: { type: 'string' }, 'approval-url': { type: 'string' }, output: { type: 'string' } } });
if (!values.owner) throw new Error('Usage: npm run wallet:configure -- --owner ADDRESS [--agent ADDRESS] [--output FILE]');
const config = validateConfig({ schemaVersion: 2, chainId: CHAIN_ID, token: TOKEN, rpcUrl: values.rpc || RPC, alice: values.owner, defaultAgent: values.agent, approvalUrl: values['approval-url'] || 'http://localhost:5174' });
await verifyNetwork(publicClient(config.rpcUrl));
const target = resolve(values.output || 'web/public/wallet-config.json');
await mkdir(resolve(target, '..'), { recursive: true });
await writeFile(target, JSON.stringify(config, null, 2) + '\n');
console.log(`Public wallet settings written to ${target}. The owner approves the agent directly in the UI.`);
