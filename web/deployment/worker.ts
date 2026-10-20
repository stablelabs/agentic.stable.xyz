import { DurableObject } from 'cloudflare:workers';

// Preserve the retired demo's namespace without exposing its API or altering its ledger.
// Removing this export requires a separate, deliberate storage-retirement plan.
export class FundingLedger extends DurableObject<Env> {}

// Cloudflare serves matching static assets first. Everything else is unavailable,
// including the retired payment API and local key/state paths.
export default {
  fetch() {
    return new Response('Not found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;
