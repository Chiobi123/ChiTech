/**
 * Local dev server for the ChiiTech frontend.
 *
 * Serves chiitech/ over HTTP so Supabase Auth gets a real origin (file:// breaks it).
 * Unknown paths fall back to index.html, matching Cloudflare Pages behaviour, so a
 * typo in a section route behaves the same locally as in production.
 *
 *   npm run dev            -> http://localhost:8080
 *   PORT=3000 npm run dev  -> http://localhost:3000
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../chiitech', import.meta.url)));
const port = Number(process.env.PORT || 8080);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

function resolveInsideRoot(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0]);
  } catch {
    return null;
  }
  const candidate = resolve(join(root, decoded));
  if (candidate !== root && !candidate.startsWith(root + '\\') && !candidate.startsWith(root + '/')) {
    return null;
  }
  return candidate;
}

async function sendFile(res, filePath) {
  const body = await readFile(filePath);
  res.writeHead(200, {
    'Content-Type': MIME[extname(filePath).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}

const server = createServer(async (req, res) => {
  const requested = resolveInsideRoot(req.url || '/');
  if (!requested) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }

  try {
    const info = await stat(requested).catch(() => null);
    if (info && info.isFile()) {
      await sendFile(res, requested);
      return;
    }
    if (info && info.isDirectory()) {
      await sendFile(res, join(requested, 'index.html'));
      return;
    }
    // Pages-style fallback for unknown paths.
    await sendFile(res, join(root, 'index.html'));
  } catch (err) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found: ' + err.message);
  }
});

server.listen(port, () => {
  console.log(`ChiiTech dev server: http://localhost:${port}`);
  console.log(`Serving: ${root}`);
  console.log('Ctrl+C to stop.');
});
