import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Harness CJS/JSON temporal externo (os.tmpdir), igual al del producto: app.setPath(userData),
// require del módulo por ruta absoluta, resultado en JSON, wrapper con timeout y cierre garantizado.
// Positivo: el ABI del entorno actual carga SQLite (Node ABI en Linux, Electron ABI en Windows).
// Negativo: un binario .node INVENTADO (bytes sintéticos) debe fallar de forma controlada.
// La prueba NO atribuye avisos del propietario sin evidencia.

interface ResultadoProbe {
  ok: boolean;
  versionRuntime?: string;
  abi?: string;
  hashNative?: string;
  error?: string;
}

function ejecutarHarness(rutaModulo: string): { status: number | null; payload: ResultadoProbe | null } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arkon-probe-test-'));
  try {
    const rutaScript = path.join(dir, 'probe.cjs');
    const rutaResultado = path.join(dir, 'resultado.json');
    const script = `
const fs = require('node:fs');
const resultado = ${JSON.stringify(rutaResultado)};
function salir(payload) {
  try { fs.writeFileSync(resultado, JSON.stringify(payload)); } catch (e) { process.stderr.write(String(e.message)); }
  const esElectron = Boolean(process.versions.electron);
  if (esElectron) {
    try { require('electron').app.exit(payload.ok ? 0 : 2); } catch { process.exit(payload.ok ? 0 : 2); }
    setTimeout(() => process.exit(payload.ok ? 0 : 2), 3000).unref();
  } else {
    process.exit(payload.ok ? 0 : 2);
  }
}
try {
  const modulo = require(${JSON.stringify(rutaModulo)});
  const correr = () => {
    try {
      const Database = modulo.default ?? modulo;
      const db = new Database(':memory:');
      db.exec('CREATE TABLE probe (id INTEGER)');
      db.prepare('INSERT INTO probe (id) VALUES (1)').run();
      const fila = db.prepare('SELECT id FROM probe').get();
      db.close();
      if (fila.id !== 1) { salir({ ok: false, error: 'SELECT incorrecto' }); return; }
      salir({ ok: true, versionRuntime: process.versions.electron ?? process.versions.node, abi: process.versions.modules });
    } catch (err) {
      salir({ ok: false, error: err.message });
    }
  };
  const esElectron = Boolean(process.versions.electron);
  if (esElectron) {
    require('electron').app.setPath('userData', ${JSON.stringify(path.join(dir, 'userdata'))});
    require('electron').app.whenReady().then(correr).catch((e) => salir({ ok: false, error: 'whenReady: ' + e.message }));
  } else {
    correr();
  }
} catch (err) {
  salir({ ok: false, error: err.message });
}
`;
    fs.writeFileSync(rutaScript, script, 'utf8');
    // PRUEBA DE MECANISMO: lanzar SIEMPRE process.execPath (Node) en TODOS los SO. npm test
    // reconstruye el native para el ABI de Node; lanzar Electron aquí cargaría Node137 en
    // Electron130 y fallaría en Windows. La integración con Electron real la hace el producto
    // (scripts/probe-electron-abi.mjs) después del rebuild explícito — nunca esta prueba.
    const comando = process.execPath;
    const r = spawnSync(comando, [rutaScript], {
      encoding: 'utf8',
      timeout: 30_000,
      cwd: dir
    });
    let payload: ResultadoProbe | null = null;
    if (fs.existsSync(rutaResultado)) {
      try {
        payload = JSON.parse(fs.readFileSync(rutaResultado, 'utf8')) as ResultadoProbe;
      } catch {
        payload = null;
      }
    }
    return { status: r.status, payload };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('auditoría 48: harness CJS/JSON del probe de ABI', () => {
  // PRUEBA DE MECANISMO (Node, todos los SO): el flujo npm test recompila el native para el ABI de
  // Node (137), y en Windows NO puede cargarse en Electron (130). El POSITIVO aquí valida el
  // mecanismo del harness (JSON, timeout, cierre) con el runtime de Node y el módulo del ABI actual;
  // la INTEGRACIÓN con Electron real la hace el producto (scripts/probe-electron-abi.mjs) DESPUÉS
  // del rebuild explícito para Electron — nunca reconstruyendo para Electron antes de la suite.
  it('POSITIVO (mecanismo, Node): el módulo nativo del ABI actual carga SQLite :memory: y reporta ABI en JSON', () => {
    const r = ejecutarHarness(path.join(process.cwd(), 'node_modules', 'better-sqlite3'));
    expect(r.payload).not.toBeNull();
    expect(r.payload!.ok).toBe(true);
    expect(r.payload!.abi).toBe(String(process.versions.modules));
    expect(r.payload!.versionRuntime).toBe(process.versions.node);
  });

  it('NEGATIVO: un binario .node sintético e inválido falla de forma controlada con JSON de error', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arkon-probe-neg-'));
    try {
      const rutaNative = path.join(dir, 'falso.node');
      fs.writeFileSync(rutaNative, Buffer.from('bytes sintéticos que no son un módulo nativo válido'));
      const dirModulo = path.join(dir, 'falso-modulo');
      fs.mkdirSync(dirModulo, { recursive: true });
      // Módulo que requiere el binario inválido: debe lanzar NODE_MODULE_VERSION o error de carga.
      const r = ejecutarHarnessConRequire(rutaNative);
      expect(r.payload).not.toBeNull();
      expect(r.payload!.ok).toBe(false);
      expect(r.payload!.error).toBeTruthy();
      expect(r.status === 2 || r.status === 1 || r.status === null).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('REGRESIÓN: el harness de mecanismo lanza SIEMPRE Node (process.execPath), nunca el binario de Electron', () => {
    const contenido = fs.readFileSync(path.join(process.cwd(), 'pruebas', 'probeElectron.prueba.ts'), 'utf8');
    // La selección del ejecutable debe ser incondicional Node, sin bifurcación por plataforma.
    expect(contenido).toContain('const comando = process.execPath;');
    expect(contenido).not.toMatch(/const\s+usarElectron\s*=/);
    expect(contenido).not.toMatch(/comando\s*=\s*usarElectron/);
  });

  it('el pipeline dist:win:qa mantiene rebuild→probe→build→NSIS→verificación y typecheck ejecutable en scripts', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
    expect(pkg.scripts.typecheck).toContain('tsconfig.scripts.json');
    expect(pkg.typecheck).toBeUndefined();
    const dist = pkg.scripts['dist:win:qa'] as string;
    expect(dist.indexOf('rebuild-electron')).toBeLessThan(dist.indexOf('probe-electron-abi'));
    expect(dist.indexOf('probe-electron-abi')).toBeLessThan(dist.indexOf('npm run build'));
    expect(dist.indexOf('electron-builder')).toBeLessThan(dist.indexOf('verificar-abi-artefacto'));
  });
});

function ejecutarHarnessConRequire(rutaNative: string): { status: number | null; payload: ResultadoProbe | null } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arkon-probe-negrun-'));
  try {
    const rutaScript = path.join(dir, 'probe-neg.cjs');
    const rutaResultado = path.join(dir, 'resultado.json');
    fs.writeFileSync(rutaScript, `
const fs = require('node:fs');
const resultado = ${JSON.stringify(rutaResultado)};
try {
  require(${JSON.stringify(rutaNative)});
  fs.writeFileSync(resultado, JSON.stringify({ ok: true }));
  process.exit(0);
} catch (err) {
  fs.writeFileSync(resultado, JSON.stringify({ ok: false, error: err.message }));
  process.exit(2);
}
`, 'utf8');
    const r = spawnSync(process.execPath, [rutaScript], { encoding: 'utf8', timeout: 15_000, cwd: dir });
    let payload: ResultadoProbe | null = null;
    if (fs.existsSync(rutaResultado)) {
      payload = JSON.parse(fs.readFileSync(rutaResultado, 'utf8')) as ResultadoProbe;
    }
    return { status: r.status, payload };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
void createHash;
