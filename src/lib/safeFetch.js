'use strict';
// Fetch sicura per il robot: IP validato e "pinnato" (anti DNS-rebinding), redirect ricontrollati,
// timeout, limite di dimensione, solo GET.
const http = require('node:http');
const https = require('node:https');
const { resolvePublic } = require('./ssrf');

function requestOnce(target, { timeoutMs, maxBytes }) {
  const { url, address, family } = target;
  const mod = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = mod.request(url, {
      method: 'GET',
      headers: { 'user-agent': 'SourcingDeskBot/0.1 (+https://example.invalid)', accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.5' },
      lookup: (_h, opts, cb) => (opts && opts.all ? cb(null, [{ address, family }]) : cb(null, address, family)),
      signal: AbortSignal.timeout(timeoutMs),
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume(); return resolve({ redirect: new URL(res.headers.location, url).toString(), status: res.statusCode });
      }
      let size = 0; const chunks = [];
      res.on('data', c => {
        size += c.length;
        if (size > maxBytes) { reject(Object.assign(new Error('pagina troppo grande'), { status: 413 })); res.destroy(); req.destroy(); }
        else chunks.push(c);
      });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8'), finalUrl: url.toString() }));
      res.on('error', reject);
    });
    req.on('error', e => reject(e.name === 'TimeoutError' || e.name === 'AbortError'
      ? Object.assign(new Error('timeout durante il download'), { status: 504 }) : e));
    req.end();
  });
}

async function safeFetch(rawUrl, { timeoutMs = 10000, maxBytes = 2_000_000, maxRedirects = 3, allowPrivate = false, lookup } = {}) {
  let current = rawUrl;
  for (let i = 0; i <= maxRedirects; i++) {
    const target = await resolvePublic(current, { allowPrivate, lookup }); // ricontrollo a ogni salto
    const r = await requestOnce(target, { timeoutMs, maxBytes });
    if (!r.redirect) {
      if (r.status >= 400) throw Object.assign(new Error(`la pagina ha risposto ${r.status}`), { status: 502 });
      return r;
    }
    current = r.redirect;
  }
  throw Object.assign(new Error('troppi redirect'), { status: 502 });
}
module.exports = { safeFetch };
