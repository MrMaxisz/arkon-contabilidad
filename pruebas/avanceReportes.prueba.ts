import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { abrirBase } from '../src/main/db/conexion';
import { aplicarMigraciones } from '../src/main/db/aplicarMigraciones';
import { sembrarCatalogoBase } from '../src/main/servicios/cuentas';
import { crearContraparte, crearProyecto, registrarVenta, registrarCompra } from '../src/main/servicios/operacion';
import { guardarCsvArchivo, estadoResultados, rentabilidadProyectos, generarCsvLibro } from '../src/main/servicios/fiscal';

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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arkon-rev17-'));
  rutaDb = path.join(dir, 'operativa.db');
  const db = abrir();
  db.prepare(
    "INSERT INTO ambito (id, nombre, tipo) VALUES ('administrativo', 'Prueba rev17', 'administrativo')"
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

describe('avance tras la decimoséptima revisión', () => {
  it('guardarCsvArchivo escribe el CSV con la advertencia como texto interno', () => {
    const db = abrir();
    const cliente = crearContraparte(db, { nombre: 'Cliente MM', esCliente: true, esProveedor: false, responsable: 'p' });
    registrarVenta(db, {
      contraparteId: cliente,
      fechaOperacion: '2026-11-01',
      concepto: 'Venta clasificada',
      tipoIngreso: 'instalaciones',
      base: '50.00',
      tasa: '0',
      clasificacionDocumento: 'contribuyente',
      tipoDocumento: 'factura',
      claveIdempotencia: 'v-mm',
      responsable: 'p'
    });
    const csv = generarCsvLibro(db, 'venta', '2026-11');
    const ruta = path.join(dir, 'salida.csv');
    guardarCsvArchivo(ruta, csv.csv);
    const contenido = fs.readFileSync(ruta, 'utf8');
    expect(contenido).toContain('folio,fecha,clasificacion,tipo_documento,base,iva,total');
    expect(contenido).toContain('V-000001,2026-11-01,contribuyente,factura,50.00,0.00,50.00');
    expect(() => guardarCsvArchivo(path.join(dir, 'salida.txt'), csv.csv)).toThrow(/\.csv/);
    db.close();
  });

  it('el estado de resultados mensual explica el resultado desde el mayor', () => {
    const db = abrir();
    const cliente = crearContraparte(db, { nombre: 'Cliente NN', esCliente: true, esProveedor: false, responsable: 'p' });
    const proveedor = crearContraparte(db, { nombre: 'Prov NN', esCliente: false, esProveedor: true, responsable: 'p' });
    registrarVenta(db, {
      contraparteId: cliente,
      fechaOperacion: '2026-11-05',
      concepto: 'Venta uno',
      tipoIngreso: 'instalaciones',
      base: '200.00',
      tasa: '0',
      claveIdempotencia: 'v-nn1',
      responsable: 'p'
    });
    registrarVenta(db, {
      contraparteId: cliente,
      fechaOperacion: '2026-11-20',
      concepto: 'Venta dos',
      tipoIngreso: 'oym',
      base: '100.00',
      tasa: '0',
      claveIdempotencia: 'v-nn2',
      responsable: 'p'
    });
    registrarCompra(db, {
      contraparteId: proveedor,
      fechaOperacion: '2026-11-10',
      concepto: 'Compra de materiales',
      condicion: 'credito',
      lineas: [{ descripcion: 'Material', cuentaCodigo: '5101', cantidad: '1', precioUnitario: '80.00', tasa: '0', tratamiento: 'exento' }],
      claveIdempotencia: 'c-nn1',
      responsable: 'p'
    });
    const estado = estadoResultados(db, '2026-11');
    expect(estado.ingresosMinor).toBe('300.00');
    expect(estado.costosGastosMinor).toBe('80.00');
    expect(estado.resultadoMinor).toBe('220.00');
    expect(estado.filas.map(f => f.codigo)).toEqual(['4101', '4102', '5101']);
    const estadoOtroMes = estadoResultados(db, '2026-10');
    expect(estadoOtroMes.resultadoMinor).toBe('0.00');
    expect(estadoOtroMes.filas).toHaveLength(0);
    db.close();
  });

  it('la rentabilidad por proyecto es provisional con compras sin proyecto asignado', () => {
    const db = abrir();
    const cliente = crearContraparte(db, { nombre: 'Cliente OO', esCliente: true, esProveedor: false, responsable: 'p' });
    const proveedor = crearContraparte(db, { nombre: 'Prov OO', esCliente: false, esProveedor: true, responsable: 'p' });
    const proyecto = crearProyecto(db, {
      codigo: 'PRJ-010',
      nombre: 'Proyecto rentable sintético',
      contraparteId: cliente,
      responsable: 'p'
    });
    registrarVenta(db, {
      contraparteId: cliente,
      proyectoId: proyecto,
      fechaOperacion: '2026-11-05',
      concepto: 'Venta del proyecto',
      tipoIngreso: 'instalaciones',
      base: '500.00',
      tasa: '0',
      claveIdempotencia: 'v-oo',
      responsable: 'p'
    });
    registrarCompra(db, {
      contraparteId: proveedor,
      proyectoId: proyecto,
      fechaOperacion: '2026-11-06',
      concepto: 'Compra del proyecto',
      condicion: 'credito',
      lineas: [{ descripcion: 'Material', cuentaCodigo: '5101', cantidad: '1', precioUnitario: '150.00', tasa: '0', tratamiento: 'exento' }],
      claveIdempotencia: 'c-oo1',
      responsable: 'p'
    });
    registrarCompra(db, {
      contraparteId: proveedor,
      fechaOperacion: '2026-11-07',
      concepto: 'Compra sin proyecto',
      condicion: 'credito',
      lineas: [{ descripcion: 'Material', cuentaCodigo: '5101', cantidad: '1', precioUnitario: '30.00', tasa: '0', tratamiento: 'exento' }],
      claveIdempotencia: 'c-oo2',
      responsable: 'p'
    });
    const rentabilidad = rentabilidadProyectos(db);
    expect(rentabilidad.provisional).toBe(true);
    expect(rentabilidad.nota).toMatch(/provisional/);
    expect(rentabilidad.proyectos).toHaveLength(1);
    const fila = rentabilidad.proyectos[0];
    expect(fila?.codigo).toBe('PRJ-010');
    expect(fila?.ingresoMinor).toBe('500.00');
    expect(fila?.costoMinor).toBe('150.00');
    expect(fila?.margenMinor).toBe('350.00');
    db.prepare("UPDATE compra SET estado = 'anulada' WHERE clave_idempotencia = 'c-oo2'").run();
    const rentabilidadSinPendientes = rentabilidadProyectos(db);
    expect(rentabilidadSinPendientes.provisional).toBe(false);
    db.close();
  });
});
