// Minimal static server for local play-testing of game/ (ES modules need http://).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';

const root = new URL('../game/', import.meta.url).pathname.replace(/^\/(\w:)/, '$1');
const port = Number(process.env.PORT || 5173);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };

createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([\\/])+/, '');
  let file = join(root, path || 'index.html');
  if (!file.startsWith(normalize(root))) { res.writeHead(403).end(); return; }
  // A mistyped page URL (e.g. a link that swallowed trailing punctuation) still opens the game.
  if (!extname(file)) file = join(root, 'index.html');
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': (types[extname(file)] || 'application/octet-stream') + '; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(port, () => console.log(`Draw Road Rush: http://localhost:${port}/`));
