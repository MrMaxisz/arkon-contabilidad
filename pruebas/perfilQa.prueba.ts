import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { decidirPerfil, NOMBRE_MARCADOR_QA, TEXTO_MARCADOR_QA, type AccesoArchivosPerfil } from '../src/main/perfilQa';
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
    const decision = decidirPerfil({ canal: 'qa', rutaEnv: perfil, rutaOperativa: operativa, archivos: accesoReal() });
    expect(decision).toEqual({ canal: 'qa', valido: true, rutaDatos: perfil, rutaChromium: path.join(perfil, 'chromium') });
  });

  it('válido con marcador en el padre directo', () => {
    escribirMarcador(path.join(perfil, '..'));
    const decision = decidirPerfil({ canal: 'qa', rutaEnv: perfil, rutaOperativa: operativa, archivos: accesoReal() });
    expect(decision.valido).toBe(true);
  });

  it('rechaza sin ARKON_RUTA_DATOS', () => {
    escribirMarcador(perfil);
    const decision = decidirPerfil({ canal: 'qa', rutaEnv: undefined, rutaOperativa: operativa, archivos: accesoReal() });
    expect(decision.valido).toBe(false);
    expect(decision.motivo).toContain('ARKON_RUTA_DATOS');
  });

  it('rechaza ruta relativa', () => {
    escribirMarcador(perfil);
    const decision = decidirPerfil({ canal: 'qa', rutaEnv: 'qa/perfil-relativo', rutaOperativa: operativa, archivos: accesoReal() });
    expect(decision.valido).toBe(false);
    expect(decision.motivo).toContain('absoluta');
  });

  it('rechaza la ruta operativa exacta (sin distinguir mayúsculas)', () => {
    const operativaAlias = path.join(dir, 'localappdata', 'arkon contabilidad');
    const decision = decidirPerfil({ canal: 'qa', rutaEnv: operativaAlias, rutaOperativa: operativa, archivos: accesoReal() });
    expect(decision.valido).toBe(false);
    expect(decision.motivo).toContain('base operativa');
  });

  it('rechaza subruta de la operativa', () => {
    const subruta = path.join(operativa, 'sub', 'qa');
    const decision = decidirPerfil({ canal: 'qa', rutaEnv: subruta, rutaOperativa: operativa, archivos: accesoSimulado() });
    expect(decision.valido).toBe(false);
    expect(decision.motivo).toContain('subruta');
  });

  it('rechaza junction que resuelve hacia la operativa (realpath)', () => {
    const decision = decidirPerfil({ canal: 'qa', rutaEnv: perfil, rutaOperativa: operativa, archivos: accesoSimulado(operativa) });
    expect(decision.valido).toBe(false);
    expect(decision.motivo).toContain('base operativa');
  });

  it('rechaza rutas bajo OneDrive', () => {
    const onedrive = path.join(dir, 'OneDrive', 'perfil-qa');
    const decision = decidirPerfil({ canal: 'qa', rutaEnv: onedrive, rutaOperativa: operativa, archivos: accesoSimulado() });
    expect(decision.valido).toBe(false);
    expect(decision.motivo).toContain('OneDrive');
  });

  it('acepta el marcador con sufijo de fecha que escriben los lanzadores (semilla-qa, qa-windows)', () => {
    escribirMarcador(perfil, 'Perfil QA de ARKON Contabilidad; semilla sintética; 2026-01-01T00:00:00.000Z');
    const decision = decidirPerfil({ canal: 'qa', rutaEnv: perfil, rutaOperativa: operativa, archivos: accesoReal() });
    expect(decision.valido).toBe(true);
  });

  it('rechaza sin marcador QA', () => {
    const decision = decidirPerfil({ canal: 'qa', rutaEnv: perfil, rutaOperativa: operativa, archivos: accesoReal() });
    expect(decision.valido).toBe(false);
    expect(decision.motivo).toContain(NOMBRE_MARCADOR_QA);
  });

  it('rechaza marcador con texto incorrecto', () => {
    escribirMarcador(perfil, 'otro contenido');
    const decision = decidirPerfil({ canal: 'qa', rutaEnv: perfil, rutaOperativa: operativa, archivos: accesoReal() });
    expect(decision.valido).toBe(false);
    expect(decision.motivo).toContain(NOMBRE_MARCADOR_QA);
  });

  it('canal ausente con ARKON_RUTA_DATOS absoluta: misma ruta que hoy (override)', () => {
    const decision = decidirPerfil({ canal: undefined, rutaEnv: perfil, rutaOperativa: operativa, archivos: accesoReal() });
    expect(decision).toEqual({ canal: 'produccion', rutaDatos: perfil });
  });

  it('canal ausente sin ARKON_RUTA_DATOS: misma ruta que hoy (operativa)', () => {
    const decision = decidirPerfil({ canal: undefined, rutaEnv: undefined, rutaOperativa: operativa, archivos: accesoReal() });
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
    expect(aislada).toContain('--config electron-builder.qa.yml');
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
