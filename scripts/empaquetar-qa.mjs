// Empaquetado QA de aceptación (auditoría 61): envuelve electron-builder con la configuración QA
// y permite fijar una versión trazable tipo 0.1.0-qa.N vía ARKON_VERSION_QA sin alterar producción.
// Uso: node scripts/empaquetar-qa.mjs   (ARKON_VERSION_QA opcional, p. ej. 0.1.0-qa.61)
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PATRON_VERSION_QA = /^\d+\.\d+\.\d+-qa(\.\d+)?$/;

export function validarVersionQa(version) {
  return PATRON_VERSION_QA.test(version);
}

function main() {
  const args = ['--win', 'nsis', '--publish', 'never', '--config', 'electron-builder.qa.yml'];
  const versionQa = process.env.ARKON_VERSION_QA;
  if (versionQa) {
    if (!validarVersionQa(versionQa)) {
      console.error(`FALLA: ARKON_VERSION_QA debe tener el formato 0.1.0-qa[.N]; se recibió: ${versionQa}`);
      process.exit(2);
    }
    args.push(`--config.extraMetadata.version=${versionQa}`);
    console.log(`Versión QA: ${versionQa}`);
  }
  const electronBuilder = path.join(raiz, 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js');
  const resultado = spawnSync(process.execPath, [electronBuilder, ...args], { stdio: 'inherit', cwd: raiz });
  process.exit(resultado.status ?? 1);
}

const rutaScript = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(rutaScript)) {
  main();
}
