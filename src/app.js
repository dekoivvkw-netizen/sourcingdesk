'use strict';
// Applicazione SourcingDesk: router node:http puro, API JSON + file statici.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { HttpError, sendJson, readJson } = require('./lib/http');
const auth = require('./lib/auth');
const { str, num, httpUrl } = require('./lib/validate');
const { offerHash, supplierHash } = require('./lib/dedupe');
const { createRateLimiter, clientKey, clientIp } = require('./lib/rateLimit');
const { extractOffer } = require('./lib/extract');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json' };
const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer',
  'content-security-policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; manifest-src 'self'; worker-src 'self'; frame-ancestors 'none'",
};
const OFFER_COLS = 'id, supplier_id, title, url, price, currency, moq, lead_time_days, description, source, ai_score, ai_summary, ai_source, created_at, updated_at';
const SUPPLIER_COLS = 'id, name, website, country, email, notes, created_at, updated_at';

function createApp({ pool, config, evaluate, fetchPage, robotLimiter, authLimiter, log = console }) {
  robotLimiter ||= createRateLimiter({ windowMs: config.robot.rateWindowMs, limit: config.robot.rateLimit });
  authLimiter ||= createRateLimiter({ windowMs: 15 * 60_000, limit: 20 });

  async function audit(actorId, action, entity, entityId, meta) {
    await pool.execute('INSERT INTO audit_log (actor_id, action, entity, entity_id, meta) VALUES (?, ?, ?, ?, ?)',
      [actorId ?? null, action, entity, entityId ?? null, meta ? JSON.stringify(meta) : null]);
  }
  async function currentUser(req) {
    const t = auth.bearer(req); if (!t) return null;
    const [rows] = await pool.execute(
      'SELECT u.id, u.email FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?',
      [auth.tokenHash(t), new Date()]);
    return rows[0] || null;
  }
  async function assertSupplierOwned(userId, supplierId) {
    if (supplierId == null) return;
    const [r] = await pool.execute('SELECT id FROM suppliers WHERE id = ? AND created_by = ?', [supplierId, userId]);
    if (!r[0]) throw new HttpError(400, 'fornitore inesistente');
  }
  function rateLimited(res, rl) {
    sendJson(res, 429, { error: 'Troppe richieste, riprova più tardi' }, { 'retry-after': String(rl.retryAfter), 'ratelimit-remaining': '0' });
  }

  // ---------- Auth ----------
  async function register(req, res) {
    const rl = authLimiter.check(`ip:${clientIp(req, config.trustProxy)}`); if (!rl.ok) return rateLimited(res, rl);
    const b = await readJson(req);
    const email = str(b.email, 255, 'email', true).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'email non valida');
    const password = typeof b.password === 'string' ? b.password : '';
    if (password.length < 10 || password.length > 200) throw new HttpError(400, 'la password deve avere 10-200 caratteri');
    try {
      const [r] = await pool.execute('INSERT INTO users (email, password_hash) VALUES (?, ?)', [email, await auth.hashPassword(password)]);
      await audit(r.insertId, 'user.register', 'user', r.insertId);
      return startSession(res, r.insertId, email, 201);
    } catch (e) { if (e.code === 'ER_DUP_ENTRY') throw new HttpError(409, 'email già registrata'); throw e; }
  }
  async function login(req, res) {
    const rl = authLimiter.check(`ip:${clientIp(req, config.trustProxy)}`); if (!rl.ok) return rateLimited(res, rl);
    const b = await readJson(req);
    const email = String(b.email || '').trim().toLowerCase();
    const [rows] = await pool.execute('SELECT id, email, password_hash FROM users WHERE email = ?', [email]);
    const ok = rows[0] ? await auth.verifyPassword(String(b.password || ''), rows[0].password_hash)
      : (await auth.hashPassword('dummy-password-timing'), false);
    if (!ok) throw new HttpError(401, 'credenziali non valide');
    await audit(rows[0].id, 'user.login', 'user', rows[0].id);
    return startSession(res, rows[0].id, rows[0].email, 200);
  }
  async function startSession(res, userId, email, status) {
    const token = auth.newToken();
    await pool.execute('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)',
      [auth.tokenHash(token), userId, new Date(Date.now() + config.sessionTtlHours * 3600_000)]);
    const cookie = `sd_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${config.sessionTtlHours * 3600}${config.secureCookies ? '; Secure' : ''}`;
    sendJson(res, status, { token, user: { id: userId, email } }, { 'set-cookie': cookie });
  }
  async function logout(req, res) {
    const t = auth.bearer(req);
    if (t) await pool.execute('DELETE FROM sessions WHERE token_hash = ?', [auth.tokenHash(t)]);
    sendJson(res, 200, { ok: true }, { 'set-cookie': `sd_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${config.secureCookies ? '; Secure' : ''}` });
  }

  // ---------- Fornitori ----------
  function supplierInput(b, partial) {
    const out = {
      name: str(b.name, 255, 'nome', !partial), website: httpUrl(b.website, 'sito', false),
      country: str(b.country, 64, 'paese'), email: str(b.email, 255, 'email'), notes: str(b.notes, 5000, 'note'),
    };
    return out;
  }
  async function upsertSupplier(userId, s) {
    const params = [s.name, s.website, s.country, s.email, s.notes, supplierHash(userId, s.name, s.website), userId];
    const ins = 'INSERT INTO suppliers (name, website, country, email, notes, dedupe_hash, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)';
    if (pool.dialect === 'postgres') {
      const [r] = await pool.execute(`${ins}
       ON CONFLICT (dedupe_hash) DO UPDATE SET name = EXCLUDED.name,
         website = COALESCE(EXCLUDED.website, suppliers.website), country = COALESCE(EXCLUDED.country, suppliers.country),
         email = COALESCE(EXCLUDED.email, suppliers.email), notes = COALESCE(EXCLUDED.notes, suppliers.notes), updated_at = now()
       RETURNING id, (xmax = 0) AS inserted`, params);
      return { id: r[0].id, inserted: r[0].inserted };
    }
    const [r] = await pool.execute(`${ins}
       ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id), name = VALUES(name),
         website = COALESCE(VALUES(website), website), country = COALESCE(VALUES(country), country),
         email = COALESCE(VALUES(email), email), notes = COALESCE(VALUES(notes), notes)`, params);
    return { id: r.insertId, inserted: r.affectedRows === 1 };
  }
  async function listSuppliers(req, res) {
    const [rows] = await pool.execute(`SELECT ${SUPPLIER_COLS} FROM suppliers WHERE created_by = ? ORDER BY name LIMIT 500`, [req.user.id]);
    sendJson(res, 200, rows);
  }
  async function getSupplier(req, res, id) {
    const [rows] = await pool.execute(`SELECT ${SUPPLIER_COLS} FROM suppliers WHERE id = ? AND created_by = ?`, [id, req.user.id]);
    if (!rows[0]) throw new HttpError(404, 'non trovato');
    sendJson(res, 200, rows[0]);
  }
  async function createSupplier(req, res) {
    const s = supplierInput(await readJson(req), false);
    const r = await upsertSupplier(req.user.id, s);
    await audit(req.user.id, r.inserted ? 'supplier.create' : 'supplier.merge', 'supplier', r.id);
    sendJson(res, r.inserted ? 201 : 200, { id: r.id, inserted: r.inserted });
  }
  async function updateSupplier(req, res, id) {
    const b = await readJson(req); const s = supplierInput(b, true);
    const [cur] = await pool.execute(`SELECT ${SUPPLIER_COLS} FROM suppliers WHERE id = ? AND created_by = ?`, [id, req.user.id]);
    if (!cur[0]) throw new HttpError(404, 'non trovato');
    const m = { ...cur[0] }; for (const k of Object.keys(s)) if (k in b) m[k] = s[k];
    if (!m.name) throw new HttpError(400, 'nome obbligatorio');
    try {
      await pool.execute('UPDATE suppliers SET name = ?, website = ?, country = ?, email = ?, notes = ?, dedupe_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND created_by = ?',
        [m.name, m.website, m.country, m.email, m.notes, supplierHash(req.user.id, m.name, m.website), id, req.user.id]);
    } catch (e) { if (e.code === 'ER_DUP_ENTRY') throw new HttpError(409, 'esiste già un fornitore con questo nome/sito'); throw e; }
    await audit(req.user.id, 'supplier.update', 'supplier', id);
    sendJson(res, 200, { id });
  }
  async function deleteSupplier(req, res, id) {
    const [r] = await pool.execute('DELETE FROM suppliers WHERE id = ? AND created_by = ?', [id, req.user.id]);
    if (!r.affectedRows) throw new HttpError(404, 'non trovato');
    await audit(req.user.id, 'supplier.delete', 'supplier', id);
    sendJson(res, 200, { ok: true });
  }

  // ---------- Offerte ----------
  function offerInput(b, partial) {
    return {
      title: str(b.title, 500, 'titolo', !partial), url: httpUrl(b.url, 'url', !partial),
      price: num(b.price, 'prezzo', { max: 1e10 }), currency: b.currency ? str(b.currency, 3, 'valuta')?.toUpperCase() : null,
      moq: num(b.moq, 'MOQ', { int: true, max: 1e9 }), lead_time_days: num(b.lead_time_days, 'tempi di consegna', { int: true, max: 3650 }),
      description: str(b.description, 5000, 'descrizione'), supplier_id: num(b.supplier_id, 'fornitore', { int: true, min: 1 }),
    };
  }
  async function upsertOffer(userId, o, source) {
    const verification = await evaluate(o); // definita PRIMA dell'uso (correzione 1)
    const params = [o.supplier_id ?? null, o.title, o.url, o.price, o.currency, o.moq, o.lead_time_days, o.description, source,
      verification.score, verification.summary, verification.source, offerHash(userId, o.url), userId];
    const ins = `INSERT INTO offers (supplier_id, title, url, price, currency, moq, lead_time_days, description, source,
                           ai_score, ai_summary, ai_source, dedupe_hash, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    let id, inserted;
    if (pool.dialect === 'postgres') {
      const [r] = await pool.execute(`${ins}
       ON CONFLICT (dedupe_hash) DO UPDATE SET
         supplier_id = COALESCE(EXCLUDED.supplier_id, offers.supplier_id), title = EXCLUDED.title,
         price = COALESCE(EXCLUDED.price, offers.price), currency = COALESCE(EXCLUDED.currency, offers.currency),
         moq = COALESCE(EXCLUDED.moq, offers.moq), lead_time_days = COALESCE(EXCLUDED.lead_time_days, offers.lead_time_days),
         description = COALESCE(EXCLUDED.description, offers.description),
         ai_score = EXCLUDED.ai_score, ai_summary = EXCLUDED.ai_summary, ai_source = EXCLUDED.ai_source, updated_at = now()
       RETURNING id, (xmax = 0) AS inserted`, params);
      ({ id, inserted } = r[0]);
    } else {
      const [r] = await pool.execute(`${ins}
       ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id),
         supplier_id = COALESCE(VALUES(supplier_id), supplier_id), title = VALUES(title),
         price = COALESCE(VALUES(price), price), currency = COALESCE(VALUES(currency), currency),
         moq = COALESCE(VALUES(moq), moq), lead_time_days = COALESCE(VALUES(lead_time_days), lead_time_days),
         description = COALESCE(VALUES(description), description),
         ai_score = VALUES(ai_score), ai_summary = VALUES(ai_summary), ai_source = VALUES(ai_source)`, params);
      id = r.insertId; inserted = r.affectedRows === 1;
    }
    await audit(userId, inserted ? 'offer.create' : 'offer.merge', 'offer', id,
      { source, verification: { score: verification.score, source: verification.source } });
    return { id, inserted, verification };
  }
  async function listOffers(req, res, q) {
    const where = ['created_by = ?']; const params = [req.user.id];
    if (q.get('q')) { where.push(pool.dialect === 'postgres' ? '(title ILIKE ? OR description ILIKE ?)' : '(title LIKE ? OR description LIKE ?)'); const like = `%${q.get('q').replace(/[%_\\]/g, '\\$&')}%`; params.push(like, like); }
    if (q.get('supplier_id')) { where.push('supplier_id = ?'); params.push(Number(q.get('supplier_id'))); }
    const [rows] = await pool.execute(`SELECT ${OFFER_COLS} FROM offers WHERE ${where.join(' AND ')} ORDER BY created_at DESC, id DESC LIMIT 500`, params);
    sendJson(res, 200, rows);
  }
  async function getOffer(req, res, id) {
    const [rows] = await pool.execute(`SELECT ${OFFER_COLS} FROM offers WHERE id = ? AND created_by = ?`, [id, req.user.id]);
    if (!rows[0]) throw new HttpError(404, 'non trovato');
    sendJson(res, 200, rows[0]);
  }
  async function createOffer(req, res) {
    const o = offerInput(await readJson(req), false);
    await assertSupplierOwned(req.user.id, o.supplier_id);
    const r = await upsertOffer(req.user.id, o, 'manual');
    sendJson(res, r.inserted ? 201 : 200, { id: r.id, inserted: r.inserted, ai_score: r.verification.score, ai_summary: r.verification.summary });
  }
  async function updateOffer(req, res, id) {
    const b = await readJson(req); const o = offerInput(b, true);
    const [cur] = await pool.execute(`SELECT ${OFFER_COLS} FROM offers WHERE id = ? AND created_by = ?`, [id, req.user.id]);
    if (!cur[0]) throw new HttpError(404, 'non trovato');
    const m = { ...cur[0] }; for (const k of Object.keys(o)) if (k in b) m[k] = o[k];
    if (!m.title || !m.url) throw new HttpError(400, 'titolo e url obbligatori');
    await assertSupplierOwned(req.user.id, m.supplier_id);
    const verification = await evaluate(m);
    try {
      await pool.execute(
        `UPDATE offers SET supplier_id = ?, title = ?, url = ?, price = ?, currency = ?, moq = ?, lead_time_days = ?, description = ?,
           ai_score = ?, ai_summary = ?, ai_source = ?, dedupe_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND created_by = ?`,
        [m.supplier_id, m.title, m.url, m.price, m.currency, m.moq, m.lead_time_days, m.description,
          verification.score, verification.summary, verification.source, offerHash(req.user.id, m.url), id, req.user.id]);
    } catch (e) { if (e.code === 'ER_DUP_ENTRY') throw new HttpError(409, 'esiste già un\'offerta con questo URL'); throw e; }
    await audit(req.user.id, 'offer.update', 'offer', id, { verification: { score: verification.score, source: verification.source } });
    sendJson(res, 200, { id, ai_score: verification.score, ai_summary: verification.summary });
  }
  async function deleteOffer(req, res, id) {
    const [r] = await pool.execute('DELETE FROM offers WHERE id = ? AND created_by = ?', [id, req.user.id]);
    if (!r.affectedRows) throw new HttpError(404, 'non trovato');
    await audit(req.user.id, 'offer.delete', 'offer', id);
    sendJson(res, 200, { ok: true });
  }

  // ---------- Robot ----------
  async function robotsRun(req, res) {
    const rl = robotLimiter.check(clientKey(req, config.trustProxy)); if (!rl.ok) return rateLimited(res, rl);
    const b = await readJson(req);
    const url = httpUrl(b.url, 'url', true);
    let supplierId = num(b.supplier_id, 'fornitore', { int: true, min: 1 });
    await assertSupplierOwned(req.user.id, supplierId);
    let page;
    try { page = await fetchPage(url); }
    catch (e) {
      await audit(req.user.id, 'robot.error', 'offer', null, { url, error: e.message });
      throw new HttpError(e.status && e.status < 600 ? e.status : 502, `import non riuscito: ${e.message}`);
    }
    const ex = extractOffer(page.body, page.finalUrl || url);
    if (!ex.title) throw new HttpError(422, 'nessun dato riconoscibile nella pagina');
    if (!supplierId && ex.supplierName) {
      const origin = new URL(page.finalUrl || url).origin;
      supplierId = (await upsertSupplier(req.user.id, { name: ex.supplierName.slice(0, 255), website: origin, country: null, email: null, notes: null })).id;
    }
    const r = await upsertOffer(req.user.id, { title: ex.title, url, price: ex.price, currency: ex.currency, moq: null,
      lead_time_days: null, description: ex.description, supplier_id: supplierId ?? null }, 'robot');
    sendJson(res, r.inserted ? 201 : 200, { id: r.id, inserted: r.inserted, extracted: ex, supplier_id: supplierId ?? null,
      ai_score: r.verification.score, ai_summary: r.verification.summary }, { 'ratelimit-remaining': String(rl.remaining) });
  }

  async function auditList(req, res) {
    const [rows] = await pool.execute('SELECT id, action, entity, entity_id, meta, created_at FROM audit_log WHERE actor_id = ? ORDER BY id DESC LIMIT 100', [req.user.id]);
    sendJson(res, 200, rows);
  }

  // ---------- Routing ----------
  const routes = [
    ['POST', /^\/api\/auth\/register$/, register, false],
    ['POST', /^\/api\/auth\/login$/, login, false],
    ['POST', /^\/api\/auth\/logout$/, logout, false],
    ['GET', /^\/api\/me$/, (req, res) => sendJson(res, 200, req.user), true],
    ['GET', /^\/api\/suppliers$/, listSuppliers, true],
    ['POST', /^\/api\/suppliers$/, createSupplier, true],
    ['GET', /^\/api\/suppliers\/(\d+)$/, getSupplier, true],
    ['PUT', /^\/api\/suppliers\/(\d+)$/, updateSupplier, true],
    ['DELETE', /^\/api\/suppliers\/(\d+)$/, deleteSupplier, true],
    ['GET', /^\/api\/offers$/, listOffers, true],
    ['POST', /^\/api\/offers$/, createOffer, true],
    ['GET', /^\/api\/offers\/(\d+)$/, getOffer, true],
    ['PUT', /^\/api\/offers\/(\d+)$/, updateOffer, true],
    ['DELETE', /^\/api\/offers\/(\d+)$/, deleteOffer, true],
    ['POST', /^\/api\/robots\/run$/, robotsRun, true],
    ['GET', /^\/api\/audit$/, auditList, true],
  ];

  function serveStatic(req, res, pathname) {
    const rel = pathname === '/' ? 'index.html' : pathname.slice(1);
    const file = path.normalize(path.join(PUBLIC_DIR, rel));
    if (!file.startsWith(PUBLIC_DIR + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return sendJson(res, 404, { error: 'non trovato' });
    const base = path.basename(file);
    // sw.js e index.html sempre rivalidati, così gli aggiornamenti arrivano subito; gli altri asset brevemente in cache.
    const cache = (base === 'sw.js' || base === 'index.html') ? 'no-cache' : 'public, max-age=3600';
    const extra = base === 'sw.js' ? { 'service-worker-allowed': '/' } : {};
    if (config.secureCookies) extra['strict-transport-security'] = 'max-age=15552000';
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': cache, ...extra, ...SECURITY_HEADERS });
    fs.createReadStream(file).pipe(res);
  }

  async function handle(req, res) {
    const { pathname, searchParams } = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && pathname === '/health') {
      try { await pool.query('SELECT 1'); return sendJson(res, 200, { ok: true }); }
      catch { return sendJson(res, 503, { ok: false }); }
    }
    if (!pathname.startsWith('/api/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'metodo non consentito' });
      return serveStatic(req, res, pathname);
    }
    // Protezione CSRF per sessioni via cookie: richieste di modifica solo con JSON (non inviabile da form cross-site).
    if (!['GET', 'HEAD'].includes(req.method) && req.headers['content-length'] !== '0' && req.headers['content-length'] !== undefined
        && !String(req.headers['content-type'] || '').startsWith('application/json')) {
      throw new HttpError(415, 'usare Content-Type: application/json');
    }
    let pathMatched = false;
    for (const [method, re, fn, needsAuth] of routes) {
      const m = pathname.match(re); if (!m) continue;
      pathMatched = true;
      if (method !== req.method) continue;
      if (needsAuth) { req.user = await currentUser(req); if (!req.user) throw new HttpError(401, 'non autenticato'); }
      return fn(req, res, m[1] ? Number(m[1]) : searchParams, searchParams);
    }
    throw new HttpError(pathMatched ? 405 : 404, pathMatched ? 'metodo non consentito' : 'non trovato');
  }

  const server = http.createServer(async (req, res) => {
    try { await handle(req, res); }
    catch (e) {
      const status = e instanceof HttpError || (e.status >= 400 && e.status < 600) ? e.status : 500;
      if (status >= 500) log.error(e);
      if (!res.headersSent) sendJson(res, status, { error: status >= 500 && !(e instanceof HttpError) ? 'errore interno' : e.message });
      else res.end();
    }
  });
  server.requestTimeout = 30_000;
  server.on('close', () => { robotLimiter.stop(); authLimiter.stop(); });
  return server;
}
module.exports = { createApp };
