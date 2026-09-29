import { readFileSync, writeFileSync } from 'node:fs';
import { renderToString } from 'react-dom/server';
import App from '../web/App';
const html = readFileSync('dist/index.html', 'utf8');
writeFileSync(
  'dist/index.html',
  html.replace(/<div id="root">[\s\S]*?<\/div>/, `<div id="root">${renderToString(<App />)}</div>`),
);
