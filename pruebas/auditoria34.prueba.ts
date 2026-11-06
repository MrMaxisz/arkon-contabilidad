import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { build } from 'esbuild';
import { abrirBase, prepararRutasDatos } from '../src/main/db/conexion';
import { aplicarMigraciones } from '../src/main/db/aplicarMigraciones';
import { migraciones } from '../src/main/db/migraciones';
import { sembrarCatalogoBase } from '../src/main/servicios/cuentas';
import { despachar } from '../src/main/comandos';
import { crearContraparte, registrarVenta } from '../src/main/servicios/operacion';
import type BetterSqlite3 from 'better-sqlite3';

let dir: string;
let rutaDb: string;
let rutas: ReturnType<typeof prepararRutasDatos>;
const abiertas: Array<BetterSqlite3.Database> = [];

function abrir(): BetterSqlite3.Database {
  const db = abrirBase(rutaDb);
  abiertas.push(db);
  return db;
}

function contexto(db: BetterSqlite3.Database) {
  return {
    db,
    rutas,
    versionApp: 'prueba',
    rutaDb,
    reabrirBase(this: { db: BetterSqlite3.Database }) {
      if (this.db.open) {
        this.db.close();
      }
      this.db = abrirBase(rutaDb);
      aplicarMigraciones(this.db);
    }
  };
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arkon-a34-'));
  rutas = prepararRutasDatos(path.join(dir, 'datos'));
  rutaDb = path.join(rutas.datos, 'op.db');
  fs.mkdirSync(rutas.datos, { recursive: true });
});

afterEach(() => {
  for (const db of abiertas.splice(0)) {
    if (db.open) {
      db.close();
    }
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

function baseNueva(): BetterSqlite3.Database {
  const db = abrir();
  aplicarMigraciones(db);
  sembrarCatalogoBase(db);
  db.prepare("INSERT INTO ambito (id, nombre, tipo) VALUES ('administrativo', 'Prueba a34', 'administrativo')").run();
  return db;
}

function aplicarHasta(db: BetterSqlite3.Database, version: number): void {
  db.exec(`CREATE TABLE IF NOT EXISTS _migracion (
    version INTEGER PRIMARY KEY,
    nombre TEXT NOT NULL,
    aplicada_en TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  const insertar = db.prepare('INSERT INTO _migracion (version, nombre) VALUES (?, ?)');
  for (const m of migraciones.filter(m => m.version <= version)) {
    db.exec(m.sql);
    insertar.run(m.version, m.nombre);
  }
}

function idCuenta(db: BetterSqlite3.Database, codigo: string): number {
  return (db.prepare('SELECT id FROM cuenta WHERE codigo = ?').get(codigo) as { id: number }).id;
}

describe('auditoría 34: bundle del preload autocontenido', () => {
  it('el artefacto del build del preload no requiere módulos locales (sandbox-safe)', async () => {
    const salida = path.join(dir, 'preload', 'index.js');
    fs.mkdirSync(path.dirname(salida), { recursive: true });
    await build({
      entryPoints: ['src/preload/index.ts'],
      bundle: true,
      platform: 'node',
      format: 'cjs',
      external: ['electron'],
      outfile: salida,
      logLevel: 'silent'
    });
    const bundle = fs.readFileSync(salida, 'utf8');
    const requires = Array.from(bundle.matchAll(/require\((['"])(.+?)\1\)/g)).map(m => m[2]);
    expect(requires.every(r => r === 'electron')).toBe(true);
    expect(bundle).not.toContain('require("./comandosPermitidos")');
    expect(bundle).toContain('cierre:ejercicio');
    expect(bundle).toContain('adjunto:verificar');
  });

  it('el bundle ya construido en dist es igualmente autocontenido cuando existe', () => {
    const rutaDist = path.resolve('dist/preload/index.js');
    if (!fs.existsSync(rutaDist)) {
      return;
    }
    const bundle = fs.readFileSync(rutaDist, 'utf8');
    const requires = Array.from(bundle.matchAll(/require\((['"])(.+?)\1\)/g)).map(m => m[2]);
    expect(requires.every(r => r === 'electron')).toBe(true);
    expect(bundle).not.toContain('require("./comandosPermitidos")');
  });
});

describe('auditoría 34: backfill del bloqueo de ejercicio para bases v12', () => {
  it('una base v12 con cierre activo queda bloqueada tras migrar', () => {
    const db = abrir();
    aplicarHasta(db, 12);
    sembrarCatalogoBase(db);
    db.prepare("INSERT INTO ambito (id, nombre, tipo) VALUES ('administrativo', 'Legado a34', 'administrativo')").run();

    db.prepare("INSERT INTO periodo (inicio, fin, estado) VALUES ('2026-12-01', '2026-12-31', 'cerrado')").run();
    const periodoId = (db.prepare("SELECT id FROM periodo WHERE inicio = '2026-12-01'").get() as { id: number }).id;
    db.prepare(
      `INSERT INTO asiento (folio, fecha_operacion, periodo_id, ambito_id, concepto, origen_tipo, origen_id, estado, responsable)
       VALUES ('A-000001', '2026-12-31', ?, 'administrativo', 'Cierre del ejercicio 2026', 'cierre', 'legado', 'contabilizado', 'p')`
    ).run(periodoId);

    aplicarMigraciones(db);

    const fila = db.prepare('SELECT estado, asiento_id FROM cierre_ejercicio WHERE anio = 2026').get() as { estado: string; asiento_id: number };
    expect(fila.estado).toBe('cerrado');
    expect(fila.asiento_id).toBeGreaterThan(0);

    const ctx = contexto(db);
    const cliente = crearContraparte(db, { nombre: 'Cliente Legado A34', esCliente: true, esProveedor: false, responsable: 'p' });
    expect(() =>
      registrarVenta(db, {
        contraparteId: cliente,
        fechaOperacion: '2026-11-10',
        concepto: 'venta retroactiva sintética',
        tipoIngreso: 'instalaciones',
        base: '10.00',
        tasa: '0',
        claveIdempotencia: 'v-leg34',
        responsable: 'p'
      })
    ).toThrow(/está cerrado/);
    void ctx;
    db.close();
  });

  it('una base v12 con cierre anulado queda reabierta y operable tras migrar', () => {
    const db = abrir();
    aplicarHasta(db, 12);
    sembrarCatalogoBase(db);
    db.prepare("INSERT INTO ambito (id, nombre, tipo) VALUES ('administrativo', 'Legado anulado a34', 'administrativo')").run();

    db.prepare("INSERT INTO periodo (inicio, fin, estado) VALUES ('2026-12-01', '2026-12-31', 'abierto')").run();
    const periodoId = (db.prepare("SELECT id FROM periodo WHERE inicio = '2026-12-01'").get() as { id: number }).id;
    const info = db
      .prepare(
        `INSERT INTO asiento (folio, fecha_operacion, periodo_id, ambito_id, concepto, origen_tipo, origen_id, estado, responsable)
         VALUES ('A-000001', '2026-12-31', ?, 'administrativo', 'Cierre del ejercicio 2026', 'cierre', 'legado', 'anulado', 'p')`
      )
      .run(periodoId);

    aplicarMigraciones(db);

    const fila = db.prepare('SELECT estado FROM cierre_ejercicio WHERE anio = 2026').get() as { estado: string };
    expect(fila.estado).toBe('reabierto');

    const ctx = contexto(db);
    const cliente = crearContraparte(db, { nombre: 'Cliente Legado Reabierto A34', esCliente: true, esProveedor: false, responsable: 'p' });
    const venta = registrarVenta(db, {
      contraparteId: cliente,
      fechaOperacion: '2026-11-10',
      concepto: 'venta tras reapertura sintética',
      tipoIngreso: 'instalaciones',
      base: '10.00',
      tasa: '0',
      claveIdempotencia: 'v-leg34b',
      responsable: 'p'
    });
    expect(venta.id).toBeGreaterThan(0);
    void ctx;
    db.close();
  });
});

describe('auditoría 34: vínculos de documento con búsqueda sobre más de 50 documentos', () => {
  it('una base con 55 ventas expone la antigua V-000001 por búsqueda y por límite amplio', () => {
    const db = baseNueva();
    const ctx = contexto(db);
    const cliente = crearContraparte(db, { nombre: 'Cliente Masivo A34', esCliente: true, esProveedor: false, responsable: 'p' });
    for (let i = 1; i <= 55; i++) {
      registrarVenta(db, {
        contraparteId: cliente,
        fechaOperacion: '2026-11-01',
        concepto: `Venta masiva sintética ${i}`,
        tipoIngreso: 'instalaciones',
        base: '1.00',
        tasa: '0',
        claveIdempotencia: `v-masiva34-${i}`,
        responsable: 'p'
      });
    }

    const porDefecto = despachar(ctx, 'documento:listarVinculos', {}) as { venta: Array<{ folio: string }> };
    expect(porDefecto.venta).toHaveLength(50);

    const porBusqueda = despachar(ctx, 'documento:listarVinculos', { busqueda: 'V-000001' }) as { venta: Array<{ folio: string }> };
    expect(porBusqueda.venta.length).toBe(1);
    expect(porBusqueda.venta[0].folio).toBe('V-000001');

    const porConcepto = despachar(ctx, 'documento:listarVinculos', { busqueda: 'masiva sintética 3 ' }) as { venta: Array<{ folio: string }> };
    expect(porConcepto.venta.some(v => v.folio === 'V-000003')).toBe(true);

    const porLimite = despachar(ctx, 'documento:listarVinculos', { limite: 500 }) as { venta: Array<{ folio: string }> };
    expect(porLimite.venta).toHaveLength(55);
    expect(porLimite.venta.some(v => v.folio === 'V-000001')).toBe(true);

    const limiteRechazado = despachar(ctx, 'documento:listarVinculos', { limite: 999999 }) as { venta: Array<{ folio: string }> };
    expect(limiteRechazado.venta.length).toBeLessThanOrEqual(500);
    db.close();
  });
});
