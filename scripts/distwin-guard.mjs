// Guarda para TODO comando de distribución: rechaza empaquetar sin probe de ABI exitoso.
// dist:win redirige aquí; el empaquetado real es dist:win:qa (rebuild→probe→build→NSIS→verificación).
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const probePath = path.join(process.cwd(), 'probe-electron.json');
if (!existsSync(probePath)) {
  console.error('FALLA: no existe probe-electron.json. El empaquetado SIN el probe de ABI puede instalar un binario de Node (NODE_MODULE_VERSION 137) que no arranca en Electron 33 (130).');
  console.error('Use npm run dist:win:qa (rebuild→probe→build→NSIS→verificación de artefacto).');
  process.exit(2);
}
const probe = JSON.parse(readFileSync(probePath, 'utf8'));
if (probe.resultado !== 'PASA') {
  console.error(`FALLA: el último probe de ABI no pasó (resultado: ${probe.resultado}). Regenerar con dist:win:qa.`);
  process.exit(2);
}
const edadMs = Date.now() - new Date(probe.verificadoEn).getTime();
if (edadMs > 30 * 60 * 1000) {
  console.error(`FALLA: el probe de ABI tiene más de 30 minutos (${Math.round(edadMs / 60000)} min). El binario pudo cambiar (p. ej. rebuild:node de la suite). Reejecutar dist:win:qa.`);
  process.exit(2);
}
console.log('Guarda ABI: probe vigente. Continuaría el empaquetado; para el pipeline completo use npm run dist:win:qa.');
console.log('Este comando NO empaqueta por sí solo: use dist:win:qa.');
process.exit(0);
