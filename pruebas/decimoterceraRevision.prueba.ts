import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { abrirBase } from '../src/main/db/conexion';
import { aplicarMigraciones } from '../src/main/db/aplicarMigraciones';
import { sembrarCatalogoBase } from '../src/main/servicios/cuentas';
import {
  crearContraparte,
  registrarVenta,
  registrarCompra,
  completarClasificacionDocumento,
  saldoPendienteDocumento
} from '../src/main/servicios/operacion';
import { registrarCobro, registrarPago } from '../src/main/servicios/tesoreria';
import { aplicarAnticipo } from '../src/main/servicios/fiscal';
import { generarCsvLibro } from '../src/main/servicios/fiscal';
import { balanceResumen } from '../src/main/servicios/estadosFinancieros';

let dir: string;
let rutaDb: string;
const abiertas: Array<ReturnType<typeof abrirBase>> = [];

function abrir(): ReturnType<typeof abrirBase> {
  const db = abrirBase(rutaDb);
  aplicarMigraciones(db);
  abiertas.push(db);
  return db;
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arkon-rev13-'));
  rutaDb = path.join(dir, 'operativa.db');
  const db = abrir();
  db.prepare(
    "INSERT INTO ambito (id, nombre, tipo) VALUES ('administrativo', 'Prueba rev13', 'administrativo')"
  ).run();
  sembrarCatalogoBase(db, 'prueba');
});

afterEach(() => {
  for (const db of abiertas) {
    if (db.open) {
      db.close();
    }
  }
  abiertas.length = 0;
  fs.rmSync(dir, { recursive: true, force: true });
});

function idCuenta(db: ReturnType<typeof abrir>, codigo: string): number {
  return (db.prepare('SELECT id FROM cuenta WHERE codigo = ?').get(codigo) as { id: number }).id;
}

describe('decimotercera revisión: completar clasificación documental', () => {
  it('un documento nuevo sin clasificar se completa después y el CSV se genera sin tocar saldos', () => {
    const db = abrir();
    const cliente = crearContraparte(db, { nombre: 'Cliente DD', esCliente: true, esProveedor: false, responsable: 'p' });
    const venta = registrarVenta(db, {
      contraparteId: cliente,
      fechaOperacion: '2026-10-01',
      concepto: 'Venta sin clasificar',
      tipoIngreso: 'instalaciones',
      base: '100.00',
      tasa: '0',
      claveIdempotencia: 'v-dd',
      responsable: 'p'
    });
    expect(() => generarCsvLibro(db, 'venta', '2026-10')).toThrow(/V-000001/);
    const balanceAntes = balanceResumen(db);
    completarClasificacionDocumento(db, 'venta', venta.id, {
      clasificacionDocumento: 'contribuyente',
      tipoDocumento: 'ccf',
      responsable: 'p',
      motivo: 'clasificación tardía sintética'
    });
    const balanceDespues = balanceResumen(db);
    expect(balanceDespues.totalActivoMinor).toBe(balanceAntes.totalActivoMinor);
    expect(balanceDespues.cuadra).toBe(true);
    const csv = generarCsvLibro(db, 'venta', '2026-10');
    expect(csv.csv).toContain('V-000001,2026-10-01,contribuyente,ccf,100.00,0.00,100.00');
    const evento = db
      .prepare("SELECT detalle FROM bitacora_evento WHERE tipo = 'clasificacion_completada'")
      .get() as { detalle: string };
    expect(evento.detalle).toContain('"anteriores":{"clasificacion":null,"tipo":null}');
    expect(evento.detalle).toContain('"motivo":"clasificación tardía sintética"');
    db.close();
  });

  it('un documento con cobro aplicado conserva sus aplicaciones al clasificarse', () => {
    const db = abrir();
    const cliente = crearContraparte(db, { nombre: 'Cliente EE', esCliente: true, esProveedor: false, responsable: 'p' });
    const venta = registrarVenta(db, {
      contraparteId: cliente,
      fechaOperacion: '2026-10-01',
      concepto: 'Venta cobrada sin clasificar',
      tipoIngreso: 'instalaciones',
      base: '80.00',
      tasa: '0',
      claveIdempotencia: 'v-ee',
      responsable: 'p'
    });
    registrarCobro(db, {
      fechaOperacion: '2026-10-02',
      contraparteId: cliente,
      cuentaDestinoId: idCuenta(db, '1101'),
      monto: '80.00',
      concepto: 'Cobro total',
      aplicaciones: [{ documentoTipo: 'venta', documentoId: venta.id, monto: '80.00' }],
      claveIdempotencia: 'cob-ee',
      responsable: 'p'
    });
    const claveOriginal = (db.prepare('SELECT clave_idempotencia FROM venta WHERE id = ?').get(venta.id) as { clave_idempotencia: string }).clave_idempotencia;
    completarClasificacionDocumento(db, 'venta', venta.id, {
      clasificacionDocumento: 'consumidor_final',
      tipoDocumento: 'factura',
      responsable: 'p',
      motivo: 'clasificación tardía sobre documento cobrado'
    });
    expect(saldoPendienteDocumento(db, 'venta', venta.id)).toBe(0n);
    const fila = db.prepare('SELECT clave_idempotencia, total_minor, asiento_id FROM venta WHERE id = ?').get(venta.id) as { clave_idempotencia: string; total_minor: number; asiento_id: number };
    expect(fila.clave_idempotencia).toBe(claveOriginal);
    expect(fila.total_minor).toBe(8000);
    const duplicado = registrarVenta(db, {
      contraparteId: cliente,
      fechaOperacion: '2026-10-01',
      concepto: 'Venta cobrada sin clasificar',
      tipoIngreso: 'instalaciones',
      base: '80.00',
      tasa: '0',
      claveIdempotencia: 'v-ee',
      responsable: 'p'
    });
    expect(duplicado.duplicado).toBe(true);
    const csv = generarCsvLibro(db, 'venta', '2026-10');
    expect(csv.csv).toContain('consumidor_final,factura');
    db.close();
  });

  it('documentos con anticipo aplicado y pagos aplicados se clasifican sin perder nada', () => {
    const db = abrir();
    const cliente = crearContraparte(db, { nombre: 'Cliente FF', esCliente: true, esProveedor: false, responsable: 'p' });
    const proveedor = crearContraparte(db, { nombre: 'Prov FF', esCliente: false, esProveedor: true, responsable: 'p' });
    const venta = registrarVenta(db, {
      contraparteId: cliente,
      fechaOperacion: '2026-10-01',
      concepto: 'Venta con anticipo',
      tipoIngreso: 'instalaciones',
      base: '60.00',
      tasa: '0',
      claveIdempotencia: 'v-ff',
      responsable: 'p'
    });
    registrarCobro(db, {
      fechaOperacion: '2026-10-02',
      contraparteId: cliente,
      cuentaDestinoId: idCuenta(db, '1101'),
      monto: '90.00',
      concepto: 'Cobro con excedente',
      aplicaciones: [{ documentoTipo: 'venta', documentoId: venta.id, monto: '60.00' }],
      claveIdempotencia: 'cob-ff',
      responsable: 'p'
    });
    const venta2 = registrarVenta(db, {
      contraparteId: cliente,
      fechaOperacion: '2026-10-05',
      concepto: 'Segunda venta',
      tipoIngreso: 'oym',
      base: '30.00',
      tasa: '0',
      claveIdempotencia: 'v-ff2',
      responsable: 'p'
    });
    aplicarAnticipo(db, {
      tipo: 'cliente',
      contraparteId: cliente,
      documentoTipo: 'venta',
      documentoId: venta2.id,
      fechaOperacion: '2026-10-06',
      monto: '30.00',
      claveIdempotencia: 'aap-ff',
      responsable: 'p'
    });
    const compra = registrarCompra(db, {
      contraparteId: proveedor,
      fechaOperacion: '2026-10-03',
      concepto: 'Compra pagada sin clasificar',
      condicion: 'credito',
      lineas: [{ descripcion: 'Material', cuentaCodigo: '5101', cantidad: '1', precioUnitario: '40.00', tasa: '0', tratamiento: 'exento' }],
      claveIdempotencia: 'c-ff',
      responsable: 'p'
    });
    registrarPago(db, {
      fechaOperacion: '2026-10-04',
      contraparteId: proveedor,
      cuentaOrigenId: idCuenta(db, '1101'),
      monto: '40.00',
      concepto: 'Pago total',
      aplicaciones: [{ documentoTipo: 'compra', documentoId: compra.id, monto: '40.00' }],
      claveIdempotencia: 'pag-ff',
      responsable: 'p'
    });
    completarClasificacionDocumento(db, 'venta', venta.id, { clasificacionDocumento: 'contribuyente', tipoDocumento: 'ccf', responsable: 'p', motivo: 'síntesis' });
    completarClasificacionDocumento(db, 'venta', venta2.id, { clasificacionDocumento: 'contribuyente', tipoDocumento: 'factura', responsable: 'p', motivo: 'síntesis' });
    completarClasificacionDocumento(db, 'compra', compra.id, { clasificacionDocumento: 'contribuyente', tipoDocumento: 'factura', responsable: 'p', motivo: 'síntesis' });
    expect(saldoPendienteDocumento(db, 'venta', venta.id)).toBe(0n);
    expect(saldoPendienteDocumento(db, 'venta', venta2.id)).toBe(0n);
    expect(saldoPendienteDocumento(db, 'compra', compra.id)).toBe(0n);
    expect(balanceResumen(db).cuadra).toBe(true);
    expect(() => generarCsvLibro(db, 'venta', '2026-10')).not.toThrow();
    expect(() => generarCsvLibro(db, 'compra', '2026-10')).not.toThrow();
    db.close();
  });

  it('la acción exige responsable y motivo, y rechaza documentos anulados', () => {
    const db = abrir();
    const cliente = crearContraparte(db, { nombre: 'Cliente GG', esCliente: true, esProveedor: false, responsable: 'p' });
    const venta = registrarVenta(db, {
      contraparteId: cliente,
      fechaOperacion: '2026-10-01',
      concepto: 'Venta GG',
      tipoIngreso: 'instalaciones',
      base: '10.00',
      tasa: '0',
      claveIdempotencia: 'v-gg',
      responsable: 'p'
    });
    expect(() =>
      completarClasificacionDocumento(db, 'venta', venta.id, { clasificacionDocumento: 'otro', tipoDocumento: 'otro', responsable: '', motivo: 'm' })
    ).toThrow(/responsable/);
    expect(() =>
      completarClasificacionDocumento(db, 'venta', venta.id, { clasificacionDocumento: 'otro', tipoDocumento: 'otro', responsable: 'p', motivo: '' })
    ).toThrow(/motivo/);
    db.prepare("UPDATE venta SET estado = 'anulada' WHERE id = ?").run(venta.id);
    expect(() =>
      completarClasificacionDocumento(db, 'venta', venta.id, { clasificacionDocumento: 'otro', tipoDocumento: 'otro', responsable: 'p', motivo: 'm' })
    ).toThrow(/registrados/);
    db.close();
  });
});
