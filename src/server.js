'use strict';
const config = require('./config');
const { createPool } = require('./db');
const { createApp } = require('./app');
const { createEvaluator } = require('./lib/ai');
const { safeFetch } = require('./lib/safeFetch');

const pool = createPool(config.databaseUrl);
const server = createApp({
  pool, config,
  evaluate: createEvaluator(config.ai),
  fetchPage: url => safeFetch(url, { timeoutMs: config.robot.timeoutMs, maxBytes: config.robot.maxBytes, allowPrivate: config.robot.allowPrivate }),
});
server.listen(config.port, () => console.log(`SourcingDesk in ascolto su http://0.0.0.0:${config.port} (AI: ${config.ai.apiKey ? 'attiva' : 'euristica locale'})`));
const shutdown = () => server.close(() => pool.end().finally(() => process.exit(0)));
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
