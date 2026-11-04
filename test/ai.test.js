'use strict';
const test = require('node:test'); const assert = require('node:assert'); const http = require('node:http');
const { aiFetch, createEvaluator, heuristicScore } = require('../src/lib/ai');

test('aiFetch: timeout -> 504, HTTP 500 -> 502, rete -> 502', async () => {
  const s = http.createServer((req, res) => { if (req.url === '/err') { res.statusCode = 500; res.end(); } }).listen(0);
  const base = `http://127.0.0.1:${s.address().port}`;
  await assert.rejects(aiFetch(`${base}/lento`, {}, 100), e => e.status === 504);
  await assert.rejects(aiFetch(`${base}/err`, {}, 1000), e => e.status === 502);
  await assert.rejects(aiFetch('http://127.0.0.1:1/', {}, 1000), e => e.status === 502);
  s.closeAllConnections(); s.close();
});
test('senza chiave: valutazione euristica', async () => {
  const ev = createEvaluator({ apiKey: '' });
  const r = await ev({ title: 'x', price: 10, currency: 'EUR', moq: 100, lead_time_days: 10, supplier_id: 1 });
  assert.equal(r.source, 'euristica'); assert.ok(r.score >= 0 && r.score <= 100);
  assert.ok(heuristicScore({}).score < r.score);
});
test('con chiave: usa la risposta AI; in errore ripiega sull\'euristica', async () => {
  const ok = createEvaluator({ apiKey: 'k', baseUrl: 'x', model: 'm', timeoutMs: 10 },
    async () => ({ choices: [{ message: { content: '{"score":83,"summary":"Buona"}' } }] }));
  assert.deepEqual(await ok({ title: 't' }), { score: 83, summary: 'Buona', source: 'ai' });
  const ko = createEvaluator({ apiKey: 'k', baseUrl: 'x', model: 'm', timeoutMs: 10 }, async () => { throw Object.assign(new Error('AI timeout'), { status: 504 }); });
  const r = await ko({ title: 't' }); assert.equal(r.source, 'euristica'); assert.match(r.summary, /AI timeout/);
});
