// PROBE con Electron REAL antes de empaquetar: carga better-sqlite3 dentro de Electron y abre
// una base :memory:. Si el ABI no corresponde, Electron termina con error y este script falla.
// Uso: node scripts/probe-electron-abi.mjs
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

console.log('== PROBE: better-sqlite3 con Electron real (ABI esperado 130 para Electron 33) ==');
// Binario REAL de Electron: electron.exe en Windows (el .cmd lanza spawn EINVAL desde Node);
// en Linux/macOS el ejecutable directo del paquete.
const electronExe = process.platform === 'win32'
  ? path.join(process.cwd(), 'node_modules', 'electron', 'dist', 'electron.exe')
  : path.join(process.cwd(), 'node_modules', 'electron', 'dist', 'electron');
if (!existsSync(electronExe)) {
  console.error(`FALLA: no se encontró el binario real de Electron: ${electronExe}`);
  process.exit(2);
}
// Harness con perfil QA exclusivo y timeout: no toca perfiles reales.
const perfilQa = path.join(process.cwd(), 'probe-qa-profile');
const script = `
  try {
    const Database = require('better-sqlite3');
    const info = process.versions;
    const db = new Database(':memory:');
    db.exec('CREATE TABLE probe (id INTEGER)');
    db.prepare('INSERT INTO probe (id) VALUES (1)').run();
    const fila = db.prepare('SELECT id FROM probe').get();
    if (fila.id !== 1) { process.exit(3); }
    console.log('PROBE_ABI_PASA electron=' + info.electron + ' node=' + info.node + ' abi=' + process.versions.modules);
    process.exit(0);
  } catch (err) {
    console.error('PROBE_ABI_FALLA: ' + err.message);
    process.exit(2);
  }
`;
const resultado = spawnSync(electronExe, ['-e', script, '--user-data-dir=' + perfilQa], {
  encoding: 'utf8',
  timeout: 60_000,
  env: { ...process.env, ELECTRON_NO_ATTACH_CONSOLE: '1' }
});
const salida = `${resultado.stdout ?? ''}${resultado.stderr ?? ''}`;
if (resultado.status !== 0 || !salida.includes('PROBE_ABI_PASA')) {
  console.error('FALLA: Electron no pudo cargar better-sqlite3 (ABI incompatible o arranque fallido).');
  console.error(salida || `(sin salida; status=${resultado.status}, signal=${resultado.signal})`);
  process.exit(2);
}
const abi = /abi=(\d+)/.exec(salida)?.[1] ?? 'desconocido';
console.log(`PROBE_ABI_PASA: ABI cargado=${abi}.`);
writeFileSync(path.join(process.cwd(), 'probe-electron.json'), JSON.stringify({
  verificadoEn: new Date().toISOString(),
  resultado: 'PASA',
  abi,
  detalle: 'SQLite :memory: creado, INSERT y SELECT correctos dentro de Electron real con perfil QA exclusivo.'
}, null, 2), 'utf8');
console.log('Registro: probe-electron.json');
