'use strict';
// Helper per start.sh: attende MySQL sul socket locale e (alla prima esecuzione) crea DB e utente applicativo.
// Uso: node scripts/local-db.js <socket> <password> [--bootstrap]
const mysql = require('mysql2/promise');
const [sock, pass, flag] = process.argv.slice(2);
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  let c;
  for (let i = 0; i < 90 && !c; i++) {
    for (const password of flag === '--bootstrap' ? ['', pass] : [pass]) {
      try { c = await mysql.createConnection({ socketPath: sock, user: 'root', password, multipleStatements: true }); break; } catch { /* riprova */ }
    }
    if (!c) await sleep(1000);
  }
  if (!c) { console.error('MySQL non raggiungibile'); process.exit(1); }
  if (flag === '--bootstrap') {
    const q = s => c.query(s, [pass]);
    await c.query("CREATE DATABASE IF NOT EXISTS sourcingdesk CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci");
    for (const h of ['127.0.0.1', 'localhost']) {
      await q(`CREATE USER IF NOT EXISTS 'sourcingdesk'@'${h}' IDENTIFIED BY ?`);
      await c.query(`GRANT ALL PRIVILEGES ON sourcingdesk.* TO 'sourcingdesk'@'${h}'`);
    }
    await q("ALTER USER 'root'@'localhost' IDENTIFIED BY ?");
    console.log('bootstrap MySQL completato');
  }
  await c.end();
})();
