'use strict';
const test = require('node:test'); const assert = require('node:assert');
const auth = require('../src/lib/auth');
const { offerHash, supplierHash, normalizeUrl } = require('../src/lib/dedupe');
const { extractOffer, parsePrice } = require('../src/lib/extract');

test('scrypt: hash e verifica', async () => {
  const h = await auth.hashPassword('password-lunga-1');
  assert.match(h, /^scrypt\$/);
  assert.ok(await auth.verifyPassword('password-lunga-1', h));
  assert.ok(!(await auth.verifyPassword('sbagliata-123', h)));
  assert.notEqual(h, await auth.hashPassword('password-lunga-1')); // salt diverso
});
test('dedupe: URL normalizzati, hash per utente', () => {
  assert.equal(normalizeUrl('https://WWW.Example.com/p?id=1&utm_source=x#top'), 'https://example.com/p?id=1');
  assert.equal(offerHash(1, 'https://example.com/p/'), offerHash(1, 'https://www.example.com/p?utm_medium=a'));
  assert.notEqual(offerHash(1, 'https://example.com/p'), offerHash(2, 'https://example.com/p'));
  assert.equal(supplierHash(1, 'ACME  Srl', null), supplierHash(1, 'acme srl', null));
});
test('extract: JSON-LD Product', () => {
  const html = `<html><head><title>Pagina</title><script type="application/ld+json">
    {"@context":"https://schema.org","@graph":[{"@type":"Product","name":"Supporto laptop alluminio","description":"Regolabile",
     "brand":{"@type":"Brand","name":"ACME"},"offers":{"@type":"Offer","price":"12.90","priceCurrency":"eur","seller":{"name":"ACME Srl"}}}]}
  </script></head></html>`;
  const r = extractOffer(html, 'https://x.it/p');
  assert.equal(r.title, 'Supporto laptop alluminio'); assert.equal(r.price, 12.9); assert.equal(r.currency, 'EUR'); assert.equal(r.supplierName, 'ACME Srl');
});
test('extract: Open Graph e <title>', () => {
  const html = `<title>Organizer &amp; auto</title><meta property="og:site_name" content="Negozio"><meta property="product:price:amount" content="1.234,50"><meta property="product:price:currency" content="EUR">`;
  const r = extractOffer(html, 'https://x.it');
  assert.equal(r.title, 'Organizer & auto'); assert.equal(r.price, 1234.5); assert.equal(r.supplierName, 'Negozio');
  assert.equal(parsePrice('$1,299.00'), 1299); assert.equal(parsePrice('abc'), null);
});
