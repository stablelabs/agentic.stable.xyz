# Verification evidence

- `backend.json`: Vitest backend, HTTP, chain-evidence, and database test results. All payments use a fake adapter.
- `browser.json`: Playwright interaction, recovery, accessibility, and responsive-layout results. Payment success views use explicitly labeled fixtures.
- `lighthouse-mobile.json`: a mobile Lighthouse run against the local production build with payments disabled.
- `screenshots/`: captured default, unavailable, ready, delivered, and recovery states. Ready/delivered/recovery screenshots are fixtures, not real receipts.

The Docker image built successfully from the lockfile on Node 22. Its backend tests passed. The production-mode container returned HTTP 200 for the page/guides, the canonical URL only for the configured production origin, and HTTP 503 for live readiness with payments disabled. The temporary container was stopped after verification.

Live receipts do not exist yet. See `docs/acceptance.md` for precise outstanding requirements.
