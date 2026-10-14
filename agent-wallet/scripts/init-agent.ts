import { resolve } from 'node:path';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { configPath, exists, loadConfig, publishConfig, readJson, run, saveJson, stateDir } from './local';

await run(async () => {
  const path = resolve(stateDir, 'agent-key.json');
  if (await exists(path)) {
    const record = await readJson<{ address: string }>(path);
    await publishAgent(record.address);
    console.log(`Existing agent address: ${record.address}\nKey retained at ${path}`);
    return;
  }
  const privateKey = generatePrivateKey();
  const address = privateKeyToAccount(privateKey).address;
  await saveJson(path, { address, privateKey, createdAt: new Date().toISOString() });
  await publishAgent(address);
  console.log(`Agent address: ${address}\nPrivate test-only key stored with mode 600 at ${path}\nFund this address separately with test USDT0 for gas.`);
  async function publishAgent(value: string) {
    if (!await exists(configPath)) return;
    const config = { ...await loadConfig(), defaultAgent: value as typeof address };
    await saveJson(configPath, config); await publishConfig(config);
  }
});
