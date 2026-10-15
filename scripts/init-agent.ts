import { AgentContext, publicError } from 'agent-wallet-cli/agent';
import { loadConfig, publishConfig, stateDir } from './local';

process.umask(0o077);
try {
  const ctx = new AgentContext(stateDir);
  const result = await ctx.init();
  await ctx.state.lock(async () => {
    if (await ctx.state.has('config.json')) {
      const config = { ...await loadConfig(), defaultAgent: result.address };
      await ctx.state.write('config.json', config);
      await publishConfig(config);
    }
  });
  console.log(`${result.retained ? 'Existing agent address' : 'Agent address'}: ${result.address}\nKey retained at ${ctx.state.path('agent-key.json')}\nFund this address separately with test USDT0 for gas.`);
} catch (error) { console.error(publicError(error).message); process.exitCode = 1; }
