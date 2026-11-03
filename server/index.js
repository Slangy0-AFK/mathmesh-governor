import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeDatabase, entityStore, ENTITY_NAMES, pool } from './db.js';
import { authenticateRequest, login } from './auth.js';
import { invokeFunction } from './runtime.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const maxBodyBytes = 1_000_000;

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), 'cache-control': 'no-store' });
  res.end(body);
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBodyBytes) throw Object.assign(new Error('Request body is too large.'), { status: 413 });
    chunks.push(chunk);
  }
  if (!size) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('Request body must be valid JSON.'), { status: 400 }); }
}

function toRequest(req, body) {
  const headers = new Headers(req.headers);
  const init = { method: req.method, headers };
  if (!['GET', 'HEAD'].includes(req.method)) init.body = JSON.stringify(body || {});
  return new Request(`http://${req.headers.host || 'localhost'}${req.url}`, init);
}

async function requireAdmin(request) {
  const user = await authenticateRequest(request);
  if (!user) throw Object.assign(new Error('Unauthorized.'), { status: 401 });
  if (user.role !== 'admin') throw Object.assign(new Error('Administrator access required.'), { status: 403 });
  return user;
}

async function handleApi(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/health') {
    await pool.query('SELECT 1');
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/login') {
    const body = await readJson(req);
    return sendJson(res, 200, await login(body.email, body.password));
  }

  const body = req.method === 'GET' || req.method === 'HEAD' ? {} : await readJson(req);
  const request = toRequest(req, body);
  if (req.method === 'GET' && url.pathname === '/api/auth/me') {
    const user = await authenticateRequest(request);
    if (!user) return sendJson(res, 401, { error: 'Unauthorized.' });
    return sendJson(res, 200, user);
  }

  const functionMatch = url.pathname.match(/^\/api\/functions\/([A-Za-z0-9_-]+)$/);
  if (req.method === 'POST' && functionMatch) {
    await requireAdmin(request);
    const response = await invokeFunction(functionMatch[1], body, request);
    const responseBody = Buffer.from(await response.arrayBuffer());
    res.writeHead(response.status, Object.fromEntries(response.headers));
    return res.end(responseBody);
  }

  const entityMatch = url.pathname.match(/^\/api\/entities\/([A-Za-z0-9]+)\/(list|filter|create|update|delete)$/);
  if (entityMatch) {
    await requireAdmin(request);
    const [, entity, operation] = entityMatch;
    if (!ENTITY_NAMES.includes(entity)) return sendJson(res, 404, { error: 'Entity not found.' });
    const store = entityStore(entity);
    if (operation === 'list' && req.method === 'GET') return sendJson(res, 200, await store.list(url.searchParams.get('sort') || '-created_date', url.searchParams.get('limit')));
    if (operation === 'filter' && req.method === 'POST') return sendJson(res, 200, await store.filter(body.criteria, body.sort, body.limit));
    if (operation === 'create' && req.method === 'POST') return sendJson(res, 201, await store.create(body));
    if (operation === 'update' && req.method === 'POST') return sendJson(res, 200, await store.update(body.id, body.patch));
    if (operation === 'delete' && req.method === 'POST') return sendJson(res, 200, await store.delete(body.id));
    return sendJson(res, 405, { error: 'Method not allowed.' });
  }

  return sendJson(res, 404, { error: 'Not found.' });
}

async function serveStatic(req, res, pathname) {
  const requested = pathname === '/' ? '/index.html' : pathname;
  let target = path.resolve(root, 'dist', `.${requested}`);
  if (!target.startsWith(path.resolve(root, 'dist') + path.sep)) return sendJson(res, 403, { error: 'Forbidden.' });
  try {
    if (!(await stat(target)).isFile()) throw new Error('Not a file.');
  } catch {
    target = path.resolve(root, 'dist/index.html');
  }
  const content = await readFile(target);
  const type = target.endsWith('.html') ? 'text/html; charset=utf-8' : target.endsWith('.js') ? 'text/javascript' : target.endsWith('.css') ? 'text/css' : 'application/octet-stream';
  res.writeHead(200, { 'content-type': type, 'content-length': content.length });
  createReadStream(target).pipe(res);
}

await initializeDatabase();
const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
    else if (process.env.NODE_ENV === 'production') await serveStatic(req, res, url.pathname);
    else sendJson(res, 404, { error: 'Not found.' });
  } catch (error) {
    console.error(JSON.stringify({ event: 'request_error', message: error.message }));
    if (!res.headersSent) sendJson(res, error.status || 500, { error: error.status ? error.message : 'Internal server error.' });
    else res.destroy();
  }
});

const port = Number(process.env.API_PORT || 3001);
server.listen(port, process.env.HOST || '0.0.0.0', () => console.log(`MathMesh API listening on ${port}`));

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(async () => { await pool.end(); process.exit(0); }));
}