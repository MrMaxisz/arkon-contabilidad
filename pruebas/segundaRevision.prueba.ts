import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { migraciones } from '../src/main/db/migraciones';
import { aplicarMigraciones } from '../src/main/db/aplicarMigraciones';
import { abrirBase, prepararRutasDatos } from '../src/main/db/conexion';
import { sembrarCatalogoBase } from '../src/main/servicios/cuentas';
import { contabilizarAsiento, listarAsientos, mayorDeCuenta } from '../src/main/servicios/motorAsientos';
import { balanceResumen } from '../src/main/servicios/estadosFinancieros';
import { crearRespaldo, descubrirRespaldos } from '../src/main/servicios/respaldo';
import { crearContextoBase, manejarRestauracion } from '../src/main/servicios/restauracion';
import { fechaLocalElSalvador } from '../src/shared/fechas';
import os from 'os';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arkon-revp2-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function idCuenta(db: Database.Database, codigo: string): number {
  return (db.prepare('SELECT id FROM cuenta WHERE codigo = ?').get(codigo) as { id: number }).id;
}

function catalogoAnticipo(db: Database.Database): Record<string, { nombre: string; tipo: string; padre: string | null }> {
  const filas = db
    .prepare("SELECT codigo, nombre, tipo, padre_id FROM cuenta WHERE codigo IN ('1202','2102')")
    .all() as Array<{ codigo: string; nombre: string; tipo: string; padre_id: number | null }>;
  const grupos = new Map(
    (db.prepare('SELECT id, codigo FROM cuenta').all() as Array<{ id: number; codigo: string }>).map(g => [g.id, g.codigo])
  );
  const salida: Record<string, { nombre: string; tipo: string; padre: string | null }> = {};
  for (const f of filas) {
    salida[f.codigo] = { nombre: f.nombre, tipo: f.tipo, padre: f.padre_id ? grupos.get(f.padre_id) ?? null : null };
  }
  return salida;
}

describe('normalización del catálogo de anticipos (migración v3)', () => {
  it('una base v1 migrada converge con una instalación nueva, preservando los movimientos', async () => {
    const rutaVieja = path.join(dir, 'vieja.db');
    const dbVieja = abrirBase(rutaVieja);
    dbVieja.exec(migraciones[0].sql);
    dbVieja.exec("CREATE TABLE IF NOT EXISTS _migracion (version INTEGER PRIMARY KEY, nombre TEXT NOT NULL, aplicada_en TEXT NOT NULL DEFAULT (datetime('now')))");
    dbVieja.prepare('INSERT INTO _migracion (version, nombre) VALUES (1, ?)').run(migraciones[0].nombre);
    dbVieja.prepare(
      "INSERT INTO ambito (id, nombre, tipo) VALUES ('administrativo', 'Prueba v1', 'administrativo')"
    ).run();
    dbVieja.exec(`INSERT INTO cuenta (codigo, nombre, tipo, es_grupo, padre_id) VALUES
      ('1', 'Activos', 'activo', 1, NULL),
      ('11', 'Efectivo', 'activo', 1, (SELECT id FROM cuenta WHERE codigo='1')),
      ('1101', 'Caja general', 'activo', 0, (SELECT id FROM cuenta WHERE codigo='11')),
      ('12', 'Cuentas por cobrar', 'activo', 1, (SELECT id FROM cuenta WHERE codigo='1')),
      ('1202', 'Anticipos de clientes', 'activo', 0, (SELECT id FROM cuenta WHERE codigo='12')),
      ('2', 'Pasivos', 'pasivo', 1, NULL),
      ('21', 'Cuentas por pagar', 'pasivo', 1, (SELECT id FROM cuenta WHERE codigo='2')),
      ('2101', 'Proveedores', 'pasivo', 0, (SELECT id FROM cuenta WHERE codigo='21')),
      ('2102', 'Anticipos a proveedores', 'pasivo', 0, (SELECT id FROM cuenta WHERE codigo='21')),
      ('3', 'Patrimonio', 'patrimonio', 1, NULL),
      ('3101', 'Cuentas de participantes', 'patrimonio', 0, (SELECT id FROM cuenta WHERE codigo='3'))`);
    const idAnticipoClientesViejo = idCuenta(dbVieja, '1202');
    contabilizarAsiento(dbVieja, {
      fechaOperacion: '2026-01-10',
      concepto: 'Anticipo recibido sintético (era v1)',
      responsable: 'prueba',
      ambitoId: 'administrativo',
      claveIdempotencia: 'v1-anticipo-cliente',
      lineas: [
        { cuentaId: idCuenta(dbVieja, '1101'), debeMinor: '200.00', haberMinor: '' },
        { cuentaId: idCuenta(dbVieja, '1202'), debeMinor: '', haberMinor: '200.00' }
      ]
    });
    aplicarMigraciones(dbVieja);
    aplicarMigraciones(dbVieja);

    const rutaNueva = path.join(dir, 'nueva.db');
    const dbNueva = abrirBase(rutaNueva);
    aplicarMigraciones(dbNueva);
    dbNueva.prepare(
      "INSERT INTO ambito (id, nombre, tipo) VALUES ('administrativo', 'Prueba nueva', 'administrativo')"
    ).run();
    sembrarCatalogoBase(dbNueva, 'prueba');

    const catViejo = catalogoAnticipo(dbVieja);
    const catNuevo = catalogoAnticipo(dbNueva);
    expect(catViejo).toEqual(catNuevo);
    expect(catNuevo['1202']).toEqual({ nombre: 'Anticipos a proveedores', tipo: 'activo', padre: '12' });
    expect(catNuevo['2102']).toEqual({ nombre: 'Anticipos recibidos de clientes', tipo: 'pasivo', padre: '21' });

    const saldoCuenta = mayorDeCuenta(dbVieja, idAnticipoClientesViejo);
    expect(saldoCuenta.saldoMinor).toBe('-200.00');
    const filaMigrada = dbVieja
      .prepare('SELECT codigo, tipo FROM cuenta WHERE id = ?')
      .get(idAnticipoClientesViejo) as { codigo: string; tipo: string };
    expect(filaMigrada.codigo).toBe('2102');
    expect(filaMigrada.tipo).toBe('pasivo');
    expect(balanceResumen(dbVieja).cuadra).toBe(true);

    contabilizarAsiento(dbVieja, {
      fechaOperacion: '2026-01-12',
      concepto: 'Anticipo recibido sintético (era v3)',
      responsable: 'prueba',
      ambitoId: 'administrativo',
      claveIdempotencia: 'v3-anticipo-cliente',
      lineas: [
        { cuentaId: idCuenta(dbVieja, '1101'), debeMinor: '50.00', haberMinor: '' },
        { cuentaId: idCuenta(dbVieja, '2102'), debeMinor: '', haberMinor: '50.00' }
      ]
    });
    expect(mayorDeCuenta(dbVieja, idCuenta(dbVieja, '2102')).saldoMinor).toBe('-250.00');
    dbVieja.close();
    dbNueva.close();
  });
});

describe('traslado de líneas hacia asientos contabilizados', () => {
  it('un UPDATE que mueva una línea a un asiento contabilizado se rechaza', async () => {
    const ruta = path.join(dir, 'traslado.db');
    const db = abrirBase(ruta);
    aplicarMigraciones(db);
    db.prepare(
      "INSERT INTO ambito (id, nombre, tipo) VALUES ('administrativo', 'Prueba', 'administrativo')"
    ).run();
    sembrarCatalogoBase(db, 'prueba');
    const contabilizado = contabilizarAsiento(db, {
      fechaOperacion: '2026-01-10',
      concepto: 'Asiento base sintético',
      responsable: 'prueba',
      ambitoId: 'administrativo',
      claveIdempotencia: 'base-1',
      lineas: [
        { cuentaId: idCuenta(db, '1101'), debeMinor: '100.00', haberMinor: '' },
        { cuentaId: idCuenta(db, '3101'), debeMinor: '', haberMinor: '100.00' }
      ]
    });
    const borrador = db
      .prepare(
        "INSERT INTO asiento (folio, fecha_operacion, periodo_id, ambito_id, concepto, estado, responsable) VALUES ('B-000001', '2026-01-10', (SELECT id FROM periodo LIMIT 1), 'administrativo', 'borrador sintético', 'borrador', 'prueba')"
      )
      .run();
    const lineaBorrador = db
      .prepare('INSERT INTO asiento_linea (asiento_id, cuenta_id, debe_minor, haber_minor) VALUES (?, ?, ?, ?)')
      .run(Number(borrador.lastInsertRowid), idCuenta(db, '1103'), 30, 0);
    expect(() =>
      db.prepare('UPDATE asiento_linea SET asiento_id = ? WHERE id = ?').run(contabilizado.asientoId, lineaBorrador.lastInsertRowid)
    ).toThrow(/trasladarse/);
    const balance = balanceResumen(db);
    expect(balance.cuadra).toBe(true);
    db.close();
  });
});

describe('ciclo de vida de la conexión en restauración', () => {
  async function contexto(rutaDb: string) {
    const rutas = prepararRutasDatos(path.join(dir, 'datos'));
    return crearContextoBase(rutas, rutaDb, '0.1.0-prueba');
  }

  it('un rechazo previo al cierre conserva la única conexión activa', async () => {
    const rutaDb = path.join(dir, 'activa.db');
    const ctx = await contexto(rutaDb);
    const dbOriginal = ctx.db;
    await expect(manejarRestauracion(ctx, 'respaldo-inexistente.db')).rejects.toThrow();
    expect(ctx.db).toBe(dbOriginal);
    expect(ctx.db.open).toBe(true);
    ctx.db.close();
  });

  it('la restauración exitosa deja una conexión nueva utilizable y registrada', async () => {
    const rutaDb = path.join(dir, 'activa2.db');
    const ctx = await contexto(rutaDb);
    const info = await crearRespaldo(ctx.db, ctx.rutas.respaldos, '0.1.0-prueba');
    const dbOriginal = ctx.db;
    const resultado = await manejarRestauracion(ctx, info.nombre);
    expect(resultado.ok).toBe(true);
    expect(ctx.db).not.toBe(dbOriginal);
    expect(ctx.db.open).toBe(true);
    const evento = ctx.db
      .prepare("SELECT COUNT(*) AS n FROM bitacora_evento WHERE tipo = 'restauracion_completada'")
      .get() as { n: number };
    expect(evento.n).toBe(1);

    const info2 = await crearRespaldo(ctx.db, ctx.rutas.respaldos, '0.1.0-prueba');
    const resultado2 = await manejarRestauracion(ctx, info2.nombre);
    expect(resultado2.ok).toBe(true);
    expect(ctx.db.open).toBe(true);
    ctx.db.close();
  });

  it('un hash alterado rechaza la restauración sin cerrar la conexión activa', async () => {
    const rutaDb = path.join(dir, 'activa3.db');
    const ctx = await contexto(rutaDb);
    const info = await crearRespaldo(ctx.db, ctx.rutas.respaldos, '0.1.0-prueba');
    fs.appendFileSync(path.join(ctx.rutas.respaldos, info.nombre), 'corrupcion');
    const dbOriginal = ctx.db;
    await expect(manejarRestauracion(ctx, info.nombre)).rejects.toThrow();
    expect(ctx.db).toBe(dbOriginal);
    expect(ctx.db.open).toBe(true);
    ctx.db.close();
  });
});

describe('catálogo de respaldos visible', () => {
  it('el listado descubre copias desde el disco, incluso tras restaurar una base sin historial', async () => {
    const rutaDb = path.join(dir, 'activa4.db');
    const ctx = await crearContextoBase(prepararRutasDatos(path.join(dir, 'datos4')), rutaDb, '0.1.0-prueba');
    const info = await crearRespaldo(ctx.db, ctx.rutas.respaldos, '0.1.0-prueba');
    await manejarRestauracion(ctx, info.nombre);
    const lista = descubrirRespaldos(ctx.rutas.respaldos);
    expect(lista.length).toBeGreaterThanOrEqual(1);
    expect(lista.some(r => r.nombre === info.nombre)).toBe(true);

    const rutaLimpia = path.join(dir, 'limpia.db');
    const ctxLimpio = await crearContextoBase(prepararRutasDatos(path.join(dir, 'datos5')), rutaLimpia, '0.1.0-prueba');
    const listaLimpia = descubrirRespaldos(ctxLimpio.rutas.respaldos);
    expect(listaLimpia.some(r => r.nombre === info.nombre)).toBe(false);
    const externa = path.join(ctxLimpio.rutas.respaldos, info.nombre);
    fs.copyFileSync(path.join(ctx.rutas.respaldos, info.nombre), externa);
    fs.copyFileSync(path.join(ctx.rutas.respaldos, `${info.nombre}.manifest.json`), `${externa}.manifest.json`);
    const listaExterna = descubrirRespaldos(ctxLimpio.rutas.respaldos);
    expect(listaExterna.some(r => r.nombre === info.nombre)).toBe(true);
    const resultadoLimpio = await manejarRestauracion(ctxLimpio, info.nombre);
    expect(resultadoLimpio.ok).toBe(true);
    ctx.db.close();
    ctxLimpio.db.close();
  });
});

describe('fecha local de El Salvador', () => {
  it('usa UTC-6 explícito, sin depender de la zona del equipo', async () => {
    expect(fechaLocalElSalvador(new Date('2026-11-04T23:30:00Z'))).toBe('2026-11-04');
    expect(fechaLocalElSalvador(new Date('2026-11-05T02:30:00Z'))).toBe('2026-11-04');
    expect(fechaLocalElSalvador(new Date('2026-11-05T05:59:00Z'))).toBe('2026-11-04');
    expect(fechaLocalElSalvador(new Date('2026-11-05T06:00:00Z'))).toBe('2026-11-05');
  });
});
