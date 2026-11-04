'use strict';
// Rate limiter in memoria a finestra fissa (Map per utente/IP). Singola istanza: con più repliche usare uno store condiviso.
function createRateLimiter({ windowMs = 60_000, limit = 5, now = Date.now } = {}) {
  const hits = new Map();
  const sweep = setInterval(() => { const t = now(); for (const [k, v] of hits) if (v.resetAt <= t) hits.delete(k); }, windowMs);
  sweep.unref();
  function check(key) {
    const t = now();
    let e = hits.get(key);
    if (!e || e.resetAt <= t) { e = { count: 0, resetAt: t + windowMs }; hits.set(key, e); }
    e.count++;
    return { ok: e.count <= limit, remaining: Math.max(0, limit - e.count), retryAfter: Math.max(1, Math.ceil((e.resetAt - t) / 1000)) };
  }
  return { check, stop: () => clearInterval(sweep), size: () => hits.size };
}
// Con trustProxy (es. dietro Cloudflare Tunnel) l'IP reale arriva da cf-connecting-ip / x-forwarded-for.
const clientIp = (req, trustProxy = false) => {
  if (trustProxy) {
    const h = req.headers['cf-connecting-ip'] || String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (h) return h;
  }
  return req.socket.remoteAddress;
};
const clientKey = (req, trustProxy = false) => (req.user?.id ? `u:${req.user.id}` : `ip:${clientIp(req, trustProxy)}`);
module.exports = { createRateLimiter, clientKey, clientIp };
