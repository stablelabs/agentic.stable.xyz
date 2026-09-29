# agentic.stable.xyz

Self-contained Stable Testnet invoice-purchase demo. The site owns its backend, encrypted session wallets, transactional budget ledger, payment recovery, paid service, and local buyer example.

```sh
git clone https://github.com/stablelabs/agentic.stable.xyz.git
cd agentic.stable.xyz
npm ci
cp .env.example .env
npm run dev
```

Open http://localhost:5173. Payments default to disabled until funding and testnet verification are configured.

The GitHub repository is currently private; cloning requires repository access. Keep secrets in the ignored `.env` file, never in `.env.example`.

- [Quickstart](docs/quickstart.md)
- [Agent setup](docs/agent-setup.md)
- [Accept payments](docs/accept-payments.md)
- [Deployment](docs/deployment.md)
- [Acceptance evidence and blockers](docs/acceptance.md)
- [Product requirements](prd.md)

Tests use fake chain adapters only under `tests/`. The public API never loads a fixture or silently substitutes success for an outage.
