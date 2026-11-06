// Reconstrucción EXPLÍCITA de better-sqlite3 para el runtime de Electron (ABI de Electron, no Node).
// Uso: node scripts/rebuild-electron.mjs [versión-electron] [arch] [plataforma]
// Por defecto: 33.4.11, x64, win32 (la plataforma de distribución). Registra ABI/hash resultante.
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const version = process.argv[2] ?? '33.4.11';
const arch = process.argv[3] ?? 'x64';
const platform = process.argv[4] ?? 'win32';

console.log(`== Reconstruir better-sqlite3 para Electron ${version} (${platform}-${arch}) ==`);
// prebuild-install/npm rebuild deben ejecutarse DESDE el directorio de la dependencia
// (el CLI lee el package.json del cwd, no el de better-sqlite3).
const dirDep = path.join(process.cwd(), 'node_modules', 'better-sqlite3');
execSync(
  `prebuild-install --runtime=electron --target=${version} --arch=${arch} --platform=${platform} || npm rebuild --runtime=electron --target=${version} --arch=${arch}`,
  { stdio: 'inherit', cwd: dirDep }
);

const rutaNative = path.join(process.cwd(), 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node');
if (!existsSync(rutaNative)) {
  console.error('FALLA: no se encontró el binario nativo reconstruido:', rutaNative);
  process.exit(2);
}
const hash = createHash('sha256').update(readFileSync(rutaNative)).digest('hex');
const registro = {
  generadoEn: new Date().toISOString(),
  runtime: 'electron',
  target: version,
  arch,
  platform,
  archivo: rutaNative,
  sha256: hash
};
writeFileSync(path.join(process.cwd(), 'abi-electron.json'), JSON.stringify(registro, null, 2), 'utf8');
console.log(`REBUILD OK: sha256=${hash}`);
console.log(`Registro ABI: abi-electron.json`);
