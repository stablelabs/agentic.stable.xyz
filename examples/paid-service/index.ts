import 'dotenv/config';
import { configFromEnv } from '../../server/config';
import { Store } from '../../server/store';
import { StableChain } from '../../server/payments/chain';
import { Engine } from '../../server/engine';
import { createApp } from '../../server/app';
const config = configFromEnv('seller');
const store = new Store(process.env.SELLER_DATABASE_PATH || './data/seller.sqlite');
const engine = new Engine(store, new StableChain(config.rpc), config);
const port = Number(process.env.SELLER_PORT || 8788);
createApp(engine, true).listen(port, '0.0.0.0', () =>
  console.log(`Invoice seller on http://localhost:${port}`),
);
