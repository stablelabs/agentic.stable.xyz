import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { validateConfig } from 'agent-wallet-sdk';

// Deployment reads only this versioned public configuration, never local keys or journals.
const source = new URL('../deployment/wallet-config.json', import.meta.url);
const target = new URL('../dist/wallet-config.json', import.meta.url);
const config = validateConfig(JSON.parse(await readFile(source, 'utf8')));
if (new URL(config.approvalUrl).protocol !== 'https:') throw new Error('Hosted approval URL must use HTTPS.');
await writeFile(target, JSON.stringify(config, null, 2) + '\n');
console.log(`Prepared public wallet configuration: ${fileURLToPath(target)}`);
