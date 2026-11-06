import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { abrirBase, prepararRutasDatos } from '../src/main/db/conexion';
import { aplicarMigraciones } from '../src/main/db/aplicarMigraciones';
import { sembrarCatalogoBase } from '../src/main/servicios/cuentas';
import { despachar } from '../src/main/comandos';
import { crearContraparte, registrarCompra, registrarVenta } from '../src/main/servicios/operacion';
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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arkon-a31-'));
  rutas = prepararRutasDatos(path.join(dir, 'datos'));
  rutaDb = path.join(rutas.datos, 'op.db');
  fs.mkdirSync(rutas.datos, { recursive: true });
  const db = abrir();
  sembrarCatalogoBase(db);
  db.prepare("INSERT INTO ambito (id, nombre, tipo) VALUES ('administrativo', 'Prueba a31', 'administrativo')").run();
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
  const fila = db.prepare('SELECT id FROM cuenta WHERE codigo = ?').get(codigo) as { id: number };
  return fila.id;
}

describe('auditoría 31: referencia opcional en tesorería, obligatoria en ajustes', () => {
  it('cobro, pago y transferencia sin referencia se registran por despachar real', () => {
    const ctx = contexto();
    const cliente = crearContraparte(ctx.db, { nombre: 'Cliente Sintético A31', esCliente: true, esProveedor: false, responsable: 'p' });
    const proveedor = crearContraparte(ctx.db, { nombre: 'Proveedor Sintético A31', esCliente: false, esProveedor: true, responsable: 'p' });
    const venta = registrarVenta(ctx.db, {
      contraparteId: cliente,
      fechaOperacion: '2026-12-01',
      concepto: 'Venta sintética',
      tipoIngreso: 'instalaciones',
      base: '100.00',
      tasa: '0',
      claveIdempotencia: 'v-a31',
      responsable: 'p'
    });
    const compra = registrarCompra(ctx.db, {
      contraparteId: proveedor,
      fechaOperacion: '2026-12-01',
      concepto: 'Compra sintética',
      condicion: 'credito',
      lineas: [{ descripcion: 'Material sintético', cuentaCodigo: '5101', cantidad: '1', precioUnitario: '50.00', tasa: '0', tratamiento: 'exento' }],
      claveIdempotencia: 'c-a31',
      responsable: 'p'
    });

    const cobro = despachar(ctx, 'cobro:registrar', {
      fechaOperacion: '2026-12-02',
      contraparteId: cliente,
      cuentaDestinoId: idCuenta(ctx.db, '1101'),
      monto: '60.00',
      concepto: 'Cobro sin referencia',
      aplicaciones: [{ documentoTipo: 'venta', documentoId: venta.id, monto: '60.00' }],
      claveIdempotencia: 'cob-a31',
      responsable: 'p'
    }) as { id: number };
    expect(cobro.id).toBeGreaterThan(0);

    const pago = despachar(ctx, 'pago:registrar', {
      fechaOperacion: '2026-12-02',
      contraparteId: proveedor,
      cuentaOrigenId: idCuenta(ctx.db, '1101'),
      monto: '50.00',
      concepto: 'Pago sin referencia',
      aplicaciones: [{ documentoTipo: 'compra', documentoId: compra.id, monto: '50.00' }],
      claveIdempotencia: 'pag-a31',
      responsable: 'p'
    }) as { id: number };
    expect(pago.id).toBeGreaterThan(0);

    const transferencia = despachar(ctx, 'transferencia:registrar', {
      fechaOperacion: '2026-12-02',
      cuentaOrigenId: idCuenta(ctx.db, '1101'),
      cuentaDestinoId: idCuenta(ctx.db, '1102'),
      monto: '10.00',
      concepto: 'Transferencia sin referencia',
      claveIdempotencia: 'tra-a31',
      responsable: 'p'
    }) as { id: number };
    expect(transferencia.id).toBeGreaterThan(0);
    ctx.db.close();
  });

  it('ajuste sin referencia se rechaza por despachar real', () => {
    const ctx = contexto();
    expect(() =>
      despachar(ctx, 'ajuste:registrar', {
        fechaOperacion: '2026-12-02',
        concepto: 'Ajuste sintético sin soporte',
        lineas: [
          { cuentaCodigo: '1101', debeMinor: '10.00', haberMinor: '' },
          { cuentaCodigo: '3101', debeMinor: '', haberMinor: '10.00' }
        ],
        claveIdempotencia: 'aj-a31-sin-ref',
        responsable: 'p'
      })
    ).toThrow();
    const asientos = ctx.db.prepare("SELECT COUNT(*) AS n FROM asiento WHERE concepto = 'Ajuste sintético sin soporte'").get() as { n: number };
    expect(asientos.n).toBe(0);
    ctx.db.close();
  });
});
