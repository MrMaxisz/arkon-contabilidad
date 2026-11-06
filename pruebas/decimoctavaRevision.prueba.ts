import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { abrirBase } from '../src/main/db/conexion';
import { aplicarMigraciones } from '../src/main/db/aplicarMigraciones';
import { sembrarCatalogoBase } from '../src/main/servicios/cuentas';
import { crearContraparte, crearProyecto, registrarVenta, registrarCompra, anularDocumento } from '../src/main/servicios/operacion';
import { rentabilidadProyectos, estadoResultados, guardarExportacionArchivo } from '../src/main/servicios/fiscal';

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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arkon-rev18-'));
  rutaDb = path.join(dir, 'operativa.db');
  const db = abrir();
  db.prepare(
    "INSERT INTO ambito (id, nombre, tipo) VALUES ('administrativo', 'Prueba rev18', 'administrativo')"
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

describe('decimoctava revisión: rentabilidad coherente con el mayor', () => {
  it('con IVA acreditable e IVA de venta, el margen coincide con el estado de resultados del mayor', () => {
    const db = abrir();
    db.prepare("UPDATE configuracion SET valor = '1' WHERE clave = 'perfil_iva_inscrito'").run();
    db.prepare("UPDATE configuracion SET valor = '1' WHERE clave = 'iva_compras_credito_fiscal'").run();
    const cliente = crearContraparte(db, { nombre: 'Cliente PP', esCliente: true, esProveedor: false, responsable: 'p' });
    const proveedor = crearContraparte(db, { nombre: 'Prov PP', esCliente: false, esProveedor: true, responsable: 'p' });
    const proyecto = crearProyecto(db, { codigo: 'PRJ-020', nombre: 'Proyecto con IVA sintético', contraparteId: cliente, responsable: 'p' });
    registrarVenta(db, {
      contraparteId: cliente,
      proyectoId: proyecto,
      fechaOperacion: '2026-11-05',
      concepto: 'Venta con IVA',
      tipoIngreso: 'instalaciones',
      base: '100.00',
      tasa: '13',
      claveIdempotencia: 'v-pp',
      responsable: 'p'
    });
    registrarCompra(db, {
      contraparteId: proveedor,
      proyectoId: proyecto,
      fechaOperacion: '2026-11-06',
      concepto: 'Compra con IVA acreditable',
      condicion: 'credito',
      lineas: [{ descripcion: 'Material', cuentaCodigo: '5101', cantidad: '1', precioUnitario: '50.00', tasa: '13', tratamiento: 'gravado', precioConIva: false }],
      claveIdempotencia: 'c-pp',
      responsable: 'p'
    });
    const rentabilidad = rentabilidadProyectos(db);
    const fila = rentabilidad.proyectos[0];
    expect(fila?.ingresoMinor).toBe('100.00');
    expect(fila?.costoMinor).toBe('50.00');
    expect(fila?.margenMinor).toBe('50.00');
    expect(fila?.totalDocumentalVentaMinor).toBe('113.00');
    expect(fila?.totalDocumentalCompraMinor).toBe('56.50');
    expect(rentabilidad.provisional).toBe(false);
    const estado = estadoResultados(db, '2026-11');
    expect(estado.ingresosMinor).toBe('100.00');
    expect(estado.costosGastosMinor).toBe('50.00');
    expect(estado.resultadoMinor).toBe(fila?.margenMinor);
    db.close();
  });

  it('una compra de activo vinculada al proyecto no es costo; el margen coincide con el mayor', () => {
    const db = abrir();
    const cliente = crearContraparte(db, { nombre: 'Cliente QQ', esCliente: true, esProveedor: false, responsable: 'p' });
    const proveedor = crearContraparte(db, { nombre: 'Prov QQ', esCliente: false, esProveedor: true, responsable: 'p' });
    const proyecto = crearProyecto(db, { codigo: 'PRJ-021', nombre: 'Proyecto con equipo sintético', contraparteId: cliente, responsable: 'p' });
    registrarVenta(db, {
      contraparteId: cliente,
      proyectoId: proyecto,
      fechaOperacion: '2026-11-05',
      concepto: 'Venta sin IVA',
      tipoIngreso: 'instalaciones',
      base: '100.00',
      tasa: '0',
      claveIdempotencia: 'v-qq',
      responsable: 'p'
    });
    registrarCompra(db, {
      contraparteId: proveedor,
      proyectoId: proyecto,
      fechaOperacion: '2026-11-06',
      concepto: 'Compra de equipo',
      condicion: 'credito',
      lineas: [{ descripcion: 'Equipo', cuentaCodigo: '1501', cantidad: '1', precioUnitario: '40.00', tasa: '0', tratamiento: 'exento' }],
      claveIdempotencia: 'c-qq',
      responsable: 'p'
    });
    const rentabilidad = rentabilidadProyectos(db);
    const fila = rentabilidad.proyectos[0];
    expect(fila?.ingresoMinor).toBe('100.00');
    expect(fila?.costoMinor).toBe('0.00');
    expect(fila?.margenMinor).toBe('100.00');
    expect(fila?.totalDocumentalCompraMinor).toBe('40.00');
    expect(rentabilidad.provisional).toBe(false);
    const estado = estadoResultados(db, '2026-11');
    expect(estado.resultadoMinor).toBe('100.00');
    db.close();
  });

  it('las anulaciones excluyen el documento del proyecto y del estado de resultados', () => {
    const db = abrir();
    const cliente = crearContraparte(db, { nombre: 'Cliente RR', esCliente: true, esProveedor: false, responsable: 'p' });
    const proyecto = crearProyecto(db, { codigo: 'PRJ-022', nombre: 'Proyecto anulación sintético', contraparteId: cliente, responsable: 'p' });
    const venta = registrarVenta(db, {
      contraparteId: cliente,
      proyectoId: proyecto,
      fechaOperacion: '2026-11-05',
      concepto: 'Venta a anular',
      tipoIngreso: 'instalaciones',
      base: '70.00',
      tasa: '0',
      claveIdempotencia: 'v-rr',
      responsable: 'p'
    });
    registrarVenta(db, {
      contraparteId: cliente,
      proyectoId: proyecto,
      fechaOperacion: '2026-11-06',
      concepto: 'Venta vigente',
      tipoIngreso: 'instalaciones',
      base: '30.00',
      tasa: '0',
      claveIdempotencia: 'v-rr2',
      responsable: 'p'
    });
    anularDocumento(db, 'venta', venta.id, 'p', 'motivo sintético');
    const rentabilidad = rentabilidadProyectos(db);
    const fila = rentabilidad.proyectos[0];
    expect(fila?.ingresoMinor).toBe('30.00');
    expect(fila?.totalDocumentalVentaMinor).toBe('30.00');
    const estado = estadoResultados(db, '2026-11');
    expect(estado.ingresosMinor).toBe('30.00');
    db.close();
  });
});

describe('decimoctava revisión: guardado centralizado de exportación', () => {
  it('guardarExportacionArchivo escribe con la validación del servicio y registra bitácora', () => {
    const db = abrir();
    const cliente = crearContraparte(db, { nombre: 'Cliente SS', esCliente: true, esProveedor: false, responsable: 'p' });
    registrarVenta(db, {
      contraparteId: cliente,
      fechaOperacion: '2026-11-01',
      concepto: 'Venta clasificada',
      tipoIngreso: 'instalaciones',
      base: '20.00',
      tasa: '0',
      clasificacionDocumento: 'contribuyente',
      tipoDocumento: 'factura',
      claveIdempotencia: 'v-ss',
      responsable: 'p'
    });
    const rutaValida = path.join(dir, 'salida.csv');
    const resultado = guardarExportacionArchivo(db, 'venta', '2026-11', rutaValida);
    expect(resultado.guardado).toBe(true);
    expect(resultado.ruta).toBe(rutaValida);
    expect(fs.readFileSync(rutaValida, 'utf8')).toContain('V-000001,2026-11-01,contribuyente,factura,20.00,0.00,20.00');
    const evento = db
      .prepare("SELECT COUNT(*) AS n FROM bitacora_evento WHERE tipo = 'exportacion_guardada'")
      .get() as { n: number };
    expect(evento.n).toBe(1);
    db.close();
  });

  it('una ruta sin extensión .csv se rechaza o normaliza de forma consistente; .CSV mayúsculas se acepta', () => {
    const db = abrir();
    const rutaTxt = path.join(dir, 'salida.txt');
    expect(() => guardarExportacionArchivo(db, 'venta', '2026-11', rutaTxt)).toThrow(/\.csv/);
    expect(fs.existsSync(rutaTxt)).toBe(false);
    const rutaSinExtension = path.join(dir, 'salida');
    const resultado = guardarExportacionArchivo(db, 'venta', '2026-11', rutaSinExtension);
    expect(resultado.ruta).toBe(`${rutaSinExtension}.csv`);
    expect(fs.existsSync(`${rutaSinExtension}.csv`)).toBe(true);
    const rutaMayusculas = path.join(dir, 'SALIDA.CSV');
    const resultadoMayusculas = guardarExportacionArchivo(db, 'venta', '2026-11', rutaMayusculas);
    expect(resultadoMayusculas.guardado).toBe(true);
    expect(fs.existsSync(rutaMayusculas)).toBe(true);
    db.close();
  });
});
