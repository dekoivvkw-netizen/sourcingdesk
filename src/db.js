'use strict';
// Livello DB a doppio dialetto: MySQL/MariaDB (mysql2) oppure PostgreSQL (pg), scelto dallo schema di DATABASE_URL.
// Espone un'interfaccia in stile mysql2: execute/query(sql con "?", params) -> [rows | { affectedRows, insertId }].

function dialectOf(url) { return /^postgres(ql)?:/i.test(url || '') ? 'postgres' : 'mysql'; }

function createMysqlPool(url) {
  const mysql = require('mysql2/promise');
  const pool = mysql.createPool({ uri: url, connectionLimit: 10, dateStrings: true, decimalNumbers: true, timezone: 'Z',
    // Senza FOUND_ROWS: con ON DUPLICATE KEY UPDATE affectedRows vale 1 = inserita, 2 = aggiornata, 0 = invariata.
    flags: ['-FOUND_ROWS'] });
  pool.dialect = 'mysql';
  return pool;
}

function pgSsl(url) {
  // Render (e la maggior parte dei Postgres gestiti) richiede TLS sulle connessioni esterne; quelle interne non lo usano.
  const u = new URL(url); const mode = u.searchParams.get('sslmode') || process.env.PGSSLMODE;
  if (mode === 'disable') return false;
  if (mode === 'require' || mode === 'verify-full') return { rejectUnauthorized: mode === 'verify-full' };
  return false;
}

function toPg(sql) { let i = 0; return sql.replace(/\?/g, () => `$${++i}`); }

function createPgPool(url) {
  const pg = require('pg');
  pg.types.setTypeParser(20, v => Number(v));        // BIGINT (id, COUNT) -> number
  pg.types.setTypeParser(1700, v => parseFloat(v));  // NUMERIC (prezzo) -> number
  const pool = new pg.Pool({ connectionString: url.replace(/[?&]sslmode=[^&]*/, ''), ssl: pgSsl(url), max: 10 });
  pool.on('error', () => {}); // errori di connessioni inattive: il pool le ricrea
  const run = async (sql, params = []) => {
    let text = toPg(sql);
    const isInsert = /^\s*INSERT\s/i.test(text) && !/\bRETURNING\b/i.test(text) && !/^\s*INSERT\s+INTO\s+(sessions|schema_migrations)\b/i.test(text);
    if (isInsert) text += ' RETURNING id';
    try {
      const r = await pool.query(text, params);
      if (r.command === 'SELECT' || (/\bRETURNING\b/i.test(text) && !isInsert)) return [r.rows, r.fields];
      return [{ affectedRows: r.rowCount, insertId: r.rows?.[0]?.id ?? 0, rows: r.rows }, r.fields];
    } catch (e) { if (e.code === '23505') e.code = 'ER_DUP_ENTRY'; throw e; }
  };
  return { dialect: 'postgres', execute: run, query: run, end: () => pool.end(), raw: pool };
}

function createPool(url) { return dialectOf(url) === 'postgres' ? createPgPool(url) : createMysqlPool(url); }
module.exports = { createPool, dialectOf, toPg };
