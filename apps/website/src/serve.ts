// Serves a built site on localhost to look at it: `pnpm serve` (dist/) or `pnpm serve preview`.
// PORT picks another port; this never stops anything that already listens on one.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('..', import.meta.url)), process.argv[2] ?? 'dist');
const port = Number(process.env.PORT ?? 4321);
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.xml': 'application/xml',
  '.txt': 'text/plain; charset=utf-8',
};

if (!existsSync(root)) {
  console.error(`${root} does not exist. Run pnpm build (or pnpm preview) first.`);
  process.exit(1);
}

createServer((request, response) => {
  const path = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
  let file = normalize(join(root, path));
  if (!file.startsWith(root + sep) && file !== root) {
    response.writeHead(403).end();
    return;
  }
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  const found = existsSync(file);
  const target = found ? file : join(root, '404.html');
  response.writeHead(found ? 200 : 404, { 'Content-Type': TYPES[extname(target)] ?? 'application/octet-stream' });
  createReadStream(target).pipe(response);
})
  .on('error', (error: NodeJS.ErrnoException) => {
    console.error(error.code === 'EADDRINUSE' ? `Port ${port} is taken; start with PORT=<another port>.` : error.message);
    process.exit(1);
  })
  .listen(port, '127.0.0.1', () => console.log(`Serving ${root} at http://127.0.0.1:${port}/`));
