import http from 'node:http';
import { URL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { runScan } from '../lib/gateScanner.js';

const state = { killSwitch: false };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/api/scan') {
    try {
      const scan = await runScan();
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(scan));
    } catch (err) {
      res.statusCode = 500;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: 'scan_failed', detail: String(err.message || err) }));
    }
    return;
  }

  if (url.pathname === '/api/kill-switch' && req.method === 'POST') {
    state.killSwitch = !state.killSwitch;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ killSwitch: state.killSwitch }));
    return;
  }

  const file = url.pathname === '/' ? '/index.html' : url.pathname;
  if (['/index.html', '/app.js', '/style.css'].includes(file)) {
    try {
      const data = await readFile(new URL(`../public${file}`, import.meta.url));
      if (file.endsWith('.js')) res.setHeader('content-type', 'text/javascript');
      if (file.endsWith('.css')) res.setHeader('content-type', 'text/css');
      res.end(data);
    } catch {
      res.statusCode = 404;
      res.end('Not found');
    }
    return;
  }

  res.statusCode = 404;
  res.end('Not found');
});

if (import.meta.url === `file://${process.argv[1]}`) {
  server.listen(3000, () => console.log('server on http://localhost:3000'));
}
