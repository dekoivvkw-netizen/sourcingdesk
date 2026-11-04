'use strict';
const test = require('node:test'); const assert = require('node:assert');
const http = require('node:http');
const { isBlockedIp, resolvePublic } = require('../src/lib/ssrf');
const { safeFetch } = require('../src/lib/safeFetch');

test('blocca privati, loopback, link-local, ULA, IPv4-mapped', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.5.4', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0',
    '::1', '::', 'fe80::1', 'fd00::1', 'fc12::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:8.8.8.8', '::ffff:7f00:1',
    '0:0:0:0:0:ffff:7f00:1', '64:ff9b::7f00:1', 'non-un-ip'])
    assert.ok(isBlockedIp(ip), ip);
});
test('consente IPv4 e IPv6 pubblici', () => {
  for (const ip of ['8.8.8.8', '1.1.1.1', '2001:4860:4860::8888', '2606:4700::1111', '2a00:1450:4002::64'])
    assert.ok(!isBlockedIp(ip), ip);
});
test('resolvePublic: IPv6 letterale, solo AAAA, risoluzione mista, protocolli', async () => {
  await assert.rejects(resolvePublic('http://[::1]/'));
  assert.equal((await resolvePublic('https://[2001:4860:4860::8888]/x')).address, '2001:4860:4860::8888');
  const aaaa = async () => [{ address: '2606:4700::1111', family: 6 }];
  assert.equal((await resolvePublic('https://solo-ipv6.example/', { lookup: aaaa })).family, 6);
  const mixed = async () => [{ address: '8.8.8.8', family: 4 }, { address: 'fd00::1', family: 6 }];
  await assert.rejects(resolvePublic('https://misto.example/', { lookup: mixed }));
  await assert.rejects(resolvePublic('file:///etc/passwd'));
  await assert.rejects(resolvePublic('http://user:pw@example.com/'));
});
test('safeFetch rifiuta localhost e i redirect verso host interni', async () => {
  const s = http.createServer((req, res) => { res.writeHead(302, { location: 'http://127.0.0.1:1/' }); res.end(); }).listen(0);
  const port = s.address().port;
  await assert.rejects(safeFetch(`http://127.0.0.1:${port}/`), /non consentito/);
  // Pubblico solo per il primo salto (lookup finto): il redirect verso 127.0.0.1 deve essere bloccato.
  const lookup = async h => (h === 'pubblico.example' ? [{ address: '127.0.0.1', family: 4 }] : [{ address: '127.0.0.1', family: 4 }]);
  await assert.rejects(safeFetch(`http://127.0.0.1:${port}/`, { allowPrivate: false, lookup }), /non consentito/);
  s.close();
});
test('safeFetch: timeout e limite di dimensione (host locale consentito solo nel test)', async () => {
  const s = http.createServer((req, res) => {
    if (req.url === '/lento') return; // non risponde
    if (req.url === '/grande') { res.end('x'.repeat(5000)); return; }
    if (req.url === '/redir') { res.writeHead(301, { location: '/ok' }); return res.end(); }
    res.end('<title>Ok</title>');
  }).listen(0);
  const base = `http://127.0.0.1:${s.address().port}`;
  await assert.rejects(safeFetch(`${base}/lento`, { allowPrivate: true, timeoutMs: 150 }), e => e.status === 504);
  await assert.rejects(safeFetch(`${base}/grande`, { allowPrivate: true, maxBytes: 1000 }), /troppo grande/);
  const r = await safeFetch(`${base}/redir`, { allowPrivate: true });
  assert.match(r.body, /Ok/); assert.match(r.finalUrl, /\/ok$/);
  s.closeAllConnections(); s.close();
});
