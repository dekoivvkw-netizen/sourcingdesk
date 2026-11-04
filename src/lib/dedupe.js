'use strict';
const crypto = require('node:crypto');
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
function normalizeUrl(raw) {
  try {
    const u = new URL(String(raw).trim());
    u.hash = '';
    for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid|gclid|ref$)/i.test(k)) u.searchParams.delete(k);
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
    return u.toString().replace(/\/$/, '');
  } catch { return String(raw).trim().toLowerCase(); }
}
// L'hash include l'utente: i duplicati sono per utente e un conflitto non tocca mai righe di altri.
const offerHash = (userId, url) => sha(`offer|${userId}|${normalizeUrl(url)}`);
const supplierHash = (userId, name, website) =>
  sha(`supplier|${userId}|${website ? normalizeUrl(website) : String(name).trim().toLowerCase().replace(/\s+/g, ' ')}`);
module.exports = { normalizeUrl, offerHash, supplierHash };
