// Verificación del ABI DENTRO del artefacto empaquetado (app.asar.unpacked) tras dist:win:qa.
// Comprueba que el better_sqlite3.node dentro del NSIS desempaquetado (win-unpacked) tenga el
// hash registrado en abi-electron.json (el del probe con Electron real), NO el ABI de Node.
// Uso: node scripts/verificar-abi-artefacto.mjs [ruta-win-unpacked]
import { createHash } from 'node:crypto';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const raiz = process.argv[2] ?? path.join(process.cwd(), 'paquete', 'win-unpacked');
const registro = JSON.parse(readFileSync(path.join(process.cwd(), 'abi-electron.json'), 'utf8'));

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
