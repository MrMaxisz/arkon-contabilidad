// Verificación del ABI DENTRO del artefacto empaquetado (app.asar.unpacked) tras dist:win:qa.
// Comprueba que el better_sqlite3.node dentro del NSIS desempaquetado (win-unpacked) tenga el
// hash registrado en abi-electron.json (el del probe con Electron real), NO el ABI de Node.
// Uso: node scripts/verificar-abi-artefacto.mjs [ruta-win-unpacked]
import { createHash } from 'node:crypto';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const raiz = process.argv[2] ?? path.join(process.cwd(), 'paquete', 'win-unpacked');
const registro = JSON.parse(readFileSync(path.join(process.cwd(), 'abi-electron.json'), 'utf8'));
const probePath = path.join(process.cwd(), 'probe-electron.json');
if (!existsSync(probePath)) {
  console.error('FALLA: no existe probe-electron.json. Un registro abi-electron.json declarado NO basta: el probe con Electron real debe haber PASADO antes de empaquetar.');
  process.exit(2);
}
const probe = JSON.parse(readFileSync(probePath, 'utf8'));
if (probe.resultado !== 'PASA') {
  console.error(`FALLA: el probe de ABI no pasó (resultado: ${probe.resultado}).`);
  process.exit(2);
}
// Vincular el probe al binario ACTUAL del disco: un probe previo con PASA no vale si el
// native cambió después (p. ej. rebuild:node de la suite). El hash del native cargado por
// el probe debe coincidir con el del disco AHORA y con el del artefacto.
const nativeDisco = path.join(process.cwd(), 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node');
const hashDisco = createHash('sha256').update(readFileSync(nativeDisco)).digest('hex');
if (probe.hashNative !== hashDisco) {
  console.error('FALLA: el probe fue hecho con otro binario (hash del probe ≠ hash del disco actual).');
  console.error(`probe: ${probe.hashNative}`);
  console.error(`disco: ${hashDisco}`);
  console.error('El native cambió tras el probe (¿rebuild:node de la suite?). Reejecutar dist:win:qa.');
  process.exit(2);
}
if (registro.sha256 !== probe.hashNative) {
  console.error('FALLA: abi-electron.json no coincide con el hash del probe; regenerar con rebuild-electron.mjs + probe.');
  process.exit(2);
}

function buscar(directorio) {
  for (const entrada of readdirSync(directorio)) {
    const ruta = path.join(directorio, entrada);
    if (statSync(ruta).isDirectory()) {
      const encontrado = buscar(ruta);
      if (encontrado) return encontrado;
    } else if (entrada === 'better_sqlite3.node') {
      return ruta;
    }
  }
  return null;
}

if (!existsSync(raiz)) {
  console.error(`FALLA: no existe el artefacto desempaquetado: ${raiz}`);
  process.exit(2);
}
const rutaNative = buscar(raiz);
if (!rutaNative) {
  console.error(`FALLA: better_sqlite3.node no encontrado dentro de ${raiz}`);
  process.exit(2);
}
const hash = createHash('sha256').update(readFileSync(rutaNative)).digest('hex');
console.log(`Artefacto: ${rutaNative}`);
console.log(`sha256 artefacto: ${hash}`);
console.log(`sha256 probe Electron: ${registro.sha256}`);
if (hash === registro.sha256) {
  console.log('ARTEFACTO_ABI_PASA: el binario dentro del instalador es el verificado con Electron real.');
  process.exit(0);
}
console.error('ARTEFACTO_ABI_FALLA: el binario del artefacto NO coincide con el del probe de Electron (posible mezcla de ABI Node/Electron).');
process.exit(2);
