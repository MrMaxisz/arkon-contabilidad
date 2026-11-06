import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import Database from 'better-sqlite3';
import { abrirBase, prepararRutasDatos } from '../src/main/db/conexion';
import { aplicarMigraciones } from '../src/main/db/aplicarMigraciones';
import { migraciones } from '../src/main/db/migraciones';
import { sembrarCatalogoBase } from '../src/main/servicios/cuentas';
import { crearRespaldo, restaurarRespaldo, verificarIntegridad } from '../src/main/servicios/respaldo';
import { crearContextoBase, respaldoPeriodicoSiCorresponde, type ContextoApp } from '../src/main/servicios/restauracion';
import { retencionRespaldosAutomaticos } from '../src/main/servicios/adjuntos';
import { crearContraparte, registrarVenta } from '../src/main/servicios/operacion';
import type BetterSqlite3 from 'better-sqlite3';

// Auditoría 65: las copias de respaldo NO dejan -wal/-shm ni temporales huérfanos.
// Se listan los directorios COMPLETOS, sin buscar nombres concretos.

let dir: string;
let rutas: ReturnType<typeof prepararRutasDatos>;
let rutaDb: string;
let db: BetterSqlite3.Database;
const abiertas: Array<BetterSqlite3.Database> = [];

function hashDe(ruta: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(ruta)).digest('hex');
}

function abrir(ruta: string): BetterSqlite3.Database {
  const base = abrirBase(ruta);
  abiertas.push(base);
  return base;
}

function sembrar(base: BetterSqlite3.Database): number {
  const cliente = crearContraparte(base, { nombre: 'Cliente A65', esCliente: true, esProveedor: false, responsable: 'p' });
  registrarVenta(base, {
    contraparteId: cliente, fechaOperacion: '2026-11-10', concepto: 'Venta sintética a65',
    tipoIngreso: 'instalaciones', base: '100.00', tasa: '0', claveIdempotencia: 'v-a65', responsable: 'p'
  });
  return cliente;
}

function contexto(base: BetterSqlite3.Database): ContextoApp {
  return {
    db: base,
    rutas,
    versionApp: 'prueba-a65',
    rutaDb,
    reabrirBase() {
      return;
    }
  };
}

// Cada archivo del directorio de respaldos debe ser .db, .db.manifest.json o -adjuntos (auditoría 65).
function exigirSoloRespaldoLimpio(dirRespaldos: string): void {
  const archivos = fs.readdirSync(dirRespaldos);
  for (const f of archivos) {
    expect(
      f.endsWith('.db') || f.endsWith('.db.manifest.json') || f.endsWith('-adjuntos'),
      `archivo inesperado en respaldos: ${f}`
    ).toBe(true);
    expect(f, `resto WAL/SHM en respaldos: ${f}`).not.toMatch(/-wal$|-shm$|\.tmp(-wal|-shm)?$/);
  }
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arkon-a65-'));
  rutas = prepararRutasDatos(path.join(dir, 'perfil'));
  rutaDb = path.join(rutas.datos, 'arkon.db');
  db = abrir(rutaDb);
  aplicarMigraciones(db);
  db.prepare("INSERT INTO ambito (id, nombre, tipo) VALUES ('administrativo', 'Prueba a65', 'administrativo')").run();
  sembrarCatalogoBase(db);
});

afterEach(() => {
  for (const base of abiertas.splice(0)) {
    if (base.open) {
      base.close();
    }
  }
  fs.rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('auditoría 65: respaldos sin restos -wal/-shm', () => {
  it('1. tras el respaldo manual solo quedan .db, .db.manifest.json y -adjuntos', async () => {
    sembrar(db);
    const info = await crearRespaldo(db, rutas.respaldos, 'prueba-a65', rutas.adjuntos);
    expect(fs.existsSync(path.join(rutas.respaldos, info.nombre))).toBe(true);
    exigirSoloRespaldoLimpio(rutas.respaldos);
  });

  it('2a. tras el respaldo automático periódico no queda ningún resto', async () => {
    sembrar(db);
    db.prepare("INSERT OR REPLACE INTO configuracion (clave, valor) VALUES ('respaldo_intervalo_minutos', '60')").run();
    const resultado = await respaldoPeriodicoSiCorresponde(contexto(db));
    expect(resultado.creado).toBe(true);
    exigirSoloRespaldoLimpio(rutas.respaldos);
  });

  it('2b. tras el respaldo previo a migración (ejecutado de verdad desde esquema anterior) no queda ningún resto', async () => {
    // Base con esquema N-1: se aplican todas las migraciones salvo la última.
    db.close();
    fs.rmSync(rutaDb, { force: true });
    fs.rmSync(`${rutaDb}-wal`, { force: true });
    fs.rmSync(`${rutaDb}-shm`, { force: true });
    const previa = new Database(rutaDb);
    previa.pragma('journal_mode = WAL');
    previa.exec(`CREATE TABLE IF NOT EXISTS _migracion (
      version INTEGER PRIMARY KEY,
      nombre TEXT NOT NULL,
      aplicada_en TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    for (const m of migraciones.slice(0, -1)) {
      previa.exec(m.sql);
      previa.prepare('INSERT INTO _migracion (version, nombre) VALUES (?, ?)').run(m.version, m.nombre);
    }
    previa.close();
    const ctx = await crearContextoBase(rutas, rutaDb, 'prueba-a65');
    abiertas.push(ctx.db);
    const previos = fs.readdirSync(rutas.respaldos).filter(f => f.startsWith('respaldo-previo-migracion-') && f.endsWith('.db'));
    expect(previos.length).toBe(1);
    exigirSoloRespaldoLimpio(rutas.respaldos);
    expect((ctx.db.prepare('SELECT MAX(version) AS v FROM _migracion').get() as { v: number }).v).toBe(migraciones[migraciones.length - 1].version);
  });

  it('3. la retención depura el respaldo completo, incluidos restos huérfanos de versiones previas', async () => {
    db.prepare("INSERT OR REPLACE INTO configuracion (clave, valor) VALUES ('respaldo_retencion_automatica', '1')").run();
    // Respaldo viejo con restos huérfanos como los que dejó abc9b01 (rutas exactas derivadas).
    const viejo = 'respaldo-automatico-2026-01-01T00-00-00-000Z.db';
    fs.writeFileSync(path.join(rutas.respaldos, viejo), 'viejo');
    fs.writeFileSync(path.join(rutas.respaldos, `${viejo}.manifest.json`), '{}');
    fs.writeFileSync(path.join(rutas.respaldos, `${viejo}.tmp-wal`), '');
    fs.writeFileSync(path.join(rutas.respaldos, `${viejo}.tmp-shm`), '');
    fs.writeFileSync(path.join(rutas.respaldos, `${viejo}-wal`), '');
    fs.writeFileSync(path.join(rutas.respaldos, `${viejo}-shm`), '');
    // Respaldo nuevo que se conserva.
    const nuevo = 'respaldo-automatico-2026-02-01T00-00-00-000Z.db';
    fs.writeFileSync(path.join(rutas.respaldos, nuevo), 'nuevo');
    fs.writeFileSync(path.join(rutas.respaldos, `${nuevo}.manifest.json`), '{}');
    const resultado = retencionRespaldosAutomaticos(db, rutas.respaldos);
    expect(resultado.depurados).toBe(1);
    const restantes = fs.readdirSync(rutas.respaldos);
    expect(restantes.sort()).toEqual([`${nuevo}.manifest.json`, nuevo].sort());
  });

  it('4. tras restaurar, respaldos no gana archivos y datos no conserva restauracion-tmp; hash intacto', async () => {
    sembrar(db);
    const info = await crearRespaldo(db, rutas.respaldos, 'prueba-a65');
    const rutaRespaldo = path.join(rutas.respaldos, info.nombre);
    const hashAntes = hashDe(rutaRespaldo);
    const listadoRespaldosAntes = fs.readdirSync(rutas.respaldos).sort();

    restaurarRespaldo(db, rutaRespaldo, rutaDb);

    expect(fs.readdirSync(rutas.respaldos).sort()).toEqual(listadoRespaldosAntes);
    expect(hashDe(rutaRespaldo)).toBe(hashAntes);
    const restosDatos = fs.readdirSync(rutas.datos).filter(f => f.includes('restauracion-tmp'));
    expect(restosDatos).toEqual([]);
  });

  it('5. un respaldo ya existente en modo WAL (como abc9b01) sigue restaurándose con hash intacto', async () => {
    sembrar(db);
    const nombre = 'respaldo-2026-01-01T00-00-00-000Z.db';
    const destino = path.join(rutas.respaldos, nombre);
    fs.mkdirSync(rutas.respaldos, { recursive: true });
    await db.backup(destino);
    const hash = hashDe(destino);
    fs.writeFileSync(`${destino}.manifest.json`, JSON.stringify({ nombre, hashSha256: hash, adjuntos: [] }), 'utf8');
    db.prepare('INSERT INTO respaldo (nombre, hash_sha256, version_app, version_esquema, estado) VALUES (?, ?, ?, ?, ?)')
      .run(nombre, hash, 'prueba-a65', 0, 'disponible');
    // Restos que la versión anterior dejaba junto al respaldo: la restauración no los necesita.
    fs.writeFileSync(`${destino}-wal`, '');
    fs.writeFileSync(`${destino}-shm`, '');

    const resultado = restaurarRespaldo(db, destino, rutaDb);

    expect(resultado.ok).toBe(true);
    expect(hashDe(destino)).toBe(hash);
    const restaurada = abrir(rutaDb);
    expect(restaurada.prepare('SELECT COUNT(*) AS n FROM venta').get()).toMatchObject({ n: 1 });
  });

  it('6a. fallo REAL de verificación durante la creación manual: sin .tmp, -wal, -shm ni manifiesto, error al llamador', async () => {
    sembrar(db);
    const listadoAntes = fs.readdirSync(rutas.respaldos);
    // El backup produce un archivo que NO es SQLite: verificarIntegridad falla de verdad.
    vi.spyOn(db, 'backup').mockImplementationOnce(async (rutaTemporal: string) => {
      fs.writeFileSync(rutaTemporal, 'basura sintética que no es una base SQLite');
    });
    await expect(crearRespaldo(db, rutas.respaldos, 'prueba-a65')).rejects.toThrow();
    expect(fs.readdirSync(rutas.respaldos)).toEqual(listadoAntes);
    exigirSoloRespaldoLimpio(rutas.respaldos);
  });

  it('6b. fallo de renombrado durante la creación manual: sin restos ni manifiesto, error al llamador', async () => {
    sembrar(db);
    const listadoAntes = fs.readdirSync(rutas.respaldos);
    vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => {
      throw new Error('fallo sintético de renombrado');
    });
    await expect(crearRespaldo(db, rutas.respaldos, 'prueba-a65')).rejects.toThrow('fallo sintético de renombrado');
    expect(fs.readdirSync(rutas.respaldos)).toEqual(listadoAntes);
    exigirSoloRespaldoLimpio(rutas.respaldos);
  });

  it('6c. fallo del registro tras la creación: archivo y fila ausentes los dos (coherentes)', async () => {
    sembrar(db);
    // La fila de bitácora no existe: INSERT en transacción y retiro de archivo+manifiesto.
    db.exec('DROP TABLE bitacora_evento');
    await expect(crearRespaldo(db, rutas.respaldos, 'prueba-a65')).rejects.toThrow();
    expect(fs.readdirSync(rutas.respaldos)).toEqual([]);
    const filas = db.prepare('SELECT COUNT(*) AS n FROM respaldo').get() as { n: number };
    expect(filas.n).toBe(0);
  });

  it('7. el hash del manifiesto corresponde byte a byte al archivo final y este pasa integrity_check', async () => {
    sembrar(db);
    const info = await crearRespaldo(db, rutas.respaldos, 'prueba-a65');
    const destino = path.join(rutas.respaldos, info.nombre);
    const manifiesto = JSON.parse(fs.readFileSync(`${destino}.manifest.json`, 'utf8')) as { hashSha256: string };
    expect(manifiesto.hashSha256).toBe(hashDe(destino));
    expect(verificarIntegridad(destino)).toBeUndefined();
    expect(fs.readdirSync(rutas.respaldos).every(f => !f.match(/-wal$|-shm$|\.tmp/))).toBe(true);
  });

  it('8. la base restaurada se abre con la aplicación en WAL y conserva los documentos', async () => {
    sembrar(db);
    const info = await crearRespaldo(db, rutas.respaldos, 'prueba-a65');
    restaurarRespaldo(db, path.join(rutas.respaldos, info.nombre), rutaDb);
    const restaurada = abrir(rutaDb);
    expect(restaurada.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(restaurada.prepare('SELECT COUNT(*) AS n FROM venta').get()).toMatchObject({ n: 1 });
    expect(restaurada.prepare("SELECT folio FROM venta").get()).toMatchObject({ folio: 'V-000001' });
  });

  it('9. con la base activa abierta, el respaldo no toca arkon.db ni sus -wal/-shm', async () => {
    sembrar(db);
    const hashBaseAntes = hashDe(rutaDb);
    const listadoDatosAntes = fs.readdirSync(rutas.datos).sort();
    await crearRespaldo(db, rutas.respaldos, 'prueba-a65');
    expect(hashDe(rutaDb)).toBe(hashBaseAntes);
    expect(fs.readdirSync(rutas.datos).sort()).toEqual(listadoDatosAntes);
    exigirSoloRespaldoLimpio(rutas.respaldos);
  });
});

describe('auditoría 66: alcance de la limpieza y fallos reales', () => {
  it('P1: un fallo REAL de retención no borra el respaldo nuevo; archivo, manifiesto y fila coherentes', async () => {
    sembrar(db);
    db.prepare("INSERT OR REPLACE INTO configuracion (clave, valor) VALUES ('respaldo_retencion_automatica', '1')").run();
    db.prepare("INSERT OR REPLACE INTO configuracion (clave, valor) VALUES ('respaldo_intervalo_minutos', '60')").run();
    // Respaldo automático viejo cuyo manifiesto es un DIRECTORIO: rmSync de retención falla de verdad (EPERM/EISDIR).
    const viejo = 'respaldo-automatico-2026-01-01T00-00-00-000Z.db';
    fs.writeFileSync(path.join(rutas.respaldos, viejo), 'viejo');
    fs.mkdirSync(path.join(rutas.respaldos, `${viejo}.manifest.json`));

    await expect(respaldoPeriodicoSiCorresponde(contexto(db))).rejects.toThrow();

    const archivos = fs.readdirSync(rutas.respaldos).filter(f => f.startsWith('respaldo-automatico-') && f.endsWith('.db'));
    expect(archivos.length).toBe(1);
    const nuevo = archivos[0];
    expect(nuevo > viejo).toBe(true);
    const rutaNuevo = path.join(rutas.respaldos, nuevo);
    const manifiesto = JSON.parse(fs.readFileSync(`${rutaNuevo}.manifest.json`, 'utf8')) as { hashSha256: string };
    expect(manifiesto.hashSha256).toBe(hashDe(rutaNuevo));
    const fila = db.prepare('SELECT estado FROM respaldo WHERE nombre = ?').get(nuevo) as { estado: string };
    expect(fila.estado).toBe('disponible');
    exigirSoloRespaldoLimpio(rutas.respaldos);
  });

  it('P2: fallo de renombrado en el periódico: sin ningún resto (listado completo)', async () => {
    sembrar(db);
    db.prepare("INSERT OR REPLACE INTO configuracion (clave, valor) VALUES ('respaldo_intervalo_minutos', '60')").run();
    const listadoAntes = fs.readdirSync(rutas.respaldos);
    vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => {
      throw new Error('fallo sintético de renombrado periódico');
    });
    await expect(respaldoPeriodicoSiCorresponde(contexto(db))).rejects.toThrow('fallo sintético de renombrado periódico');
    expect(fs.readdirSync(rutas.respaldos)).toEqual(listadoAntes);
    exigirSoloRespaldoLimpio(rutas.respaldos);
  });

  it('P2: fallo de renombrado en el previo a migración: sin ningún resto (listado completo)', async () => {
    db.close();
    fs.rmSync(rutaDb, { force: true });
    fs.rmSync(`${rutaDb}-wal`, { force: true });
    fs.rmSync(`${rutaDb}-shm`, { force: true });
    const previa = new Database(rutaDb);
    previa.pragma('journal_mode = WAL');
    previa.exec(`CREATE TABLE IF NOT EXISTS _migracion (
      version INTEGER PRIMARY KEY,
      nombre TEXT NOT NULL,
      aplicada_en TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    for (const m of migraciones.slice(0, -1)) {
      previa.exec(m.sql);
      previa.prepare('INSERT INTO _migracion (version, nombre) VALUES (?, ?)').run(m.version, m.nombre);
    }
    previa.close();
    vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => {
      throw new Error('fallo sintético de renombrado previo migración');
    });
    await expect(crearContextoBase(rutas, rutaDb, 'prueba-a65')).rejects.toThrow('fallo sintético de renombrado previo migración');
    const previos = fs.readdirSync(rutas.respaldos).filter(f => f.startsWith('respaldo-previo-migracion-'));
    expect(previos).toEqual([]);
    exigirSoloRespaldoLimpio(rutas.respaldos);
    const base = abrir(rutaDb);
    aplicarMigraciones(base);
  });

  it('P2: fallo REAL de verificación del área temporal en restauración: sin restauracion-tmp y hash intacto', async () => {
    sembrar(db);
    const info = await crearRespaldo(db, rutas.respaldos, 'prueba-a65');
    const rutaRespaldo = path.join(rutas.respaldos, info.nombre);
    const hashAntes = hashDe(rutaRespaldo);
    // La copia del área temporal sale corrupta: verificarIntegridad falla de verdad.
    vi.spyOn(fs, 'copyFileSync').mockImplementationOnce((origen: string, destino: string) => {
      fs.writeFileSync(destino, 'basura sintética que no es una base SQLite');
    });
    expect(() => restaurarRespaldo(db, rutaRespaldo, rutaDb)).toThrow();
    const restos = fs.readdirSync(rutas.datos).filter(f => f.includes('restauracion-tmp'));
    expect(restos).toEqual([]);
    expect(hashDe(rutaRespaldo)).toBe(hashAntes);
    exigirSoloRespaldoLimpio(rutas.respaldos);
  });

  it('P2-66-3: una ruta inexistente falla la verificación SIN crear ningún archivo', () => {
    const rutaInexistente = path.join(dir, 'no-existe', 'respaldo-inexistente.db');
    expect(() => verificarIntegridad(rutaInexistente)).toThrow();
    expect(fs.existsSync(path.dirname(rutaInexistente))).toBe(false);
    expect(fs.readdirSync(dir).includes('no-existe')).toBe(false);
  });
});
