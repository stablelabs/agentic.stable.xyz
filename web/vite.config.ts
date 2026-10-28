import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
const path = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));

export default defineConfig(({mode}) => ({
  root: path('./'),
  cacheDir: path(`../node_modules/.vite/agent-spending-${mode}`),
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path('./src') } },
  envPrefix: 'PUBLIC_WALLET_',
  server: {
    host: '127.0.0.1', port: 5174, strictPort: true,
    // Shared browser code is allowed; the agent signer and its state stay outside the served tree.
    fs: { allow: [path('./'), path('../shared/'), path('../node_modules/')], deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/.agent-wallet*/**'] },
  },
  preview: { host: '127.0.0.1', port: 5174, strictPort: true },
  build: { outDir: 'dist', emptyOutDir: true },
}));
