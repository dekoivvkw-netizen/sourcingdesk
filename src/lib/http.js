'use strict';
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
function sendJson(res, status, body, headers = {}) {
  const data = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(data);
}
async function readJson(req, limit = 1_000_000) {
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > limit) throw new HttpError(413, 'payload troppo grande'); chunks.push(c); }
  if (!size) return {};
  try { const v = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (!v || typeof v !== 'object' || Array.isArray(v)) throw 0; return v; }
  catch { throw new HttpError(400, 'JSON non valido'); }
}
module.exports = { HttpError, sendJson, readJson };
