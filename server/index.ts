import 'dotenv/config';
import { configFromEnv } from './config';
import { Store } from './store';
import { StableChain } from './payments/chain';
import { Engine } from './engine';
import { createApp } from './app';
const config = configFromEnv();
const store = new Store(config.database);
const engine = new Engine(store, new StableChain(config.rpc), config);
const port = Number(process.env.PORT || 8787);
const server = createApp(engine).listen(port, '0.0.0.0', () =>
  console.log(
    `Agentic API on http://localhost:${port}; payments ${config.enabled ? 'testnet' : 'disabled'}`,
  ),
);
const worker = setInterval(() => {
  void engine.tick().catch(() => console.error('Worker unavailable; retrying next interval.'));
}, 2000);
process.on('SIGTERM', () => {
  clearInterval(worker);
  server.close(() => process.exit(0));
});
