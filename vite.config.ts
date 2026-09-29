import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { renderToString } from 'react-dom/server';
import { createElement } from 'react';
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'local-doc-pages',
      configureServer(server) {
        server.middlewares.use((req, _res, next) => {
          if (req.url && /^\/docs\/[a-z-]+\/?$/.test(req.url))
            req.url = req.url.replace(/\/$/, '') + '/index.html';
          next();
        });
      },
      async transformIndexHtml(html, context) {
        if (!context.server) return html;
        const { default: App } = await context.server.ssrLoadModule('/web/App.tsx');
        return html.replace(
          /<div id="root">[\s\S]*?<\/div>/,
          `<div id="root">${renderToString(createElement(App))}</div>`,
        );
      },
    },
  ],
  server: { port: 5173, strictPort: true, proxy: { '/api': 'http://127.0.0.1:8787' } },
  build: { sourcemap: false },
});
