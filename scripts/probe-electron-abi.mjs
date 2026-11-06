// PROBE con Electron REAL antes de empaquetar: carga better-sqlite3 dentro de Electron y abre
// una base :memory:. Estrategia comprobada en Windows: script .cjs en archivo con app.setPath
// (userData → perfil temporal exclusivo), require del módulo por ruta absoluta, resultado en
// JSON que el wrapper espera y valida con timeout. Nada de console.log desde el exe GUI.
// Uso: node scripts/probe-electron-abi.mjs
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, rmSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

console.log('== PROBE: better-sqlite3 con Electron real (ABI esperado 130 para Electron 33) ==');
const electronExe = process.platform === 'win32'
  ? path.join(process.cwd(), 'node_modules', 'electron', 'dist', 'electron.exe')
  : path.join(process.cwd(), 'node_modules', 'electron', 'dist', 'electron');
if (!existsSync(electronExe)) {
  console.error(`FALLA: no se encontró el binario real de Electron: ${electronExe}`);
  process.exit(2);
}
const rutaNative = path.join(process.cwd(), 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node');
if (!existsSync(rutaNative)) {
  console.error(`FALLA: no se encontró el binario nativo: ${rutaNative}`);
  process.exit(2);
}
const hashNative = createHash('sha256').update(readFileSync(rutaNative)).digest('hex');

// Perfil temporal exclusivo bajo tmp/LOCALAPPDATA, NUNCA process.cwd() (puede estar en OneDrive).
const dirTrabajo = mkdtempSync(path.join(os.tmpdir(), 'arkon-probe-'));
const rutaScript = path.join(dirTrabajo, 'probe.cjs');
const rutaResultado = path.join(dirTrabajo, 'resultado.json');
const perfilUserData = path.join(dirTrabajo, 'userdata');

const script = `
const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const resultado = ${JSON.stringify(rutaResultado)};
const modulo = ${JSON.stringify(path.join(process.cwd(), 'node_modules', 'better-sqlite3'))};
const nativePath = ${JSON.stringify(rutaNative)};
function salir(payload) {
  try { fs.writeFileSync(resultado, JSON.stringify(payload)); } catch (e) { process.stderr.write('no pude escribir resultado: ' + e.message); }
  app.quit();
}
app.setPath('userData', ${JSON.stringify(perfilUserData)});
app.whenReady().then(() => {
  try {
    const Database = require(modulo);
    const db = new Database(':memory:');
    db.exec('CREATE TABLE probe (id INTEGER)');
    db.prepare('INSERT INTO probe (id) VALUES (1)').run();
    const fila = db.prepare('SELECT id FROM probe').get();
    if (fila.id !== 1) { salir({ ok: false, error: 'SELECT no devolvió el valor insertado' }); return; }
    db.close();
    salir({
      ok: true,
      versionElectron: process.versions.electron,
      abi: process.versions.modules,
      nativePath,
      hashNative: ${JSON.stringify(hashNative)}
    });
  } catch (err) {
    salir({ ok: false, error: err.message });
  }
}).catch((err) => { salir({ ok: false, error: 'whenReady: ' + err.message }); });
`;
writeFileSync(rutaScript, script, 'utf8');

const resultado = spawnSync(electronExe, [rutaScript], {
  encoding: 'utf8',
  timeout: 90_000,
  cwd: dirTrabajo
});
let payload = null;
if (existsSync(rutaResultado)) {
  try {
    payload = JSON.parse(readFileSync(rutaResultado, 'utf8'));
  } catch {
    payload = null;
  }
}
const stderr = `${resultado.stdout ?? ''}${resultado.stderr ?? ''}`;
try {
  rmSync(dirTrabajo, { recursive: true, force: true });
} catch {
  // perfil temporal: mejor esfuerzo de limpieza
}
if (!payload || payload.ok !== true) {
  console.error('FALLA: el probe dentro de Electron no pasó.');
  console.error(payload ? `error: ${payload.error}` : `(sin resultado; status=${resultado.status}, signal=${resultado.signal})`);
  if (stderr.trim()) {
    console.error(`stderr: ${stderr.slice(0, 2000)}`);
  }
  process.exit(2);
}
// Vincular el probe al binario ACTUAL: hash del native cargado debe coincidir con el del disco.
if (payload.hashNative !== hashNative) {
  console.error('FALLA: el hash del native cargado por Electron no coincide con el del disco (binario cambió durante el probe).');
  process.exit(2);
}
console.log(`PROBE_ABI_PASA: Electron ${payload.versionElectron}, ABI ${payload.abi}, native ${hashNative.slice(0, 12)}…`);
writeFileSync(path.join(process.cwd(), 'probe-electron.json'), JSON.stringify({
  verificadoEn: new Date().toISOString(),
  resultado: 'PASA',
  abi: payload.abi,
  versionElectron: payload.versionElectron,
  hashNative,
  detalle: 'SQLite :memory: con INSERT/SELECT dentro de Electron real; hash del native cargado verificado contra el disco.'
}, null, 2), 'utf8');
console.log('Registro: probe-electron.json');
