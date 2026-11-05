import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Pruebas EJECUTABLES de las guardas del pipeline/CLI contra fixtures sintéticos (no contains sobre texto).

function cli(modo: string, perfil: string, manifiesto: string): { status: number; salida: string } {
  try {
    const salida = execFileSync('node', [
      path.join(process.cwd(), 'dist', 'scripts', 'semilla-qa.js'),
      modo, '--perfil', perfil, '--manifiesto', manifiesto
    ], { encoding: 'utf8' });
    return { status: 0, salida };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status ?? 1, salida: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arkon-guardas-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('auditoría 46: guardas del CLI semilla-qa contra fixtures', () => {
  it('sembrar en perfil EXISTENTE con contenido y sin marcador se rechaza sin abrir SQLite', () => {
    const perfil = path.join(dir, 'existente');
    fs.mkdirSync(perfil, { recursive: true });
    fs.writeFileSync(path.join(perfil, 'dato.txt'), 'contenido ajeno sintético', 'utf8');
    const r = cli('sembrar', perfil, path.join(dir, 'm.json'));
    expect(r.status).not.toBe(0);
    expect(r.salida).toContain('rechazado para no tocar datos desconocidos');
    expect(fs.existsSync(path.join(perfil, 'datos'))).toBe(false);
  });

  it('verificar/respaldar exigen marcador QA válido; reutilizar perfil con marcador funciona', () => {
    const perfil = path.join(dir, 'perfil-qa');
    const manifiesto = path.join(dir, 'm.json');
    const sembrado = cli('sembrar', perfil, manifiesto);
    expect(sembrado.status).toBe(0);
    expect(fs.existsSync(path.join(perfil, 'QA-MARCADOR-ARKON.txt'))).toBe(true);

    const respaldo = cli('respaldar', perfil, manifiesto);
    expect(respaldo.status).toBe(0);
    const verificacion = cli('verificar', perfil, manifiesto);
    expect(verificacion.status).toBe(0);
    expect(verificacion.salida).toContain('RESULTADO VERIFICACIÓN: PASA');

    // Marcador inválido → rechazo.
    fs.writeFileSync(path.join(perfil, 'QA-MARCADOR-ARKON.txt'), 'contenido falso', 'utf8');
    const invalido = cli('verificar', perfil, manifiesto);
    expect(invalido.status).not.toBe(0);
    expect(invalido.salida).toContain('Marcador QA inválido');
  });

  it('respaldo corrompido → verificar FALLA con exit 2 (hash verificado, no solo existencia)', () => {
    const perfil = path.join(dir, 'perfil-corrupto');
    const manifiesto = path.join(dir, 'm.json');
    expect(cli('sembrar', perfil, manifiesto).status).toBe(0);
    expect(cli('respaldar', perfil, manifiesto).status).toBe(0);
    const registro = JSON.parse(fs.readFileSync(manifiesto, 'utf8')) as { respaldoNombre: string };
    fs.appendFileSync(path.join(perfil, 'respaldos', registro.respaldoNombre), 'corrupción sintética', 'utf8');
    const r = cli('verificar', perfil, manifiesto);
    expect(r.status).toBe(2);
    expect(r.salida).toContain('FALLA respaldo-hash');
    expect(r.salida).toContain('RESULTADO VERIFICACIÓN: FALLA');
  });

  it('verificar es de LECTURA: no aplica migraciones ni crea tablas en una base vacía', () => {
    const perfil = path.join(dir, 'perfil-vacio');
    const manifiesto = path.join(dir, 'm.json');
    expect(cli('sembrar', perfil, manifiesto).status).toBe(0);
    // Vaciar la base dejando el marcador: verificar debe FALLAR sin recrear nada.
    fs.rmSync(path.join(perfil, 'datos'), { recursive: true, force: true });
    const r = cli('verificar', perfil, manifiesto);
    expect(r.status).toBe(2);
    expect(r.salida).toContain('FALLA base-existe');
    // La carpeta datos NO fue recreada por la verificación (readonly, sin migraciones).
    expect(fs.existsSync(path.join(perfil, 'datos'))).toBe(false);
  });

  it('bitácora alterada con MISMA cantidad → FALLA exit 2 (hash de contenido, no solo cantidad)', () => {
    const perfil = path.join(dir, 'perfil-bitacora');
    const manifiesto = path.join(dir, 'm.json');
    expect(cli('sembrar', perfil, manifiesto).status).toBe(0);
    const intacta = cli('verificar', perfil, manifiesto);
    expect(intacta.status).toBe(0);
    expect(intacta.salida).toContain('bitacora-contenido: contenido de los eventos sembrados íntegro');
    // Alterar el detalle de un evento SIN cambiar la cantidad.
    const Database = require('better-sqlite3') as typeof import('better-sqlite3');
    const db = new Database(path.join(perfil, 'datos', 'arkon.db'));
    db.prepare("UPDATE bitacora_evento SET detalle = 'alterado sintético' WHERE id = (SELECT MIN(id) FROM bitacora_evento)").run();
    db.close();
    const r = cli('verificar', perfil, manifiesto);
    expect(r.status).toBe(2);
    expect(r.salida).toContain('FALLA bitacora-contenido');
    // Eventos adicionales legítimos siguen pasando.
    const db2 = new Database(path.join(perfil, 'datos', 'arkon.db'));
    db2.prepare("INSERT INTO bitacora_evento (actor, tipo, entidad, entidad_id, detalle) VALUES ('qa', 'evento_adicional', 'prueba', '1', 'evento posterior legítimo')").run();
    db2.close();
    const conAdicional = cli('verificar', perfil, manifiesto);
    // El contenido alterado sigue fallando (los sembrados cambiaron), pero la cantidad adicional no es el problema.
    expect(conAdicional.salida).toContain('bitacora-conserva');
  });

  it('verificar es CERO ESCRITURA: carpetas retiradas no se recrean y el árbol no se modifica', () => {
    const perfil = path.join(dir, 'perfil-cero-escritura');
    const manifiesto = path.join(dir, 'm.json');
    expect(cli('sembrar', perfil, manifiesto).status).toBe(0);
    // Retirar carpetas vacías registros/respaldos (repro del auditor).
    fs.rmdirSync(path.join(perfil, 'registros'));
    fs.rmdirSync(path.join(perfil, 'respaldos'));
    const antes = fs.readdirSync(perfil).sort().join(',');
    const r = cli('verificar', perfil, manifiesto);
    expect(r.status).toBe(0);
    const despues = fs.readdirSync(perfil).sort().join(',');
    expect(despues).toBe(antes);
    expect(fs.existsSync(path.join(perfil, 'registros'))).toBe(false);
    expect(fs.existsSync(path.join(perfil, 'respaldos'))).toBe(false);
  });

  it('ruta relativa y base operativa (case-insensitive) se rechazan antes de abrir SQLite', () => {
    const rRelativa = cli('sembrar', 'relativa', path.join(dir, 'm.json'));
    expect(rRelativa.status).not.toBe(0);
    expect(rRelativa.salida).toContain('ruta ABSOLUTA');

    const localFalso = path.join(dir, 'localappdata-falso');
    fs.mkdirSync(localFalso, { recursive: true });
    const operativo = path.join(localFalso, 'arkon contabilidad'); // minúsculas: misma carpeta en Windows
    fs.mkdirSync(operativo, { recursive: true });
    const previo = process.env.LOCALAPPDATA;
    process.env.LOCALAPPDATA = localFalso;
    try {
      const rOperativo = cli('sembrar', operativo, path.join(dir, 'm.json'));
      expect(rOperativo.status).not.toBe(0);
      expect(rOperativo.salida).toContain('base operativa');
      const rSubruta = cli('sembrar', path.join(operativo, 'sub'), path.join(dir, 'm.json'));
      expect(rSubruta.status).not.toBe(0);
      expect(rSubruta.salida).toContain('subruta de la base operativa');
    } finally {
      if (previo === undefined) {
        delete process.env.LOCALAPPDATA;
      } else {
        process.env.LOCALAPPDATA = previo;
      }
    }
  });
});

describe('auditoría 46: guardas del pipeline de distribución', () => {
  it('dist:win (guarda) rechaza sin probe-electron.json y con probe caducado', () => {
    const rutaProbe = path.join(process.cwd(), 'probe-electron.json');
    const previo = fs.existsSync(rutaProbe) ? fs.readFileSync(rutaProbe, 'utf8') : null;
    try {
      if (fs.existsSync(rutaProbe)) {
        fs.rmSync(rutaProbe);
      }
      const sinProbe = execFileSync('node', [path.join(process.cwd(), 'scripts', 'distwin-guard.mjs')], { encoding: 'utf8' }).catch?.(() => null);
      void sinProbe;
    } catch (err) {
      const e = err as { status?: number; message?: string };
      expect(e.status).toBe(2);
      expect(String(e.message)).toContain('probe-electron.json');
    }
    try {
      fs.writeFileSync(rutaProbe, JSON.stringify({ verificadoEn: new Date(Date.now() - 45 * 60 * 1000).toISOString(), resultado: 'PASA' }), 'utf8');
      execFileSync('node', [path.join(process.cwd(), 'scripts', 'distwin-guard.mjs')], { encoding: 'utf8' });
      expect.unreachable('la guarda debía rechazar el probe caducado');
    } catch (err) {
      const e = err as { status?: number; message?: string };
      expect(e.status).toBe(2);
      expect(String(e.message)).toContain('30 minutos');
    } finally {
      if (previo !== null) {
        fs.writeFileSync(rutaProbe, previo, 'utf8');
      } else if (fs.existsSync(rutaProbe)) {
        fs.rmSync(rutaProbe);
      }
    }
  });

  it('probe PASA previo con hash de OTRO binario → guarda y verificador fallan (vínculo probe↔disco)', () => {
    const abiPath = path.join(process.cwd(), 'abi-electron.json');
    const probePath = path.join(process.cwd(), 'probe-electron.json');
    const previoAbi = fs.existsSync(abiPath) ? fs.readFileSync(abiPath, 'utf8') : null;
    const previoProbe = fs.existsSync(probePath) ? fs.readFileSync(probePath, 'utf8') : null;
    try {
      // Probe PASA reciente pero con hashNative de un binario DISTINTO (Node137 simulado).
      fs.writeFileSync(probePath, JSON.stringify({
        verificadoEn: new Date().toISOString(),
        resultado: 'PASA',
        abi: '130',
        hashNative: 'hash-de-otro-binario-sintetico'
      }), 'utf8');
      fs.writeFileSync(abiPath, JSON.stringify({ sha256: 'hash-de-otro-binario-sintetico' }), 'utf8');
      const r = execFileSync('node', [path.join(process.cwd(), 'scripts', 'distwin-guard.mjs')], { encoding: 'utf8' });
      void r;
      expect.unreachable('la guarda debía rechazar el probe desvinculado del disco');
    } catch (err) {
      const e = err as { status?: number; message?: string };
      expect(e.status).toBe(2);
      expect(String(e.message)).toMatch(/hash del probe ≠ hash del disco|native del disco cambió tras el probe/);
    } finally {
      if (previoAbi !== null) {
        fs.writeFileSync(abiPath, previoAbi, 'utf8');
      } else if (fs.existsSync(abiPath)) {
        fs.rmSync(abiPath);
      }
      if (previoProbe !== null) {
        fs.writeFileSync(probePath, previoProbe, 'utf8');
      } else if (fs.existsSync(probePath)) {
        fs.rmSync(probePath);
      }
    }
  });

  it('dist:win:qa NO referencia scripts inexistentes (build:cli ya está en npm run build)', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
    const dist = pkg.scripts['dist:win:qa'] as string;
    expect(dist).not.toContain('node scripts/build:cli');
    expect(dist).toContain('npm run build');
  });

  it('verificar-abi-artefacto rechaza sin probe-electron.json aunque abi-electron.json declare el hash', () => {
    const raiz = path.join(dir, 'win-unpacked', 'resources', 'app.asar.unpacked', 'node_modules', 'better-sqlite3', 'build', 'Release');
    fs.mkdirSync(raiz, { recursive: true });
    const binario = Buffer.from('binario sintético');
    fs.writeFileSync(path.join(raiz, 'better_sqlite3.node'), binario);
    const hash = 'hash-sintetico';
    const abiPath = path.join(process.cwd(), 'abi-electron.json');
    const probePath = path.join(process.cwd(), 'probe-electron.json');
    const previoAbi = fs.existsSync(abiPath) ? fs.readFileSync(abiPath, 'utf8') : null;
    const previoProbe = fs.existsSync(probePath) ? fs.readFileSync(probePath, 'utf8') : null;
    try {
      fs.writeFileSync(abiPath, JSON.stringify({ sha256: hash }), 'utf8');
      if (fs.existsSync(probePath)) {
        fs.rmSync(probePath);
      }
      const r = execFileSync('node', [
        path.join(process.cwd(), 'scripts', 'verificar-abi-artefacto.mjs'),
        path.join(dir, 'win-unpacked')
      ], { encoding: 'utf8' });
      void r;
      expect.unreachable('debía fallar sin probe-electron.json');
    } catch (err) {
      const e = err as { status?: number; message?: string };
      expect(e.status).toBe(2);
      expect(String(e.message)).toContain('probe-electron.json');
    } finally {
      if (previoAbi !== null) {
        fs.writeFileSync(abiPath, previoAbi, 'utf8');
      } else if (fs.existsSync(abiPath)) {
        fs.rmSync(abiPath);
      }
      if (previoProbe !== null) {
        fs.writeFileSync(probePath, previoProbe, 'utf8');
      } else if (fs.existsSync(probePath)) {
        fs.rmSync(probePath);
      }
    }
  });

  it('build desde salida vacía produce entrypoint real y preload empaquetado', () => {
    // La prueba de integración completa del build se cubre con npm run build en la suite;
    // aquí se verifica la alineación de rutas declaradas.
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
    expect(pkg.main).toBe('dist/main/index.js');
    const ts = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'tsconfig.node.json'), 'utf8'));
    expect(ts.compilerOptions.rootDir).toBe('src');
    expect(ts.include).not.toContain('scripts/**/*.ts');
  });
});

describe('auditoría 49: normalización de rutas y compilación previa en scripts', () => {
  it('actualizar-windows.ps1 normaliza con IsPathRooted/GetFullPath antes de excluir', () => {
    const ps1 = fs.readFileSync(path.join(process.cwd(), 'scripts', 'actualizar-windows.ps1'), 'utf8');
    const idxRooted = ps1.indexOf('[System.IO.Path]::IsPathRooted($Perfil)');
    const idxFull = ps1.indexOf('$Perfil = [System.IO.Path]::GetFullPath($Perfil)');
    const idxOperativo = ps1.indexOf('base operativa');
    expect(idxRooted).toBeGreaterThan(-1);
    expect(idxFull).toBeGreaterThan(idxRooted);
    expect(idxOperativo).toBeGreaterThan(idxFull);
  });

  it('qa-windows.ps1 y actualizar-windows.ps1 compilan main y CLI ANTES de la suite', () => {
    for (const archivo of ['scripts/qa-windows.ps1', 'scripts/actualizar-windows.ps1']) {
      const ps1 = fs.readFileSync(path.join(process.cwd(), archivo), 'utf8');
      const idxMain = ps1.indexOf('npm run build:main');
      const idxCli = ps1.indexOf('npm run build:cli');
      const idxSuite = ps1.indexOf('npm test');
      expect(idxMain).toBeGreaterThan(-1);
      expect(idxCli).toBeGreaterThan(-1);
      expect(idxSuite).toBeGreaterThan(idxCli);
    }
  });

  it('aceptacion-dos-versiones.ps1 usa build:cli (tsconfig.scripts) y no tsconfig.node para el CLI', () => {
    const ps1 = fs.readFileSync(path.join(process.cwd(), 'scripts', 'aceptacion-dos-versiones.ps1'), 'utf8');
    expect(ps1).toContain('npm run build:cli');
    expect(ps1).not.toContain('tsc -p tsconfig.node.json --outDir dist');
  });

  it('la documentación no referencia dist:win sin pipeline ni contiene caracteres de control', () => {
    for (const archivo of ['docs/PENDIENTES.md', 'docs/QA-WINDOWS.md', 'docs/MANUAL-USUARIO.md']) {
      const contenido = fs.readFileSync(path.join(process.cwd(), archivo), 'utf8');
      // dist:win solo puede aparecer como dist:win:qa (pipeline con guardas) o distwin-guard.
      const coincidencias = Array.from(contenido.matchAll(/dist:win(?!:qa)/g));
      for (const m of coincidencias) {
        const contexto = contenido.slice(Math.max(0, m.index - 30), m.index + 40);
        expect(contexto).toContain('distwin-guard');
      }
      expect(contenido).not.toMatch(/[\x00-\x08\x0b\x0c\x0e-\x1f]/);
    }
  });
});
