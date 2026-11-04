'use strict';
// Esegue in ordine i file migrations/<dialetto>/*.sql non ancora applicati (tabella schema_migrations).
const fs = require('node:fs');
const path = require('node:path');
const config = require('../src/config');
const { dialectOf } = require('../src/db');

async function open(url) {
  if (dialectOf(url) === 'postgres') {
    const { createPool } = require('../src/db'); const p = createPool(url); const c = await p.raw.connect();
    return { query: async (sql, params) => [(await c.query(require('../src/db').toPg(sql), params)).rows],
      end: async () => { c.release(); await p.end(); } };
  }
  const mysql = require('mysql2/promise');
  return mysql.createConnection({ uri: url, multipleStatements: true });
}

async function migrate(url = config.databaseUrl, log = console.log) {
  const dialect = dialectOf(url);
  const conn = await open(url);
  try {
    await conn.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name VARCHAR(255) PRIMARY KEY, applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
    const [done] = await conn.query('SELECT name FROM schema_migrations');
    const applied = new Set(done.map(r => r.name));
    const dir = path.join(__dirname, '..', 'migrations', dialect);
    for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) {
      if (applied.has(f)) continue;
      log(`migrazione (${dialect}): ${f}`);
      await conn.query(fs.readFileSync(path.join(dir, f), 'utf8'));
      await conn.query('INSERT INTO schema_migrations (name) VALUES (?)', [f]);
    }
  } finally { await conn.end(); }
}
module.exports = { migrate };
if (require.main === module) migrate().then(() => console.log('migrazioni ok'), e => { console.error(e); process.exit(1); });
