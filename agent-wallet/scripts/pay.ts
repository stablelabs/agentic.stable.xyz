import { resolve } from 'node:path';
import { encodeFunctionData } from 'viem';
import { walletAbi } from '../client/abi';
import { parseAmount } from '../client/amount';
import { address, identifier } from '../client/config';
import { paymentCheck, publicClient, verifyAccount } from '../client/client';
import { agentAccount, args, exists, loadConfig, newId, readJson, required, run, saveJson, stateDir, submit, type Journal } from './local';

await run(async () => {
  const opt = args(['grant', 'recipient', 'amount', 'payment-id']);
  const grantId = identifier(required(opt.grant, 'grant'));
  const recipient = address(required(opt.recipient, 'recipient'));
  const amount = parseAmount(required(opt.amount, 'amount'));
  const id = opt['payment-id'] ? identifier(opt['payment-id']) : newId();
  const c = await loadConfig(); const account = await agentAccount();
  const intent = { alice: c.alice, agent: account.address, grantId, recipient, amount: String(amount) };
  const path = resolve(stateDir, `payment-${id}.json`);
  const journal: Journal = await exists(path) ? await readJson(path) : { kind: 'payment', id, intent, status: 'created' };
  if (JSON.stringify(journal.intent) !== JSON.stringify(intent)) throw new Error('Payment ID is already bound to different terms.');
  await saveJson(path, journal);
  console.log(`Payment ID (saved before submission): ${id}`);
  const client = publicClient(c.rpcUrl); await verifyAccount(client, c);
  const data = encodeFunctionData({ abi: walletAbi, functionName: 'pay', args: [grantId, id, recipient, amount] });
  try {
    if (!journal.raw) await client.simulateContract({ account, address: c.alice, abi: walletAbi, functionName: 'pay', args: [grantId, id, recipient, amount] });
    await submit(client, account, path, journal, { to: c.alice, data }, paymentCheck(c.alice, grantId, id, recipient, amount));
  } catch (e) {
    if (!journal.raw) {
      journal.status = 'rejected'; await saveJson(path, journal);
      console.error('Payment rejected before submission. No funds or gas were spent by this attempt.');
    } else if (journal.status !== 'reverted') console.error(`Payment outcome unknown. Retry with --payment-id ${id} and identical terms.`);
    throw e;
  }
});
