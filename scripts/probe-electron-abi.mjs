// PROBE con Electron REAL antes de empaquetar: carga better-sqlite3 dentro de Electron y abre
// una base :memory:. Si el ABI no corresponde, Electron termina con error y este script falla.
// Uso: node scripts/probe-electron-abi.mjs
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const rutaMain = path.join(process.cwd(), 'dist', 'main', 'index.js');
console.log('== PROBE: better-sqlite3 con Electron real (ABI esperado 130 para Electron 33) ==');
const script = `
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  db.exec('CREATE TABLE probe (id INTEGER)');
  db.prepare('INSERT INTO probe (id) VALUES (1)').run();
  const fila = db.prepare('SELECT id FROM probe').get();
  if (fila.id !== 1) { process.exit(3); }
  console.log('PROBE_ABI_PASA');
  process.exit(0);
`;
try {
  const salida = execFileSync(
    path.join(process.cwd(), 'node_modules', '.bin', process.platform === 'win32' ? 'electron.cmd' : 'electron'),
    ['-e', script],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
  );
  if (!salida.includes('PROBE_ABI_PASA')) {
    console.error('FALLA: el probe no imprimió PROBE_ABI_PASA. Salida:', salida);
    process.exit(2);
  }
  console.log('PROBE_ABI_PASA: better-sqlite3 carga y opera dentro de Electron.');
  writeFileSync(path.join(process.cwd(), 'probe-electron.json'), JSON.stringify({
    verificadoEn: new Date().toISOString(),
    resultado: 'PASA',
    detalle: 'SQLite :memory: creado, INSERT y SELECT correctos dentro de Electron.'
  }, null, 2), 'utf8');
  console.log('Registro: probe-electron.json');
} catch (err) {
  console.error('FALLA: Electron no pudo cargar better-sqlite3 (ABI incompatible).');
  console.error(String(err.stderr ?? err.message));
  process.exit(2);
}
