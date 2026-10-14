import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('./app', import.meta.url)),
  plugins: [react()],
  envPrefix: 'PUBLIC_WALLET_',
  server: { host: '127.0.0.1', port: 5174, strictPort: true },
  preview: { host: '127.0.0.1', port: 5174, strictPort: true },
  build: { outDir: 'dist', emptyOutDir: true },
});
