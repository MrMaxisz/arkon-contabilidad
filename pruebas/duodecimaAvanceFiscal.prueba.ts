import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { abrirBase } from '../src/main/db/conexion';
import { aplicarMigraciones } from '../src/main/db/aplicarMigraciones';
import { sembrarCatalogoBase } from '../src/main/servicios/cuentas';
import { crearContraparte, registrarVenta, registrarCompra } from '../src/main/servicios/operacion';
import {
  generarCsvLibro,
  politicaAnticipoHechoGenerador,
  VERSION_EXPORTACION_INTERNA,
  ADVERTENCIA_EXPORTACION
} from '../src/main/servicios/fiscal';

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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arkon-rev12-'));
  rutaDb = path.join(dir, 'operativa.db');
  const db = abrir();
  db.prepare(
    "INSERT INTO ambito (id, nombre, tipo) VALUES ('administrativo', 'Prueba rev12', 'administrativo')"
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

describe('duodécima revisión: clasificación documental y exportación interna', () => {
  it('la política del hecho generador de anticipos queda pendiente por defecto', () => {
    const db = abrir();
    expect(politicaAnticipoHechoGenerador(db)).toBe('pendiente');
    db.close();
  });

  it('la exportación bloquea documentos sin clasificación y enumera los folios', () => {
    const db = abrir();
    const cliente = crearContraparte(db, { nombre: 'Cliente AA', esCliente: true, esProveedor: false, responsable: 'p' });
    registrarVenta(db, {
      contraparteId: cliente,
      fechaOperacion: '2026-09-01',
      concepto: 'Venta sin clasificar',
      tipoIngreso: 'instalaciones',
      base: '100.00',
      tasa: '0',
      claveIdempotencia: 'v-aa',
      responsable: 'p'
    });
    expect(() => generarCsvLibro(db, 'venta', '2026-09')).toThrow(/V-000001/);
    db.close();
  });

  it('la exportación interna funciona con documentos clasificados y declara versión y advertencia', () => {
    const db = abrir();
    const cliente = crearContraparte(db, { nombre: 'Cliente BB', esCliente: true, esProveedor: false, responsable: 'p' });
    const proveedor = crearContraparte(db, { nombre: 'Prov BB', esCliente: false, esProveedor: true, responsable: 'p' });
    registrarVenta(db, {
      contraparteId: cliente,
      fechaOperacion: '2026-09-01',
      concepto: 'Venta clasificada',
      tipoIngreso: 'instalaciones',
      base: '200.00',
      tasa: '0',
      clasificacionDocumento: 'contribuyente',
      tipoDocumento: 'ccf',
      claveIdempotencia: 'v-bb',
      responsable: 'p'
    });
    registrarCompra(db, {
      contraparteId: proveedor,
      fechaOperacion: '2026-09-02',
      concepto: 'Compra clasificada',
      condicion: 'credito',
      lineas: [{ descripcion: 'Material', cuentaCodigo: '5101', cantidad: '1', precioUnitario: '50.00', tasa: '0', tratamiento: 'exento' }],
      clasificacionDocumento: 'contribuyente',
      tipoDocumento: 'factura',
      claveIdempotencia: 'c-bb',
      responsable: 'p'
    });
    const exportVentas = generarCsvLibro(db, 'venta', '2026-09');
    expect(exportVentas.version).toBe(VERSION_EXPORTACION_INTERNA);
    expect(exportVentas.advertencia).toBe(ADVERTENCIA_EXPORTACION);
    expect(exportVentas.advertencia).toMatch(/No constituye el formato oficial/);
    expect(exportVentas.csv).toBe('folio,fecha,clasificacion,tipo_documento,base,iva,total\nV-000001,2026-09-01,contribuyente,ccf,200.00,0.00,200.00');
    const exportCompras = generarCsvLibro(db, 'compra', '2026-09');
    expect(exportCompras.csv).toContain('CMP-000001,2026-09-02,contribuyente,factura,50.00,0.00,50.00');
    db.close();
  });

  it('los documentos de otros meses no bloquean la exportación del mes consultado', () => {
    const db = abrir();
    const cliente = crearContraparte(db, { nombre: 'Cliente CC', esCliente: true, esProveedor: false, responsable: 'p' });
    registrarVenta(db, {
      contraparteId: cliente,
      fechaOperacion: '2026-08-01',
      concepto: 'Venta de otro mes sin clasificar',
      tipoIngreso: 'instalaciones',
      base: '10.00',
      tasa: '0',
      claveIdempotencia: 'v-cc',
      responsable: 'p'
    });
    const exportacion = generarCsvLibro(db, 'venta', '2026-09');
    expect(exportacion.csv).toBe('folio,fecha,clasificacion,tipo_documento,base,iva,total');
    db.close();
  });
});
