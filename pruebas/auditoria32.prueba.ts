import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { abrirBase, prepararRutasDatos } from '../src/main/db/conexion';
import { aplicarMigraciones } from '../src/main/db/aplicarMigraciones';
import { sembrarCatalogoBase } from '../src/main/servicios/cuentas';
import { despachar } from '../src/main/comandos';
import { exportarCsvAuxiliarDetalle, auxiliarContraparteDetalle } from '../src/main/servicios/fiscal';
import { crearContraparte, registrarVenta } from '../src/main/servicios/operacion';
import { registrarCobro } from '../src/main/servicios/tesoreria';
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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arkon-a32-'));
  rutas = prepararRutasDatos(path.join(dir, 'datos'));
  rutaDb = path.join(rutas.datos, 'op.db');
  fs.mkdirSync(rutas.datos, { recursive: true });
  const db = abrir();
  sembrarCatalogoBase(db);
  db.prepare("INSERT INTO ambito (id, nombre, tipo) VALUES ('administrativo', 'Prueba a32', 'administrativo')").run();
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

describe('auditoría 32: exportación de detalle con corte y validación de calendario', () => {
  it('exportarCsvAuxiliarDetalle exporta el mismo corte mostrado, no el resumen actual', () => {
    const ctx = contexto();
    const cliente = crearContraparte(ctx.db, { nombre: 'Cliente Corte A32', esCliente: true, esProveedor: false, responsable: 'p' });
    const venta = registrarVenta(ctx.db, {
      contraparteId: cliente,
      fechaOperacion: '2026-11-01',
      concepto: 'Venta noviembre',
      tipoIngreso: 'instalaciones',
      base: '100.00',
      tasa: '0',
      claveIdempotencia: 'v-a32',
      responsable: 'p'
    });
    registrarCobro(ctx.db, {
      fechaOperacion: '2026-12-05',
      contraparteId: cliente,
      cuentaDestinoId: idCuenta(ctx.db, '1101'),
      monto: '60.00',
      concepto: 'Cobro diciembre',
      aplicaciones: [{ documentoTipo: 'venta', documentoId: venta.id, monto: '60.00' }],
      claveIdempotencia: 'cob-a32',
      responsable: 'p'
    });

    const detalleCorte = auxiliarContraparteDetalle(ctx.db, 'cliente', cliente, '2026-11-30');
    expect(detalleCorte.saldoMinor).toBe('100.00');

    const csv = exportarCsvAuxiliarDetalle(ctx.db, 'cliente', cliente, '2026-11-30');
    expect(csv.version).toBe('auxiliar-detalle-2026-11-30');
    expect(csv.csv).toContain('folio,fecha,concepto,total,aplicado,saldo');
    expect(csv.csv).toContain('V-000001,2026-11-01,Venta noviembre,100.00,0.00,100.00');
    expect(csv.csv).toContain('TOTAL,,,,,100.00');
    expect(csv.csv).not.toContain('60.00');

    const csvActual = exportarCsvAuxiliarDetalle(ctx.db, 'cliente', cliente);
    expect(csvActual.version).toBe('auxiliar-detalle-actual');
    expect(csvActual.csv).toContain('60.00');
    ctx.db.close();
  });

  it('hastaFecha inexistente se rechaza por despachar y por exportación', () => {
    const ctx = contexto();
    const cliente = crearContraparte(ctx.db, { nombre: 'Cliente Fecha A32', esCliente: true, esProveedor: false, responsable: 'p' });
    expect(() =>
      despachar(ctx, 'auxiliar:contraparteDetalle', { tipo: 'cliente', contraparteId: cliente, hastaFecha: '2026-11-31' })
    ).toThrow(/Día inexistente/);
    expect(() => exportarCsvAuxiliarDetalle(ctx.db, 'cliente', cliente, '2027-02-30')).toThrow(/inexistente/);
    expect(() =>
      despachar(ctx, 'auxiliar:contraparteDetalle', { tipo: 'cliente', contraparteId: cliente, hastaFecha: 'no-fecha' })
    ).toThrow(/Formato de fecha/);
    ctx.db.close();
  });
});
