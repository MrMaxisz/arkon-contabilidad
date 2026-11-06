import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { abrirBase, prepararRutasDatos } from '../src/main/db/conexion';
import { aplicarMigraciones } from '../src/main/db/aplicarMigraciones';
import { sembrarCatalogoBase } from '../src/main/servicios/cuentas';
import { despachar } from '../src/main/comandos';
import { registrarApertura, estadoEjercicio, cerrarEjercicio, reabrirEjercicio } from '../src/main/servicios/cierre';
import { mayorDeCuenta } from '../src/main/servicios/motorAsientos';
import { crearContraparte, registrarVenta, registrarCompra } from '../src/main/servicios/operacion';
import type { Database } from 'better-sqlite3';

let dir: string;
let rutaDb: string;
let rutas: ReturnType<typeof prepararRutasDatos>;
const abiertas: Array<Database> = [];

function abrir(): Database {
  const db = abrirBase(rutaDb);
  aplicarMigraciones(db);
  abiertas.push(db);
  return db;
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arkon-a32c-'));
  rutas = prepararRutasDatos(path.join(dir, 'datos'));
  rutaDb = path.join(rutas.datos, 'op.db');
  fs.mkdirSync(rutas.datos, { recursive: true });
  const db = abrir();
  sembrarCatalogoBase(db);
  db.prepare("INSERT INTO ambito (id, nombre, tipo) VALUES ('administrativo', 'Prueba a32c', 'administrativo')").run();
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
    reabrirBase(this: { db: Database }) {
      if (this.db.open) {
        this.db.close();
      }
      this.db = abrirBase(rutaDb);
      aplicarMigraciones(this.db);
    }
  };
}

function idCuenta(db: Database, codigo: string): number {
  return (db.prepare('SELECT id FROM cuenta WHERE codigo = ?').get(codigo) as { id: number }).id;
}

describe('auditoría 32: apertura documentada y cierre de ejercicio', () => {
  it('apertura exige soporte, cuadra y es idempotente; rechazo no deja asientos', () => {
    const ctx = contexto();
    expect(() =>
      registrarApertura(ctx.db, {
        fechaOperacion: '2026-01-01',
        concepto: 'Apertura sintética',
        referencia: '  ',
        lineas: [
          { cuentaCodigo: '1101', debeMinor: '100.00', haberMinor: '' },
          { cuentaCodigo: '3201', debeMinor: '', haberMinor: '100.00' }
        ],
        claveIdempotencia: 'ap-a32',
        responsable: 'p'
      })
    ).toThrow(/referencia de soporte/);

    const apertura = registrarApertura(ctx.db, {
      fechaOperacion: '2026-01-01',
      concepto: 'Apertura sintética',
      referencia: 'soporte apertura sintético',
      lineas: [
        { cuentaCodigo: '1101', debeMinor: '100.00', haberMinor: '' },
        { cuentaCodigo: '3201', debeMinor: '', haberMinor: '100.00' }
      ],
      claveIdempotencia: 'ap-a32',
      responsable: 'p'
    });
    expect(apertura.duplicado).toBe(false);

    const porDespachar = despachar(ctx, 'apertura:registrar', {
      fechaOperacion: '2026-01-01',
      concepto: 'Apertura sintética',
      referencia: 'soporte apertura sintético',
      lineas: [
        { cuentaCodigo: '1101', debeMinor: '100.00', haberMinor: '' },
        { cuentaCodigo: '3201', debeMinor: '', haberMinor: '100.00' }
      ],
      claveIdempotencia: 'ap-a32',
      responsable: 'p'
    }) as { duplicado: boolean; folio: string };
    expect(porDespachar.duplicado).toBe(true);

    const total = ctx.db.prepare("SELECT COUNT(*) AS n FROM asiento WHERE origen_tipo = 'apertura'").get() as { n: number };
    expect(total.n).toBe(1);
    ctx.db.close();
  });

  it('cierre de ejercicio: prevalidación, asiento de resultados, bloqueo y continuidad', () => {
    const ctx = contexto();
    const cliente = crearContraparte(ctx.db, { nombre: 'Cliente Cierre A32', esCliente: true, esProveedor: false, responsable: 'p' });
    registrarVenta(ctx.db, {
      contraparteId: cliente,
      fechaOperacion: '2026-03-10',
      concepto: 'Venta cierre',
      tipoIngreso: 'instalaciones',
      base: '200.00',
      tasa: '0',
      claveIdempotencia: 'v-c32',
      responsable: 'p'
    });
    const proveedor = crearContraparte(ctx.db, { nombre: 'Proveedor Cierre A32', esCliente: false, esProveedor: true, responsable: 'p' });
    registrarCompra(ctx.db, {
      contraparteId: proveedor,
      fechaOperacion: '2026-04-10',
      concepto: 'Compra cierre',
      condicion: 'contado',
      lineas: [{ descripcion: 'Material sintético', cuentaCodigo: '5101', cantidad: '1', precioUnitario: '50.00', tasa: '0', tratamiento: 'exento' }],
      claveIdempotencia: 'c-c32',
      responsable: 'p'
    });

    const estadoAntes = estadoEjercicio(ctx.db, 2026);
    expect(estadoAntes.cierreExistente).toBeNull();
    expect(estadoAntes.resultadoNetoMinor).toBe('150.00');

    const cierre = cerrarEjercicio(ctx.db, {
      anio: 2026,
      responsable: 'p',
      motivo: 'cierre sintético de prueba',
      referencia: 'soporte cierre sintético',
      claveIdempotencia: 'ci-a32'
    });
    expect(cierre.netoMinor).toBe('150.00');

    const estadoDespues = estadoEjercicio(ctx.db, 2026);
    expect(estadoDespues.cierreExistente).not.toBeNull();
    expect(estadoDespues.cuentasResultado).toHaveLength(0);

    const mayorIngreso = mayorDeCuenta(ctx.db, idCuenta(ctx.db, '4101'));
    const saldoIngreso = mayorIngreso.movimientos.reduce((s, m) => s + (m.haberMinor ? -Number(m.haberMinor.replace('.', '')) : 0), 0);
    void saldoIngreso;

    const lineaResultado = ctx.db
      .prepare(
        `SELECT l.debe_minor, l.haber_minor FROM asiento_linea l
         JOIN asiento a ON a.id = l.asiento_id
         WHERE a.origen_tipo = 'cierre' AND l.cuenta_id = ?`
      )
      .get(idCuenta(ctx.db, '3201')) as { debe_minor: number; haber_minor: number };
    expect(lineaResultado.haber_minor - lineaResultado.debe_minor).toBe(15000);

    expect(() =>
      cerrarEjercicio(ctx.db, {
        anio: 2026,
        responsable: 'p',
        motivo: 'segundo cierre',
        referencia: 'soporte dos',
        claveIdempotencia: 'ci-a32-dos'
      })
    ).toThrow(/está cerrado/);

    const duplicado = despachar(ctx, 'cierre:ejercicio', {
      anio: 2026,
      responsable: 'p',
      motivo: 'cierre sintético de prueba',
      referencia: 'soporte cierre sintético',
      claveIdempotencia: 'ci-a32'
    }) as { duplicado: boolean };
    expect(duplicado.duplicado).toBe(true);

    const enero2027 = despachar(ctx, 'cierre:estado', { anio: 2027 }) as ReturnType<typeof estadoEjercicio>;
    expect(enero2027.periodos).toHaveLength(0);

    reabrirEjercicio(ctx.db, { anio: 2026, responsable: 'p', motivo: 'reapertura sintética' });
    const estadoReabierto = estadoEjercicio(ctx.db, 2026);
    expect(estadoReabierto.periodoDiciembreAbierto).toBe(true);
    ctx.db.close();
  });

  it('cierre rechaza ejercicio sin resultados y diciembre cerrado', () => {
    const ctx = contexto();
    expect(() =>
      cerrarEjercicio(ctx.db, {
        anio: 2026,
        responsable: 'p',
        motivo: 'sin movimientos',
        referencia: 'soporte',
        claveIdempotencia: 'ci-vacio'
      })
    ).toThrow(/no tiene movimientos en cuentas de resultados/);

    const cliente = crearContraparte(ctx.db, { nombre: 'Cliente Dic A32', esCliente: true, esProveedor: false, responsable: 'p' });
    registrarVenta(ctx.db, {
      contraparteId: cliente,
      fechaOperacion: '2026-12-10',
      concepto: 'Venta diciembre',
      tipoIngreso: 'instalaciones',
      base: '10.00',
      tasa: '0',
      claveIdempotencia: 'v-dic32',
      responsable: 'p'
    });
    despachar(ctx, 'periodo:cerrar', { periodoId: (ctx.db.prepare("SELECT id FROM periodo WHERE inicio = '2026-12-01'").get() as { id: number }).id, responsable: 'p', motivo: 'cierre mensual sintético' });
    expect(() =>
      cerrarEjercicio(ctx.db, {
        anio: 2026,
        responsable: 'p',
        motivo: 'diciembre cerrado',
        referencia: 'soporte',
        claveIdempotencia: 'ci-dic32'
      })
    ).toThrow(/reábrelo antes de cerrar el ejercicio/);
    ctx.db.close();
  });
});
