// Serve build/web/ over HTTP for local play and for Playwright's webServer.
//
// This used to be `python3 -m http.server`, which is fine on the Linux CI
// runners and broken on a Windows dev machine: `python3` there resolves to the
// Microsoft Store alias, which prints "Python was not found" and exits 9009
// rather than starting a server. `npm run serve` and every e2e test died on it.
// Node is already a hard dependency of this repo and Python is not, so the
// server is Node's job.
//
//   node serve.mjs [--port 8000] [--dir build/web] [--host 127.0.0.1]
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join, resolve, extname, sep } from 'node:path';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const PORT = Number(arg('port', 8000));
// Loopback, not 0.0.0.0 (python's default): a dev build has no business being
// reachable from the rest of the network. Pass --host 0.0.0.0 to opt in, e.g.
// to open the game on a phone.
const HOST = arg('host', '127.0.0.1');
const ROOT = resolve(arg('dir', 'build/web'));

// Only the types this build actually emits. Anything else falls through to
// octet-stream, which is what the engine's arraybuffer fetches want anyway.
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm',
  '.glb': 'model/gltf-binary',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
};

const server = createServer(async (req, res) => {
  // Strip the query string, and decode before resolving so an encoded
  // traversal (%2e%2e) is caught by the containment check below rather than
  // sneaking past it.
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400).end('Bad request');
    return;
  }

  // Any directory serves its index.html, not just the root. GitHub Pages does
  // this (the branch previews live at /preview/<branch>/), so a server that
  // only special-cased '/' would 404 on a URL that works once deployed.
  const filePath = resolve(join(ROOT, pathname.endsWith('/') ? `${pathname}index.html` : pathname));

  // Never serve outside the root. resolve() has already collapsed any '..',
  // so a prefix check settles it - with the separator so that a sibling
  // directory like build/web-backup cannot match on the prefix alone.
  if (filePath !== ROOT && !filePath.startsWith(ROOT + sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  try {
    const info = await stat(filePath);
    if (info.isDirectory()) {
      res.writeHead(404).end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': info.size,
      // A dev server that lets the browser cache is a dev server that shows
      // you your last build after you rebuild.
      'Cache-Control': 'no-store',
    });
    createReadStream(filePath).pipe(res);
  } catch {
    res.writeHead(404).end('Not found');
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Serving ${ROOT} -> http://${HOST}:${PORT}/`);
});
