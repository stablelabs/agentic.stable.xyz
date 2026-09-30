import 'dotenv/config';
import { configFromEnv } from '../server/config';
import { StableChain } from '../server/payments/chain';
const config = configFromEnv();
console.log(JSON.stringify(await new StableChain(config.rpc).verifyNetwork(), null, 2));
