'use strict';
// Lint minimale senza dipendenze: controllo sintassi (node --check) di tutti i file JS.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs'); const path = require('node:path');
const root = path.join(__dirname, '..'); let n = 0;
const walk = d => fs.readdirSync(d, { withFileTypes: true }).forEach(e => {
  if (e.name === 'node_modules' || e.name.startsWith('.')) return;
  const p = path.join(d, e.name);
  if (e.isDirectory()) walk(p); else if (p.endsWith('.js')) { execFileSync(process.execPath, ['--check', p]); n++; }
});
walk(root); console.log(`lint ok: ${n} file`);
