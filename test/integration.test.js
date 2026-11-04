'use strict';
// Test end-to-end su MySQL reale. Si attiva con TEST_DATABASE_URL (DB dedicato: le tabelle vengono svuotate).
const test = require('node:test'); const assert = require('node:assert'); const http = require('node:http');
const url = process.env.TEST_DATABASE_URL;
const opts = { skip: url ? false : 'TEST_DATABASE_URL non impostata: test DB saltati' };

test('end-to-end con il DB (MySQL o PostgreSQL)', opts, async t => {
  const { migrate } = require('../scripts/migrate');
  const { createPool } = require('../src/db');
  const { createApp } = require('../src/app');
  const { createEvaluator } = require('../src/lib/ai');
  const { createRateLimiter } = require('../src/lib/rateLimit');
  const { safeFetch } = require('../src/lib/safeFetch');

  await migrate(url, () => {});
  await migrate(url, () => {}); // idempotente
  const pool = createPool(url);
  for (const tb of ['audit_log', 'offers', 'suppliers', 'sessions', 'users']) await pool.query(`DELETE FROM ${tb}`);

  // Pagina prodotto finta servita localmente (il robot può leggerla solo perché allowPrivate=true in questo test).
  const page = http.createServer((req, res) => res.end(`<html><head><title>x</title><script type="application/ld+json">
    {"@type":"Product","name":"Organizer sedile auto","description":"Organizer in similpelle tra sedile e console, confezione da 2",
     "offers":{"price":"7,40","priceCurrency":"EUR","seller":{"name":"Fornitore Demo Srl"}}}</script></head></html>`)).listen(0);
  const pageUrl = `http://127.0.0.1:${page.address().port}/p/1`;
  const config = { sessionTtlHours: 1, secureCookies: false, robot: { rateLimit: 2, rateWindowMs: 60_000 } };
  const app = createApp({ pool, config, evaluate: createEvaluator({ apiKey: '' }),
    fetchPage: u => safeFetch(u, { allowPrivate: true, timeoutMs: 3000, maxBytes: 100_000 }),
    robotLimiter: createRateLimiter({ windowMs: 60_000, limit: 2 }), log: { error() {} } }).listen(0);
  const base = `http://127.0.0.1:${app.address().port}`;
  const call = async (method, path, body, token) => {
    const r = await fetch(base + path, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, headers: r.headers, body: await r.json().catch(() => null) };
  };
  t.after(async () => { app.close(); page.close(); await pool.end(); });

  assert.equal((await call('GET', '/health')).status, 200);
  const home = await fetch(base + '/'); assert.equal(home.status, 200); assert.match(await home.text(), /SourcingDesk/);

  // Auth
  assert.equal((await call('POST', '/api/auth/register', { email: 'a@x.it', password: 'corta' })).status, 400);
  const A = await call('POST', '/api/auth/register', { email: 'a@x.it', password: 'password-di-a-1' });
  assert.equal(A.status, 201); assert.match(A.headers.get('set-cookie'), /HttpOnly/);
  assert.equal((await call('POST', '/api/auth/register', { email: 'A@x.it', password: 'password-di-a-1' })).status, 409);
  assert.equal((await call('POST', '/api/auth/login', { email: 'a@x.it', password: 'sbagliata!!' })).status, 401);
  const tokA = (await call('POST', '/api/auth/login', { email: 'a@x.it', password: 'password-di-a-1' })).body.token;
  const tokB = (await call('POST', '/api/auth/register', { email: 'b@x.it', password: 'password-di-b-1' })).body.token;
  assert.equal((await call('GET', '/api/offers')).status, 401);
  assert.equal((await call('GET', '/api/me', null, tokA)).body.email, 'a@x.it');

  // Fornitori con dedupe
  const s1 = await call('POST', '/api/suppliers', { name: 'ACME Srl', website: 'https://acme.example', country: 'IT' }, tokA);
  assert.equal(s1.status, 201);
  const s2 = await call('POST', '/api/suppliers', { name: 'ACME S.r.l.', website: 'https://www.acme.example/' }, tokA);
  assert.equal(s2.status, 200); assert.equal(s2.body.id, s1.body.id);

  // Offerte: creazione, audit con verification, dedupe con ON DUPLICATE KEY
  const o1 = await call('POST', '/api/offers', { title: 'Supporto laptop', url: 'https://acme.example/p/9?utm_source=x', price: 12.5, currency: 'eur', moq: 100, lead_time_days: 12, supplier_id: s1.body.id }, tokA);
  assert.equal(o1.status, 201); assert.ok(o1.body.ai_score > 0);
  const o2 = await call('POST', '/api/offers', { title: 'Supporto laptop v2', url: 'https://www.acme.example/p/9', price: 11 }, tokA);
  assert.equal(o2.status, 200); assert.equal(o2.body.id, o1.body.id);
  const [[cnt]] = await pool.query('SELECT COUNT(*) n FROM offers'); assert.equal(cnt.n, 1);
  const got = (await call('GET', `/api/offers/${o1.body.id}`, null, tokA)).body;
  assert.equal(got.title, 'Supporto laptop v2'); assert.equal(Number(got.price), 11); assert.equal(got.moq, 100);
  const [aud] = await pool.query("SELECT meta FROM audit_log WHERE action IN ('offer.create','offer.merge') ORDER BY id");
  assert.equal(aud.length, 2);
  const meta = typeof aud[0].meta === 'string' ? JSON.parse(aud[0].meta) : aud[0].meta;
  assert.equal(meta.verification.source, 'euristica');

  // Vincolo UNIQUE a livello DB
  const [[row]] = await pool.query('SELECT dedupe_hash FROM offers LIMIT 1');
  await assert.rejects(pool.execute("INSERT INTO offers (title, url, dedupe_hash, created_by) VALUES ('x','https://x', ?, (SELECT id FROM users LIMIT 1))", [row.dedupe_hash]), e => e.code === 'ER_DUP_ENTRY');

  // Scoping created_by: B non vede né modifica i dati di A
  assert.deepEqual((await call('GET', '/api/offers', null, tokB)).body, []);
  assert.equal((await call('GET', `/api/offers/${o1.body.id}`, null, tokB)).status, 404);
  assert.equal((await call('PUT', `/api/offers/${o1.body.id}`, { title: 'hack' }, tokB)).status, 404);
  assert.equal((await call('DELETE', `/api/offers/${o1.body.id}`, null, tokB)).status, 404);
  assert.equal((await call('POST', '/api/offers', { title: 't', url: 'https://b.example', supplier_id: s1.body.id }, tokB)).status, 400);
  // Stesso URL per utenti diversi: righe separate
  assert.equal((await call('POST', '/api/offers', { title: 'Mio', url: 'https://acme.example/p/9' }, tokB)).status, 201);

  // Aggiornamento con conflitto di dedupe -> 409
  const o3 = await call('POST', '/api/offers', { title: 'Altro', url: 'https://acme.example/p/10' }, tokA);
  assert.equal((await call('PUT', `/api/offers/${o3.body.id}`, { url: 'https://acme.example/p/9' }, tokA)).status, 409);

  // Robot: import, poi rate limit (limite 2) con 429 + Retry-After
  const r1 = await call('POST', '/api/robots/run', { url: pageUrl }, tokA);
  assert.equal(r1.status, 201, JSON.stringify(r1.body));
  assert.equal(r1.body.extracted.title, 'Organizer sedile auto'); assert.equal(r1.body.extracted.price, 7.4);
  assert.ok(r1.body.supplier_id);
  const r2 = await call('POST', '/api/robots/run', { url: pageUrl }, tokA);
  assert.equal(r2.status, 200); assert.equal(r2.body.id, r1.body.id);
  const r3 = await call('POST', '/api/robots/run', { url: pageUrl }, tokA);
  assert.equal(r3.status, 429); assert.ok(Number(r3.headers.get('retry-after')) > 0);
  // B ha il proprio contatore
  assert.notEqual((await call('POST', '/api/robots/run', { url: 'ftp://x' }, tokB)).status, 429);

  // Validazione, CSRF, eliminazione, logout
  assert.equal((await call('POST', '/api/offers', { title: 'x', url: 'javascript:alert(1)' }, tokA)).status, 400);
  const form = await fetch(base + '/api/offers', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: `Bearer ${tokA}` }, body: 'title=x' });
  assert.equal(form.status, 415);
  assert.equal((await call('DELETE', `/api/offers/${o3.body.id}`, null, tokA)).status, 200);
  assert.ok((await call('GET', '/api/audit', null, tokA)).body.length > 5);
  assert.equal((await call('POST', '/api/auth/logout', null, tokA)).status, 200);
  assert.equal((await call('GET', '/api/me', null, tokA)).status, 401);
});
