import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { abrirBase, prepararRutasDatos } from '../src/main/db/conexion';
import { aplicarMigraciones } from '../src/main/db/aplicarMigraciones';
import { sembrarCatalogoBase } from '../src/main/servicios/cuentas';
import { despachar } from '../src/main/comandos';
import { estadoEjercicio, cerrarEjercicio, reabrirEjercicio } from '../src/main/servicios/cierre';
import { mayorDeCuenta, anularAsiento } from '../src/main/servicios/motorAsientos';
import { crearContraparte, registrarVenta, anularDocumento } from '../src/main/servicios/operacion';
import type BetterSqlite3 from 'better-sqlite3';

let dir: string;
let rutaDb: string;
let rutas: ReturnType<typeof prepararRutasDatos>;
const abiertas: Array<BetterSqlite3.Database> = [];

function abrir(): BetterSqlite3.Database {
  const db = abrirBase(rutaDb);
  aplicarMigraciones(db);
  abiertas.push(db);
  return db;
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arkon-a33-'));
  rutas = prepararRutasDatos(path.join(dir, 'datos'));
  rutaDb = path.join(rutas.datos, 'op.db');
  fs.mkdirSync(rutas.datos, { recursive: true });
  const db = abrir();
  sembrarCatalogoBase(db);
  db.prepare("INSERT INTO ambito (id, nombre, tipo) VALUES ('administrativo', 'Prueba a33', 'administrativo')").run();
  db.close();
});

afterEach(() => {
  for (const db of abiertas.splice(0)) {
    if (db.open) {
      db.close();
    }
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

function contexto() {
  const db = abrir();
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

function idCuenta(db: BetterSqlite3.Database, codigo: string): number {
  return (db.prepare('SELECT id FROM cuenta WHERE codigo = ?').get(codigo) as { id: number }).id;
}

function ventaSintetica(db: BetterSqlite3.Database, contraparteId: number, fecha: string, base: string, clave: string) {
  return registrarVenta(db, {
    contraparteId,
    fechaOperacion: fecha,
    concepto: `Venta sintética ${clave}`,
    tipoIngreso: 'instalaciones',
    base,
    tasa: '0',
    claveIdempotencia: clave,
    responsable: 'p'
  });
}

describe('auditoría 33: cierre alineado con mayor, bloqueo de ejercicio y atomicidad', () => {
  it('documentos anulados y reversos concilian con el mayor antes y después del cierre', () => {
    const ctx = contexto();
    const cliente = crearContraparte(ctx.db, { nombre: 'Cliente Anulado A33', esCliente: true, esProveedor: false, responsable: 'p' });
    const anulada = ventaSintetica(ctx.db, cliente, '2026-11-05', '100.00', 'v-an33');
    ventaSintetica(ctx.db, cliente, '2026-11-20', '30.00', 'v-viva33');

    anularDocumento(ctx.db, 'venta', anulada.id, 'p', 'anulación sintética');

    const mayor4101 = mayorDeCuenta(ctx.db, idCuenta(ctx.db, '4101'));
    const estado = estadoEjercicio(ctx.db, 2026);
    expect(estado.resultadoNetoMinor).toBe(mayor4101.saldoMinor.replace('$', '').replace('-', ''));
    expect(mayor4101.saldoMinor).toBe('-30.00');
    expect(estado.resultadoNetoMinor).toBe('30.00');

    const cierre = cerrarEjercicio(ctx.db, {
      anio: 2026,
      responsable: 'p',
      motivo: 'cierre sintético',
      referencia: 'soporte sintético',
      claveIdempotencia: 'ci-a33'
    });
    expect(cierre.netoMinor).toBe('30.00');

    const mayor4101Despues = mayorDeCuenta(ctx.db, idCuenta(ctx.db, '4101'));
    expect(mayor4101Despues.saldoMinor).toBe('0.00');
    const mayor3201 = mayorDeCuenta(ctx.db, idCuenta(ctx.db, '3201'));
    expect(mayor3201.saldoMinor).toBe('-30.00');

    const estadoDespues = estadoEjercicio(ctx.db, 2026);
    expect(estadoDespues.cuentasResultado).toHaveLength(0);
    expect(estadoDespues.ejercicioCerrado).toBe(true);
    ctx.db.close();
  });

  it('el bloqueo de ejercicio rechaza operaciones retroactivas en meses existentes y ausentes', () => {
    const ctx = contexto();
    const cliente = crearContraparte(ctx.db, { nombre: 'Cliente Bloqueo A33', esCliente: true, esProveedor: false, responsable: 'p' });
    const viva = ventaSintetica(ctx.db, cliente, '2026-11-05', '50.00', 'v-b33');

    cerrarEjercicio(ctx.db, {
      anio: 2026,
      responsable: 'p',
      motivo: 'cierre sintético',
      referencia: 'soporte sintético',
      claveIdempotencia: 'ci-b33'
    });

    expect(() => ventaSintetica(ctx.db, cliente, '2026-11-10', '10.00', 'v-retro33')).toThrow(/está cerrado/);
    expect(() => ventaSintetica(ctx.db, cliente, '2026-09-10', '20.00', 'v-retro-sep33')).toThrow(/está cerrado/);
    expect(() =>
      despachar(ctx, 'ajuste:registrar', {
        fechaOperacion: '2026-10-15',
        concepto: 'ajuste retroactivo sintético',
        lineas: [
          { cuentaCodigo: '1101', debeMinor: '5.00', haberMinor: '' },
          { cuentaCodigo: '4101', debeMinor: '', haberMinor: '5.00' }
        ],
        referencia: 'soporte sintético',
        claveIdempotencia: 'aj-retro33',
        responsable: 'p'
      })
    ).toThrow(/está cerrado/);
    expect(() =>
      anularDocumento(ctx.db, 'venta', viva.id, 'p', 'anulación retroactiva')
    ).toThrow(/está cerrado/);

    const ventas = ctx.db.prepare('SELECT COUNT(*) AS n FROM venta').get() as { n: number };
    expect(ventas.n).toBe(1);
    const periodoSeptiembre = ctx.db.prepare("SELECT COUNT(*) AS n FROM periodo WHERE inicio = '2026-09-01'").get() as { n: number };
    expect(periodoSeptiembre.n).toBe(0);

    reabrirEjercicio(ctx.db, { anio: 2026, responsable: 'p', motivo: 'reapertura sintética auditada' });
    const estadoReabierto = estadoEjercicio(ctx.db, 2026);
    expect(estadoReabierto.ejercicioCerrado).toBe(false);
    expect(estadoReabierto.periodoDiciembreAbierto).toBe(true);

    const cierreAsiento = ctx.db
      .prepare("SELECT id FROM asiento WHERE origen_tipo = 'cierre' AND estado = 'contabilizado'")
      .get() as { id: number };
    anularAsiento(ctx.db, cierreAsiento.id, 'p', 'reemplazo autorizado del cierre sintético');

    const estadoSinCierre = estadoEjercicio(ctx.db, 2026);
    expect(estadoSinCierre.cierreExistente).toBeNull();
    expect(estadoSinCierre.resultadoNetoMinor).toBe('50.00');

    ventaSintetica(ctx.db, cliente, '2026-11-25', '10.00', 'v-correccion33');
    const nuevoCierre = cerrarEjercicio(ctx.db, {
      anio: 2026,
      responsable: 'p',
      motivo: 'cierre corregido sintético',
      referencia: 'soporte sintético dos',
      claveIdempotencia: 'ci-b33-dos'
    });
    expect(nuevoCierre.netoMinor).toBe('60.00');
    const mayor3201 = mayorDeCuenta(ctx.db, idCuenta(ctx.db, '3201'));
    expect(mayor3201.saldoMinor).toBe('-60.00');

    const eneroSiguiente = estadoEjercicio(ctx.db, 2027);
    expect(eneroSiguiente.ejercicioCerrado).toBe(false);
    ventaSintetica(ctx.db, cliente, '2027-01-15', '15.00', 'v-2027-33');
    const estado2027 = estadoEjercicio(ctx.db, 2027);
    expect(estado2027.resultadoNetoMinor).toBe('15.00');
    const mayor3201Final = mayorDeCuenta(ctx.db, idCuenta(ctx.db, '3201'));
    expect(mayor3201Final.saldoMinor).toBe('-60.00');
    ctx.db.close();
  });

  it('un fallo después del asiento revierte todo y el reintento completa exactamente una vez', () => {
    const ctx = contexto();
    const cliente = crearContraparte(ctx.db, { nombre: 'Cliente Fallo A33', esCliente: true, esProveedor: false, responsable: 'p' });
    ventaSintetica(ctx.db, cliente, '2026-06-05', '80.00', 'v-f33');

    ctx.db
      .prepare(
        `CREATE TRIGGER fallo_sintetico BEFORE UPDATE OF estado ON periodo
         WHEN NEW.estado = 'cerrado' BEGIN SELECT RAISE(ABORT, 'Fallo sintético al cerrar periodo'); END;`
      )
      .run();

    expect(() =>
      cerrarEjercicio(ctx.db, {
        anio: 2026,
        responsable: 'p',
        motivo: 'cierre con fallo sintético',
        referencia: 'soporte sintético',
        claveIdempotencia: 'ci-f33'
      })
    ).toThrow(/Fallo sintético al cerrar periodo/);

    const asientosCierre = ctx.db.prepare("SELECT COUNT(*) AS n FROM asiento WHERE origen_tipo = 'cierre'").get() as { n: number };
    expect(asientosCierre.n).toBe(0);
    const bloqueos = ctx.db.prepare('SELECT COUNT(*) AS n FROM cierre_ejercicio').get() as { n: number };
    expect(bloqueos.n).toBe(0);
    const diciembreCerrado = ctx.db.prepare("SELECT COUNT(*) AS n FROM periodo WHERE inicio = '2026-12-01' AND estado = 'cerrado'").get() as { n: number };
    expect(diciembreCerrado.n).toBe(0);
    const claves = ctx.db.prepare("SELECT COUNT(*) AS n FROM asiento WHERE clave_idempotencia = 'ci-f33:cierre'").get() as { n: number };
    expect(claves.n).toBe(0);

    ctx.db.prepare('DROP TRIGGER fallo_sintetico').run();

    const reintento = cerrarEjercicio(ctx.db, {
      anio: 2026,
      responsable: 'p',
      motivo: 'cierre reintento sintético',
      referencia: 'soporte sintético',
      claveIdempotencia: 'ci-f33'
    });
    expect(reintento.duplicado).toBe(false);
    expect(reintento.netoMinor).toBe('80.00');
    const asientosTrasReintento = ctx.db.prepare("SELECT COUNT(*) AS n FROM asiento WHERE origen_tipo = 'cierre'").get() as { n: number };
    expect(asientosTrasReintento.n).toBe(1);
    const bloqueo = ctx.db.prepare('SELECT estado FROM cierre_ejercicio WHERE anio = 2026').get() as { estado: string };
    expect(bloqueo.estado).toBe('cerrado');
    ctx.db.close();
  });
});
