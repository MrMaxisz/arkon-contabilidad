import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { abrirBase, prepararRutasDatos } from '../src/main/db/conexion';
import { aplicarMigraciones } from '../src/main/db/aplicarMigraciones';
import { sembrarCatalogoBase } from '../src/main/servicios/cuentas';
import { generarPaqueteContador } from '../src/main/servicios/paqueteContador';
import { estadoResultados } from '../src/main/servicios/fiscal';
import { cerrarEjercicio, reabrirEjercicio } from '../src/main/servicios/cierre';
import { anularAsiento } from '../src/main/servicios/motorAsientos';
import { crearContraparte, registrarVenta, registrarCompra, anularDocumento } from '../src/main/servicios/operacion';
import type BetterSqlite3 from 'better-sqlite3';

// Auditoría 61: el asiento de cierre NO falsea el estado de resultados.
// Criterio único de familia de cierre compartido con ejercicioAnual.ts.

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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arkon-a61-'));
  rutas = prepararRutasDatos(path.join(dir, 'datos'));
  rutaDb = path.join(rutas.datos, 'op.db');
  fs.mkdirSync(rutas.datos, { recursive: true });
  const db = abrir();
  sembrarCatalogoBase(db);
  db.prepare("INSERT INTO ambito (id, nombre, tipo) VALUES ('administrativo', 'Prueba a61', 'administrativo')").run();
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

function sembrarBase(db: BetterSqlite3.Database): { cliente: number; proveedor: number } {
  const cliente = crearContraparte(db, { nombre: 'Cliente A61', esCliente: true, esProveedor: false, responsable: 'p' });
  const proveedor = crearContraparte(db, { nombre: 'Proveedor A61', esCliente: false, esProveedor: true, responsable: 'p' });
  registrarVenta(db, {
    contraparteId: cliente, fechaOperacion: '2026-11-10', concepto: 'Venta sintética a61',
    tipoIngreso: 'instalaciones', base: '100.00', tasa: '0', claveIdempotencia: 'v-a61', responsable: 'p'
  });
  registrarCompra(db, {
    contraparteId: proveedor, fechaOperacion: '2026-11-11', concepto: 'Compra sintética a61',
    condicion: 'contado',
    lineas: [{ descripcion: 'Material', cuentaCodigo: '5101', cantidad: '1', precioUnitario: '40.00', tasa: '0', tratamiento: 'exento' }],
    claveIdempotencia: 'c-a61', responsable: 'p'
  });
  return { cliente, proveedor };
}

function cerrarYRecerrar(db: BetterSqlite3.Database): void {
  cerrarEjercicio(db, { anio: 2026, responsable: 'p', motivo: 'cierre sintético a61', referencia: 'soporte a61', claveIdempotencia: 'ci-a61-1' });
  reabrirEjercicio(db, { anio: 2026, responsable: 'p', motivo: 'reapertura sintética a61' });
  const cierre = db
    .prepare("SELECT id FROM asiento WHERE origen_tipo = 'cierre' AND estado = 'contabilizado' AND fecha_operacion LIKE '2026%'")
    .get() as { id: number };
  anularAsiento(db, cierre.id, 'p', 'anulación del cierre sintético a61');
  cerrarEjercicio(db, { anio: 2026, responsable: 'p', motivo: 'recierre sintético a61', referencia: 'soporte a61 dos', claveIdempotencia: 'ci-a61-2' });
}

function lineaTotal(estadoResultadosCsv: string): string {
  const total = estadoResultadosCsv.split('\n').find(l => l.includes('TOTAL'));
  expect(total).toBeTruthy();
  return total!;
}

describe('auditoría 61: estado de resultados sin la familia de cierre', () => {
  it('tras cierre, anulación y recierre: 4101 100.00, 5101 -40.00, TOTAL 60.00, igual a TOTAL_ORDINARIO_ANUAL y al paquete previo al cierre', () => {
    const db = abrir();
    sembrarBase(db);
    const paqueteAntes = generarPaqueteContador(db, '2026-01-01', '2026-12-31');
    const csvAntes = paqueteAntes.archivos.find(a => a.nombre === 'estado-resultados.csv')!.contenido;
    expect(csvAntes).toMatch(/,4101,[^,]+,ingreso,100\.00/);
    expect(csvAntes).toMatch(/,5101,[^,]+,costo,-40\.00/);
    expect(lineaTotal(csvAntes)).toBe('2026-01-01,2026-12-31,TOTAL,,,60.00');

    cerrarYRecerrar(db);

    const paquete = generarPaqueteContador(db, '2026-01-01', '2026-12-31');
    const csv = paquete.archivos.find(a => a.nombre === 'estado-resultados.csv')!.contenido;
    expect(csv).toMatch(/,4101,[^,]+,ingreso,100\.00/);
    expect(csv).toMatch(/,5101,[^,]+,costo,-40\.00/);
    expect(lineaTotal(csv)).toBe('2026-01-01,2026-12-31,TOTAL,,,60.00');
    const anual = paquete.archivos.find(a => a.nombre === 'ejercicio-anual.csv')!.contenido;
    expect(anual).toContain('TOTAL_ORDINARIO_ANUAL,,,60.00');
    expect(csv).toBe(csvAntes);
  });

  it('pantalla 2026-12 sin operaciones: 0.00 en ingresos, costos y resultado; noviembre 100/40/60', () => {
    const db = abrir();
    sembrarBase(db);
    cerrarYRecerrar(db);
    const diciembre = estadoResultados(db, '2026-12');
    expect(diciembre.ingresosMinor).toBe('0.00');
    expect(diciembre.costosGastosMinor).toBe('0.00');
    expect(diciembre.resultadoMinor).toBe('0.00');
    const noviembre = estadoResultados(db, '2026-11');
    expect(noviembre.ingresosMinor).toBe('100.00');
    expect(noviembre.costosGastosMinor).toBe('40.00');
    expect(noviembre.resultadoMinor).toBe('60.00');
  });

  it('con ventas reales en diciembre y cierre: solo esas ventas en diciembre', () => {
    const db = abrir();
    const { cliente } = sembrarBase(db);
    registrarVenta(db, {
      contraparteId: cliente, fechaOperacion: '2026-12-05', concepto: 'Venta diciembre a61',
      tipoIngreso: 'instalaciones', base: '25.00', tasa: '0', claveIdempotencia: 'v-a61-d', responsable: 'p'
    });
    cerrarYRecerrar(db);
    const diciembre = estadoResultados(db, '2026-12');
    expect(diciembre.ingresosMinor).toBe('25.00');
    expect(diciembre.costosGastosMinor).toBe('0.00');
    expect(diciembre.resultadoMinor).toBe('25.00');
  });

  it('venta anulada: neta cero, sin excluirse como familia de cierre', () => {
    const db = abrir();
    const { cliente } = sembrarBase(db);
    registrarVenta(db, {
      contraparteId: cliente, fechaOperacion: '2026-11-20', concepto: 'Venta anulada a61',
      tipoIngreso: 'instalaciones', base: '50.00', tasa: '0', claveIdempotencia: 'v-a61-x', responsable: 'p'
    });
    const ventaId = (db.prepare("SELECT id FROM venta WHERE concepto = 'Venta anulada a61'").get() as { id: number }).id;
    anularDocumento(db, 'venta', ventaId, 'p', 'anulación sintética de venta a61');
    const noviembre = estadoResultados(db, '2026-11');
    expect(noviembre.ingresosMinor).toBe('100.00');
    const paquete = generarPaqueteContador(db, '2026-01-01', '2026-12-31');
    const csv = paquete.archivos.find(a => a.nombre === 'estado-resultados.csv')!.contenido;
    expect(lineaTotal(csv)).toBe('2026-01-01,2026-12-31,TOTAL,,,60.00');
  });

  it('rango parcial que incluye el 31 de diciembre: mismo criterio', () => {
    const db = abrir();
    sembrarBase(db);
    cerrarYRecerrar(db);
    const paquete = generarPaqueteContador(db, '2026-07-01', '2026-12-31');
    const csv = paquete.archivos.find(a => a.nombre === 'estado-resultados.csv')!.contenido;
    expect(csv).toMatch(/,4101,[^,]+,ingreso,100\.00/);
    expect(csv).toMatch(/,5101,[^,]+,costo,-40\.00/);
    expect(lineaTotal(csv)).toBe('2026-07-01,2026-12-31,TOTAL,,,60.00');
  });

  it('balance y conciliaciones sin cambios; resultado-trasladado-por-cierre y estado vs anual presentes', () => {
    const db = abrir();
    sembrarBase(db);
    cerrarYRecerrar(db);
    const paquete = generarPaqueteContador(db, '2026-01-01', '2026-12-31');
    expect(paquete.conciliaciones.balanceCuadra).toBe(true);
    expect(paquete.conciliaciones.clientesMayor).toBe(true);
    expect(paquete.conciliaciones.proveedoresMayor).toBe(true);
    expect(paquete.conciliaciones.efectivoMayor).toBe(true);
    expect(paquete.conciliaciones.estadoResultadosVsAnual).toBe(true);
    const conc = paquete.archivos.find(a => a.nombre === 'conciliaciones.csv')!.contenido;
    expect(conc).toContain('resultado-trasladado-por-cierre,60.00');
    expect(conc).toContain('estado-resultados-vs-ejercicio-anual,ok');
    expect(conc).toContain('balance-activo-pasivo-patrimonio-resultado,cuadra');
    const leeme = paquete.archivos.find(a => a.nombre === 'LEEME.txt')!.contenido;
    expect(leeme).toContain('EXCLUYEN la familia de cierre');
  });
});
