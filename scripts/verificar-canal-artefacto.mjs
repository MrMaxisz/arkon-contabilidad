// Verificación del CANAL empaquetado dentro del artefacto (app.asar) tras dist:win:qa / dist:win:qa:aislada.
// El paquete QA debe llevar arkonCanal "qa"; el de producción NO debe llevarlo.
// Uso: node scripts/verificar-canal-artefacto.mjs <ruta-win-unpacked> <qa|produccion>
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

export function verificarCanal(pkg, esperado) {
  const canal = typeof pkg?.arkonCanal === 'string' ? pkg.arkonCanal : undefined;
  if (esperado === 'qa') {
    return canal === 'qa'
      ? { ok: true, canal }
      : { ok: false, motivo: `El paquete QA debe llevar arkonCanal "qa"; se encontró: ${canal ?? 'ausente'}` };
  }
  return canal === undefined
    ? { ok: true, canal }
    : { ok: false, motivo: `El paquete de producción NO debe llevar arkonCanal; se encontró: ${canal}` };
}

function main() {
  const [raiz, esperado] = [process.argv[2], process.argv[3]];
  if (!raiz || !esperado || !['qa', 'produccion'].includes(esperado)) {
    console.error('Uso: node scripts/verificar-canal-artefacto.mjs <ruta-win-unpacked> <qa|produccion>');
    process.exit(2);
  }
  const rutaAsar = path.join(raiz, 'resources', 'app.asar');
  if (!existsSync(rutaAsar)) {
    console.error(`FALLA: no existe ${rutaAsar}`);
    process.exit(2);
  }
  const requireCjs = createRequire(import.meta.url);
  const asar = requireCjs('@electron/asar');
  const pkg = JSON.parse(asar.extractFile(rutaAsar, 'package.json').toString('utf8'));
  const resultado = verificarCanal(pkg, esperado);
  console.log(`Artefacto: ${rutaAsar}`);
  console.log(`Canal esperado: ${esperado}; canal encontrado: ${resultado.canal ?? 'ausente'}`);
  if (resultado.ok) {
    console.log('ARTEFACTO_CANAL_PASA');
    process.exit(0);
  }
  console.error(`ARTEFACTO_CANAL_FALLA: ${resultado.motivo}`);
  process.exit(2);
}

const rutaScript = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(rutaScript)) {
  main();
}
