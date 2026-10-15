import { AgentContext, pay, preparePayment, publicError, json } from 'agent-wallet-cli/agent';
import { args, newId, stateDir } from './local';

process.umask(0o077);
try {
  const opt = args(['grant', 'recipient', 'amount', 'payment-id']);
  const ctx = new AgentContext(stateDir);
  const paymentId = opt['payment-id'] || newId();
  await preparePayment(ctx, { paymentId, grant: opt.grant, recipient: opt.recipient, amount: opt.amount });
  console.log(`Payment ID (saved before submission): ${paymentId}`);
  console.log(json(await pay(ctx, { paymentId, grant: opt.grant, recipient: opt.recipient, amount: opt.amount })));
} catch (error) { console.error(publicError(error).message); process.exitCode = 1; }
