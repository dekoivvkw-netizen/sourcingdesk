'use strict';
// Password con scrypt (salt casuale, confronto a tempo costante) e sessioni con token opaco
// (nel DB si salva solo lo SHA-256 del token).
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const scrypt = promisify(crypto.scrypt);
const N = 16384, r = 8, p = 1, KEYLEN = 64;

async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pw, salt, KEYLEN, { N, r, p });
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${key.toString('base64')}`;
}
async function verifyPassword(pw, stored) {
  const [alg, n, rr, pp, salt, key] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(key, 'base64');
  const got = await scrypt(pw, Buffer.from(salt, 'base64'), expected.length, { N: +n, r: +rr, p: +pp });
  return crypto.timingSafeEqual(expected, got);
}
const newToken = () => crypto.randomBytes(32).toString('base64url');
const tokenHash = t => crypto.createHash('sha256').update(t).digest('hex');

function bearer(req) {
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) return h.slice(7).trim();
  const c = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith('sd_session='));
  return c ? decodeURIComponent(c.slice(11)) : null;
}
module.exports = { hashPassword, verifyPassword, newToken, tokenHash, bearer };
