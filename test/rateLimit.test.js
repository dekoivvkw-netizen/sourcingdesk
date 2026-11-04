'use strict';
const test = require('node:test'); const assert = require('node:assert');
const { createRateLimiter, clientKey } = require('../src/lib/rateLimit');
test('finestra fissa: limite, chiavi separate, Retry-After e reset', () => {
  let t = 0; const rl = createRateLimiter({ windowMs: 10_000, limit: 2, now: () => t });
  assert.ok(rl.check('a').ok); assert.ok(rl.check('a').ok);
  t = 4000; const r = rl.check('a'); assert.ok(!r.ok); assert.equal(r.retryAfter, 6);
  assert.ok(rl.check('b').ok);
  t = 10_000; assert.ok(rl.check('a').ok);
  rl.stop();
});
test('clientKey: utente prima dell\'IP', () => {
  assert.equal(clientKey({ user: { id: 3 }, socket: { remoteAddress: '1.2.3.4' } }), 'u:3');
  assert.equal(clientKey({ socket: { remoteAddress: '1.2.3.4' } }), 'ip:1.2.3.4');
});
