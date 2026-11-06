import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { decidirPerfil, leerCanalDesdePaquete, NOMBRE_MARCADOR_QA, TEXTO_MARCADOR_QA, type AccesoArchivosPerfil } from '../src/main/perfilQa';
import { verificarCanal } from '../scripts/verificar-canal-artefacto.mjs';

// Auditoría 58: barrera de aislamiento QA. Todo con rutas temporales sintéticas;
// NINGUNA prueba usa %LOCALAPPDATA%\ARKON Contabilidad real.

let dir: string;
let operativa: string;
let perfil: string;

function accesoReal(): AccesoArchivosPerfil {
  return {
    resolverRealpath(ruta: string): string {
      try {
        return fs.realpathSync(ruta);
      } catch {
        return ruta;
      }
    },
    leerArchivo(ruta: string): string | null {
      try {
        return fs.readFileSync(ruta, 'utf8');
      } catch {
        return null;
      }
    }
  };
}

function accesoSimulado(realpathPerfil?: string): AccesoArchivosPerfil {
  const base = accesoReal();
  return {
    resolverRealpath(ruta: string): string {
      if (realpathPerfil && path.normalize(ruta).toLowerCase() === path.normalize(perfil).toLowerCase()) {
        return realpathPerfil;
      }
      return base.resolverRealpath(ruta);
    },
    leerArchivo: base.leerArchivo
  };
}

function escribirMarcador(ruta: string, texto = TEXTO_MARCADOR_QA): void {
  fs.writeFileSync(path.join(ruta, NOMBRE_MARCADOR_QA), texto, 'utf8');
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arkon-a58-'));
  operativa = path.join(dir, 'localappdata', 'ARKON Contabilidad');
  perfil = path.join(dir, 'qa', 'perfil-aceptacion');
  fs.mkdirSync(perfil, { recursive: true });
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('auditoría 58: decisión de perfil QA (función pura)', () => {
  it('válido con marcador en la propia ruta: rutaDatos y rutaChromium del perfil', () => {
    escribirMarcador(perfil);
    const decision = decidirPerfil({ canal: 'qa', canalRoto: false, empaquetado: true, rutaEnv: perfil, rutaOperativa: operativa, archivos: accesoReal() });
    expect(decision).toEqual({ canal: 'qa', valido: true, rutaDatos: perfil, rutaChromium: path.join(perfil, 'chromium') });
  });

  it('válido con marcador en el padre directo: chromium derivado de la carpeta del marcador', () => {
    escribirMarcador(path.join(perfil, '..'));
    const decision = decidirPerfil({ canal: 'qa', canalRoto: false, empaquetado: true, rutaEnv: perfil, rutaOperativa: operativa, archivos: accesoReal() });
    expect(decision).toEqual({ canal: 'qa', valido: true, rutaDatos: perfil, rutaChromium: path.join(perfil, '..', 'chromium') });
  });

  it('rechaza sin ARKON_RUTA_DATOS', () => {
    escribirMarcador(perfil);
    const decision = decidirPerfil({ canal: 'qa', canalRoto: false, empaquetado: true, rutaEnv: undefined, rutaOperativa: operativa, archivos: accesoReal() });
    expect(decision.valido).toBe(false);
    expect(decision.motivo).toContain('ARKON_RUTA_DATOS');
  });

  it('rechaza ruta relativa', () => {
    escribirMarcador(perfil);
    const decision = decidirPerfil({ canal: 'qa', canalRoto: false, empaquetado: true, rutaEnv: 'qa/perfil-relativo', rutaOperativa: operativa, archivos: accesoReal() });
    expect(decision.valido).toBe(false);
    expect(decision.motivo).toContain('absoluta');
  });

  it('rechaza la ruta operativa exacta (sin distinguir mayúsculas)', () => {
    const operativaAlias = path.join(dir, 'localappdata', 'arkon contabilidad');
    const decision = decidirPerfil({ canal: 'qa', canalRoto: false, empaquetado: true, rutaEnv: operativaAlias, rutaOperativa: operativa, archivos: accesoReal() });
    expect(decision.valido).toBe(false);
    expect(decision.motivo).toContain('base operativa');
  });

  it('rechaza subruta de la operativa', () => {
    const subruta = path.join(operativa, 'sub', 'qa');
    const decision = decidirPerfil({ canal: 'qa', canalRoto: false, empaquetado: true, rutaEnv: subruta, rutaOperativa: operativa, archivos: accesoSimulado() });
    expect(decision.valido).toBe(false);
    expect(decision.motivo).toContain('subruta');
  });

  it('rechaza junction que resuelve hacia la operativa (realpath)', () => {
    const decision = decidirPerfil({ canal: 'qa', canalRoto: false, empaquetado: true, rutaEnv: perfil, rutaOperativa: operativa, archivos: accesoSimulado(operativa) });
    expect(decision.valido).toBe(false);
    expect(decision.motivo).toContain('base operativa');
  });

  it('rechaza rutas bajo OneDrive', () => {
    const onedrive = path.join(dir, 'OneDrive', 'perfil-qa');
    const decision = decidirPerfil({ canal: 'qa', canalRoto: false, empaquetado: true, rutaEnv: onedrive, rutaOperativa: operativa, archivos: accesoSimulado() });
    expect(decision.valido).toBe(false);
    expect(decision.motivo).toContain('OneDrive');
  });

  it('acepta el marcador con sufijo de fecha que escriben los lanzadores (semilla-qa, qa-windows)', () => {
    escribirMarcador(perfil, 'Perfil QA de ARKON Contabilidad; semilla sintética; 2026-01-01T00:00:00.000Z');
    const decision = decidirPerfil({ canal: 'qa', canalRoto: false, empaquetado: true, rutaEnv: perfil, rutaOperativa: operativa, archivos: accesoReal() });
    expect(decision.valido).toBe(true);
  });

  it('rechaza sin marcador QA', () => {
    const decision = decidirPerfil({ canal: 'qa', canalRoto: false, empaquetado: true, rutaEnv: perfil, rutaOperativa: operativa, archivos: accesoReal() });
    expect(decision.valido).toBe(false);
    expect(decision.motivo).toContain(NOMBRE_MARCADOR_QA);
  });

  it('rechaza marcador con texto incorrecto', () => {
    escribirMarcador(perfil, 'otro contenido');
    const decision = decidirPerfil({ canal: 'qa', canalRoto: false, empaquetado: true, rutaEnv: perfil, rutaOperativa: operativa, archivos: accesoReal() });
    expect(decision.valido).toBe(false);
    expect(decision.motivo).toContain(NOMBRE_MARCADOR_QA);
  });

  it('canal ausente con ARKON_RUTA_DATOS absoluta: misma ruta que hoy (override)', () => {
    const decision = decidirPerfil({ canal: undefined, canalRoto: false, empaquetado: false, rutaEnv: perfil, rutaOperativa: operativa, archivos: accesoReal() });
    expect(decision).toEqual({ canal: 'produccion', rutaDatos: perfil });
  });

  it('canal ausente sin ARKON_RUTA_DATOS: misma ruta que hoy (operativa)', () => {
    const decision = decidirPerfil({ canal: undefined, canalRoto: false, empaquetado: false, rutaEnv: undefined, rutaOperativa: operativa, archivos: accesoReal() });
    expect(decision).toEqual({ canal: 'produccion', rutaDatos: operativa });
  });
});

describe('auditoría 58: orden de arranque en src/main/index.ts', () => {
  const lineas = fs.readFileSync(path.resolve(__dirname, '../src/main/index.ts'), 'utf8').split('\n');
  const lineaDe = (patron: RegExp): number => {
    const indice = lineas.findIndex(l => patron.test(l));
    expect(indice, `patrón no encontrado: ${patron}`).toBeGreaterThanOrEqual(0);
    return indice;
  };

  it('validación y salida 78 ocurren antes del bloqueo de instancia, de crear carpetas y de abrir SQLite', () => {
    const validacion = lineaDe(/const decisionPerfil = decidirPerfil\(\{/);
    const salida = lineaDe(/app\.exit\(78\)/);
    const userData = lineaDe(/app\.setPath\('userData'/);
    const bloqueo = lineaDe(/app\.requestSingleInstanceLock\(\)/);
    const carpetas = lineaDe(/prepararRutasDatos\(rutaDatosArranque\)/);
    const sqlite = lineaDe(/crearContextoBase\(rutas, rutaDb/);
    expect(validacion).toBeLessThan(salida);
    expect(salida).toBeLessThan(userData);
    expect(userData).toBeLessThan(bloqueo);
    expect(bloqueo).toBeLessThan(carpetas);
    expect(bloqueo).toBeLessThan(sqlite);
  });
});

describe('auditoría 58: configuración de empaquetado', () => {
  it('electron-builder.qa.yml: canal qa, runAfterFinish false, sin accesos directos, salida paquete-qa', () => {
    const qa = fs.readFileSync(path.resolve(__dirname, '../electron-builder.qa.yml'), 'utf8');
    expect(qa).toContain('appId: sv.arkon.contabilidad.qa.aceptacion');
    expect(qa).toContain('arkonCanal: qa');
    expect(qa).toMatch(/runAfterFinish:\s*false/);
    expect(qa).toMatch(/createDesktopShortcut:\s*false/);
    expect(qa).toMatch(/createStartMenuShortcut:\s*false/);
    expect(qa).toContain('output: paquete-qa');
    expect(qa).toMatch(/signAndEditExecutable:\s*false/);
  });

  it('electron-builder.yml y package.json del repositorio SIN arkonCanal (producción)', () => {
    const produccion = fs.readFileSync(path.resolve(__dirname, '../electron-builder.yml'), 'utf8');
    expect(produccion).not.toContain('arkonCanal');
    const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf8'));
    expect(pkg.arkonCanal).toBeUndefined();
  });

  it('dist:win:qa:aislada usa electron-builder.qa.yml y verifica canal qa; dist:win:qa verifica canal producción', () => {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf8'));
    const aislada = pkg.scripts['dist:win:qa:aislada'];
    expect(aislada).toContain('node scripts/empaquetar-qa.mjs');
    expect(aislada).toContain('verificar-canal-artefacto.mjs paquete-qa/win-unpacked qa');
    expect(pkg.scripts['dist:win:qa']).toContain('verificar-canal-artefacto.mjs paquete/win-unpacked produccion');
  });
});

describe('auditoría 58: verificador de canal del artefacto', () => {
  it('paquete QA exige arkonCanal qa; producción lo rechaza', () => {
    expect(verificarCanal({ arkonCanal: 'qa' }, 'qa').ok).toBe(true);
    expect(verificarCanal({ arkonCanal: 'produccion' }, 'qa').ok).toBe(false);
    expect(verificarCanal({}, 'qa').ok).toBe(false);
    expect(verificarCanal({}, 'produccion').ok).toBe(true);
    expect(verificarCanal({ arkonCanal: 'qa' }, 'produccion').ok).toBe(false);
  });
});

describe('auditoría 59: fail-closed del canal y chromium del marcador', () => {
  it('empaquetado con lectura rota del paquete: perfil no válido (78) aunque el resto sea válido', () => {
    escribirMarcador(perfil);
    const decision = decidirPerfil({ canal: undefined, canalRoto: true, empaquetado: true, rutaEnv: perfil, rutaOperativa: operativa, archivos: accesoReal() });
    expect(decision).toMatchObject({ canal: 'qa', valido: false });
    if (decision.valido === false) {
      expect(decision.motivo).toContain('package.json');
    }
  });

  it('sin empaquetar, lectura rota NO bloquea (comportamiento de desarrollo histórico)', () => {
    const decision = decidirPerfil({ canal: undefined, canalRoto: true, empaquetado: false, rutaEnv: undefined, rutaOperativa: operativa, archivos: accesoReal() });
    expect(decision).toEqual({ canal: 'produccion', rutaDatos: operativa });
  });

  it('leerCanalDesdePaquete: null o JSON inválido => roto; válido => canal; ausente => undefined', () => {
    expect(leerCanalDesdePaquete(null)).toEqual({ canal: undefined, roto: true });
    expect(leerCanalDesdePaquete('{no json')).toEqual({ canal: undefined, roto: true });
    expect(leerCanalDesdePaquete('{"arkonCanal":"qa"}')).toEqual({ canal: 'qa', roto: false });
    expect(leerCanalDesdePaquete('{"name":"x"}')).toEqual({ canal: undefined, roto: false });
  });

  it('ninguna variable de entorno puede activar o cambiar el canal', () => {
    process.env.ARKON_CANAL = 'qa';
    process.env.ARKON_CANAL_PRODUCCION = 'produccion';
    try {
      expect(leerCanalDesdePaquete('{"name":"x"}').canal).toBeUndefined();
      const decision = decidirPerfil({ canal: undefined, canalRoto: false, empaquetado: true, rutaEnv: perfil, rutaOperativa: operativa, archivos: accesoReal() });
      expect(decision.canal).toBe('produccion');
    } finally {
      delete process.env.ARKON_CANAL;
      delete process.env.ARKON_CANAL_PRODUCCION;
    }
  });
});

describe('auditoría 59: fuente del canal y mensaje de la barrera en src/main', () => {
  const fuente = fs.readFileSync(path.resolve(__dirname, '../src/main/index.ts'), 'utf8');

  it('el canal se lee del package.json empaquetado (app.getAppPath), no del entorno', () => {
    expect(fuente).toContain("path.join(app.getAppPath(), 'package.json')");
    const srcMain = fs.readFileSync(path.resolve(__dirname, '../src/main/index.ts'), 'utf8');
    expect(srcMain).not.toContain('ARKON_CANAL');
  });

  it('ninguna variable de entorno define el canal en src/main', () => {
    const archivos = fs.readdirSync(path.resolve(__dirname, '../src/main'));
    for (const f of archivos.filter(a => a.endsWith('.ts'))) {
      const contenido = fs.readFileSync(path.resolve(__dirname, '../src/main', f), 'utf8');
      expect(contenido, `${f} no debe leer ARKON_CANAL del entorno`).not.toContain('ARKON_CANAL');
    }
  });

  it('el diálogo de la barrera conserva el mensaje exacto', () => {
    expect(fuente).toContain('Esta versión de prueba solo abre con su lanzador y un perfil QA válido. No se abrió ningún dato.');
    expect(fuente).toContain('app.exit(78)');
  });
});

describe('auditoría 59: menú, devTools y bloqueo de navegación (AMP-2)', () => {
  const lineas = fs.readFileSync(path.resolve(__dirname, '../src/main/index.ts'), 'utf8').split('\n');
  const lineaDe = (patron: RegExp): number => {
    const indice = lineas.findIndex(l => patron.test(l));
    expect(indice, `patrón no encontrado: ${patron}`).toBeGreaterThanOrEqual(0);
    return indice;
  };

  it('empaquetado sin menú por defecto; devTools solo sin empaquetar; ventana y navegación bloqueadas', () => {
    const menu = lineaDe(/Menu\.setApplicationMenu\(null\)/);
    const guardadoMenu = lineas.slice(0, menu).reverse().findIndex(l => /app\.isPackaged/.test(l));
    expect(guardadoMenu).toBeGreaterThanOrEqual(0);
    expect(lineaDe(/devTools: !app\.isPackaged/)).toBeGreaterThan(0);
    expect(lineaDe(/setWindowOpenHandler\(\(\) => \(\{ action: 'deny' \}\)\)/)).toBeGreaterThan(0);
    expect(lineaDe(/will-navigate/)).toBeGreaterThan(0);
    const navegacion = lineaDe(/will-navigate/);
    expect(lineas.slice(navegacion, navegacion + 3).join('\n')).toContain('preventDefault');
  });
});

describe('auditoría 59: verificador de canal ejecutable (P1-1)', () => {
  it('desde una carpeta con espacios: sin argumentos exit 2; ruta inexistente exit 2', () => {
    const { spawnSync } = require('node:child_process') as typeof import('node:child_process');
    const dirEspacios = fs.mkdtempSync(path.join(os.tmpdir(), 'arkon qa con espacios-'));
    try {
      const script = path.resolve(__dirname, '../scripts/verificar-canal-artefacto.mjs');
      const sinArgs = spawnSync(process.execPath, [script], { cwd: dirEspacios, encoding: 'utf8' });
      expect(sinArgs.status).toBe(2);
      const inexistente = spawnSync(process.execPath, [script, path.join(dirEspacios, 'no-existe'), 'qa'], { cwd: dirEspacios, encoding: 'utf8' });
      expect(inexistente.status).toBe(2);
      expect(String(inexistente.stderr)).toContain('FALLA');
    } finally {
      fs.rmSync(dirEspacios, { recursive: true, force: true });
    }
  });

  it('otros scripts .mjs no usan el patrón roto import.meta.url.replace("file://", "")', () => {
    const scripts = fs.readdirSync(path.resolve(__dirname, '../scripts')).filter(f => f.endsWith('.mjs'));
    for (const f of scripts) {
      const contenido = fs.readFileSync(path.resolve(__dirname, '../scripts', f), 'utf8');
      expect(contenido, `${f} no debe comparar import.meta.url con replace('file://','')`).not.toContain("import.meta.url.replace('file://'");
    }
  });
});

describe('auditoría 61: versión QA trazable en el empaquetado', () => {
  it('empaquetar-qa.mjs valida el formato 0.1.0-qa[.N] y dist:win:qa:aislada lo usa', async () => {
    const { validarVersionQa } = await import('../scripts/empaquetar-qa.mjs');
    expect(validarVersionQa('0.1.0-qa')).toBe(true);
    expect(validarVersionQa('0.1.0-qa.61')).toBe(true);
    expect(validarVersionQa('0.1.0')).toBe(false);
    expect(validarVersionQa('qa')).toBe(false);
    expect(validarVersionQa('0.1.0-qa.foo')).toBe(false);
    const empaquetar = fs.readFileSync(path.resolve(__dirname, '../scripts/empaquetar-qa.mjs'), 'utf8');
    expect(empaquetar).toContain("'--config', 'electron-builder.qa.yml'");
    expect(empaquetar).toContain('ARKON_VERSION_QA');
    const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf8'));
    expect(pkg.scripts['dist:win:qa:aislada']).toContain('node scripts/empaquetar-qa.mjs');
    expect(pkg.scripts['dist:win:qa:aislada']).not.toContain('electron-builder --win nsis');
    expect(pkg.scripts['dist:win:qa']).not.toContain('empaquetar-qa');
  });

  it('la configuración QA no altera producción: electron-builder.yml sin extraMetadata', () => {
    const produccion = fs.readFileSync(path.resolve(__dirname, '../electron-builder.yml'), 'utf8');
    expect(produccion).not.toContain('extraMetadata');
    expect(produccion).not.toContain('arkonCanal');
  });
});
