import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { marked } from 'marked';
const pages = [
  'quickstart',
  'agent-setup',
  'accept-payments',
  'source',
  'deployment',
  'cloudflare',
  'acceptance',
];
for (const name of pages) {
  const source = readFileSync(`docs/${name}.md`, 'utf8');
  const title = source.split('\n')[0].replace(/^# /, '');
  mkdirSync(`public/docs/${name}`, { recursive: true });
  writeFileSync(
    `public/docs/${name}/index.html`,
    `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${title} | Stable Agentic Payments</title><link rel="icon" href="/brand/favicon.png"><link rel="stylesheet" href="/docs/style.css"></head><body><header><a href="/">Stable / Agentic payments</a><nav><a href="/docs/quickstart/">Quickstart</a><a href="/docs/agent-setup/">Agent setup</a><a href="/docs/accept-payments/">Accept payments</a></nav></header><main>${marked.parse(source)}</main></body></html>`,
  );
}
