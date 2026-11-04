import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { abrirBase } from '../src/main/db/conexion';
import { aplicarMigraciones } from '../src/main/db/aplicarMigraciones';
import { sembrarCatalogoBase } from '../src/main/servicios/cuentas';
import { crearContraparte, registrarVenta, registrarCompra, anularDocumento, listarProyectos, crearProyecto } from '../src/main/servicios/operacion';
import { registrarCobro, registrarPago } from '../src/main/servicios/tesoreria';
import { anularAsiento } from '../src/main/servicios/motorAsientos';
import { actualizarCotizacionBorrador, crearCotizacion, crearRevision, aprobarCotizacion, lineasDeCotizacion, listarCotizaciones } from '../src/main/servicios/cotizaciones';
import { multiplicarLinea, parseMontoMinor, desglosarIvaSeparado, desglosarIvaIncluido } from '../src/shared/dinero';

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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arkon-rev4-'));
  rutaDb = path.join(dir, 'operativa.db');
  const db = abrir();
  db.prepare(
    "INSERT INTO ambito (id, nombre, tipo) VALUES ('administrativo', 'Prueba rev4', 'administrativo')"
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

describe('aplicaciones por contraparte y por saldo acumulado', () => {
  it('un cobro cruzado entre clientes se rechaza sin movimiento ni asiento', () => {
    const db = abrir();
    const clienteA = crearContraparte(db, { nombre: 'Cliente A', esCliente: true, esProveedor: false, responsable: 'p' });
    const clienteB = crearContraparte(db, { nombre: 'Cliente B', esCliente: true, esProveedor: false, responsable: 'p' });
    const ventaA = registrarVenta(db, {
      contraparteId: clienteA,
      fechaOperacion: '2026-04-01',
      concepto: 'Venta a A',
      tipoIngreso: 'instalaciones',
      base: '100.00',
      tasa: '0',
      claveIdempotencia: 'v-a',
      responsable: 'p'
    });
    expect(() =>
      registrarCobro(db, {
        fechaOperacion: '2026-04-05',
        contraparteId: clienteB,
        cuentaDestinoId: idCuenta(db, '1101'),
        monto: '100.00',
        concepto: 'Cobro cruzado',
        aplicaciones: [{ documentoTipo: 'venta', documentoId: ventaA.id, monto: '100.00' }],
        claveIdempotencia: 'cob-x',
        responsable: 'p'
      })
    ).toThrow(/otra contraparte/);
    const movs = (db.prepare('SELECT COUNT(*) AS n FROM tesoreria_movimiento').get() as { n: number }).n;
    const asientos = (db.prepare('SELECT COUNT(*) AS n FROM asiento').get() as { n: number }).n;
    expect(movs).toBe(0);
    expect(asientos).toBe(1);
    db.close();
  });

  it('un pago cruzado entre proveedores se rechaza', () => {
    const db = abrir();
    const provA = crearContraparte(db, { nombre: 'Prov A', esCliente: false, esProveedor: true, responsable: 'p' });
    const provB = crearContraparte(db, { nombre: 'Prov B', esCliente: false, esProveedor: true, responsable: 'p' });
    const compraA = registrarCompra(db, {
      contraparteId: provA,
      fechaOperacion: '2026-04-02',
      concepto: 'Compra a A',
      condicion: 'credito',
      lineas: [{ descripcion: 'Material', cuentaCodigo: '5101', cantidad: '1', precioUnitario: '80.00', tasa: '0', tratamiento: 'exento' }],
      claveIdempotencia: 'c-a',
      responsable: 'p'
    });
    expect(() =>
      registrarPago(db, {
        fechaOperacion: '2026-04-06',
        contraparteId: provB,
        cuentaOrigenId: idCuenta(db, '1101'),
        monto: '80.00',
        concepto: 'Pago cruzado',
        aplicaciones: [{ documentoTipo: 'compra', documentoId: compraA.id, monto: '80.00' }],
        claveIdempotencia: 'pag-x',
        responsable: 'p'
      })
    ).toThrow(/otra contraparte/);
    db.close();
  });

  it('aplicaciones repetidas al mismo documento se acumulan y no exceden la deuda', () => {
    const db = abrir();
    const cliente = crearContraparte(db, { nombre: 'Cliente C', esCliente: true, esProveedor: false, responsable: 'p' });
    const venta = registrarVenta(db, {
      contraparteId: cliente,
      fechaOperacion: '2026-04-01',
      concepto: 'Venta',
      tipoIngreso: 'instalaciones',
      base: '100.00',
      tasa: '0',
      claveIdempotencia: 'v-c',
      responsable: 'p'
    });
    expect(() =>
      registrarCobro(db, {
        fechaOperacion: '2026-04-05',
        contraparteId: cliente,
        cuentaDestinoId: idCuenta(db, '1101'),
        monto: '120.00',
        concepto: 'Cobro con aplicaciones duplicadas',
        aplicaciones: [
          { documentoTipo: 'venta', documentoId: venta.id, monto: '70.00' },
          { documentoTipo: 'venta', documentoId: venta.id, monto: '50.00' }
        ],
        claveIdempotencia: 'cob-dup',
        responsable: 'p'
      })
    ).toThrow(/exceden el saldo pendiente/);
    const movs = (db.prepare('SELECT COUNT(*) AS n FROM tesoreria_movimiento').get() as { n: number }).n;
    expect(movs).toBe(0);
    const cobro = registrarCobro(db, {
      fechaOperacion: '2026-04-05',
      contraparteId: cliente,
      cuentaDestinoId: idCuenta(db, '1101'),
      monto: '120.00',
      concepto: 'Cobro válido acumulado',
      aplicaciones: [
        { documentoTipo: 'venta', documentoId: venta.id, monto: '60.00' },
        { documentoTipo: 'venta', documentoId: venta.id, monto: '40.00' }
      ],
      claveIdempotencia: 'cob-ok',
      responsable: 'p'
    });
    expect(cobro.duplicado).toBe(false);
    const aplicaciones = db
      .prepare('SELECT monto_minor FROM aplicacion WHERE documento_id = ?')
      .all(venta.id) as Array<{ monto_minor: number }>;
    const totalAplicado = aplicaciones.reduce((s, a) => s + a.monto_minor, 0);
    expect(totalAplicado).toBe(10000);
    db.close();
  });
});

describe('anulación de asientos comerciales', () => {
  it('la anulación manual rechaza asientos de venta, cobro y transferencia', () => {
    const db = abrir();
    const cliente = crearContraparte(db, { nombre: 'Cliente D', esCliente: true, esProveedor: false, responsable: 'p' });
    const venta = registrarVenta(db, {
      contraparteId: cliente,
      fechaOperacion: '2026-04-01',
      concepto: 'Venta',
      tipoIngreso: 'instalaciones',
      base: '50.00',
      tasa: '0',
      claveIdempotencia: 'v-d',
      responsable: 'p'
    });
    const asientoId = (db.prepare('SELECT asiento_id FROM venta WHERE id = ?').get(venta.id) as { asiento_id: number }).asiento_id;
    expect(() => anularAsiento(db, asientoId, 'p', 'intento aislado')).toThrow(/anúlelo desde su vista/);
    registrarCobro(db, {
      fechaOperacion: '2026-04-05',
      contraparteId: cliente,
      cuentaDestinoId: idCuenta(db, '1101'),
      monto: '50.00',
      concepto: 'Cobro',
      aplicaciones: [{ documentoTipo: 'venta', documentoId: venta.id, monto: '50.00' }],
      claveIdempotencia: 'cob-d',
      responsable: 'p'
    });
    const asientoCobro = (db.prepare("SELECT asiento_id FROM tesoreria_movimiento WHERE tipo = 'cobro'").get() as { asiento_id: number }).asiento_id;
    expect(() => anularAsiento(db, asientoCobro, 'p', 'intento aislado')).toThrow(/anúlelo desde su vista/);
    db.close();
  });

  it('anular por la ruta del documento conserva la conciliación', () => {
    const db = abrir();
    const cliente = crearContraparte(db, { nombre: 'Cliente E', esCliente: true, esProveedor: false, responsable: 'p' });
    const venta = registrarVenta(db, {
      contraparteId: cliente,
      fechaOperacion: '2026-04-01',
      concepto: 'Venta',
      tipoIngreso: 'instalaciones',
      base: '70.00',
      tasa: '0',
      claveIdempotencia: 'v-e',
      responsable: 'p'
    });
    anularDocumento(db, 'venta', venta.id, 'p', 'motivo sintético');
    const ventaFila = db.prepare('SELECT estado FROM venta WHERE id = ?').get(venta.id) as { estado: string };
    expect(ventaFila.estado).toBe('anulada');
    const saldo1201 = (db
      .prepare("SELECT COALESCE(SUM(l.debe_minor - l.haber_minor), 0) AS s FROM asiento_linea l JOIN asiento a ON a.id = l.asiento_id JOIN cuenta c ON c.id = l.cuenta_id WHERE c.codigo = '1201'")
      .get() as { s: number }).s;
    expect(saldo1201).toBe(0);
    db.close();
  });

  it('una venta con cobros no puede anularse por la ruta del documento', () => {
    const db = abrir();
    const cliente = crearContraparte(db, { nombre: 'Cliente F', esCliente: true, esProveedor: false, responsable: 'p' });
    const venta = registrarVenta(db, {
      contraparteId: cliente,
      fechaOperacion: '2026-04-01',
      concepto: 'Venta',
      tipoIngreso: 'instalaciones',
      base: '30.00',
      tasa: '0',
      claveIdempotencia: 'v-f',
      responsable: 'p'
    });
    registrarCobro(db, {
      fechaOperacion: '2026-04-05',
      contraparteId: cliente,
      cuentaDestinoId: idCuenta(db, '1101'),
      monto: '30.00',
      concepto: 'Cobro',
      aplicaciones: [{ documentoTipo: 'venta', documentoId: venta.id, monto: '30.00' }],
      claveIdempotencia: 'cob-f',
      responsable: 'p'
    });
    expect(() => anularDocumento(db, 'venta', venta.id, 'p', 'motivo')).toThrow(/aplicados/);
    db.close();
  });
});

describe('redondeo monetario compartido', () => {
  it('el producto cantidad × precio usa half-up, no truncamiento', () => {
    expect(multiplicarLinea(parseMontoMinor('0.50'), parseMontoMinor('0.01'))).toBe(1n);
    expect(multiplicarLinea(parseMontoMinor('0.30'), parseMontoMinor('0.01'))).toBe(0n);
    expect(multiplicarLinea(parseMontoMinor('0.40'), parseMontoMinor('0.01'))).toBe(0n);
    expect(multiplicarLinea(parseMontoMinor('0.60'), parseMontoMinor('0.01'))).toBe(1n);
    expect(multiplicarLinea(parseMontoMinor('2.35'), parseMontoMinor('10.10'))).toBe(2374n);
  });

  it('una línea de cotización con residuo exactamente medio redondea hacia arriba y conserva el total', () => {
    const db = abrir();
    const cliente = crearContraparte(db, { nombre: 'Cliente G', esCliente: true, esProveedor: false, responsable: 'p' });
    const cot = crearCotizacion(db, {
      contraparteId: cliente,
      fecha: '2026-04-01',
      responsable: 'p',
      lineas: [
        { tipo: 'material', descripcion: 'Tornillería sintética', cantidad: '0.50', precioUnitario: '0.01', precioConIva: false, tasa: '0' }
      ]
    });
    const lineas = lineasDeCotizacion(db, cot.id);
    expect(lineas[0]?.baseMinor).toBe('0.01');
    expect(lineas[0]?.totalMinor).toBe('0.01');
    db.close();
  });

  it('IVA incluido y separado con cantidades fraccionarias conservan el total', () => {
    const base = parseMontoMinor('0.03');
    const dSep = desglosarIvaSeparado(base, { puntosBase: 1300n });
    expect(dSep.base + dSep.iva).toBe(dSep.total);
    const dInc = desglosarIvaIncluido(parseMontoMinor('0.03'), { puntosBase: 1300n });
    expect(dInc.base + dInc.iva).toBe(dInc.total);
  });
});

describe('edición de revisiones de cotización', () => {
  it('una revisión se edita antes de aprobarse y la versión previa conserva su contenido', () => {
    const db = abrir();
    const cliente = crearContraparte(db, { nombre: 'Cliente H', esCliente: true, esProveedor: false, responsable: 'p' });
    const original = crearCotizacion(db, {
      contraparteId: cliente,
      fecha: '2026-04-01',
      condiciones: 'Condiciones v1',
      responsable: 'p',
      lineas: [
        { tipo: 'servicio', descripcion: 'Servicio original', cantidad: '1', precioUnitario: '100.00', precioConIva: false, tasa: '0' }
      ]
    });
    const revision = crearRevision(db, original.id, 'p');
    actualizarCotizacionBorrador(db, revision.id, {
      condiciones: 'Condiciones v2',
      responsable: 'p',
      lineas: [
        { tipo: 'servicio', descripcion: 'Servicio revisado', cantidad: '2', precioUnitario: '120.00', precioConIva: false, tasa: '0' }
      ]
    });
    aprobarCotizacion(db, revision.id, 'p');
    const lineasOriginales = lineasDeCotizacion(db, original.id);
    expect(lineasOriginales[0]?.descripcion).toBe('Servicio original');
    expect(lineasOriginales[0]?.totalMinor).toBe('100.00');
    const lineasRevision = lineasDeCotizacion(db, revision.id);
    expect(lineasRevision[0]?.descripcion).toBe('Servicio revisado');
    expect(lineasRevision[0]?.totalMinor).toBe('240.00');
    const listadas = listarCotizaciones(db);
    expect(listadas.find(c => c.id === revision.id)?.estado).toBe('aprobada');
    expect(listadas.find(c => c.id === original.id)?.estado).toBe('borrador');
    expect(() =>
      actualizarCotizacionBorrador(db, revision.id, { responsable: 'p', lineas: [{ tipo: 'servicio', descripcion: 'x', cantidad: '1', precioUnitario: '1.00', precioConIva: false, tasa: '0' }] })
    ).toThrow(/Solo se editan cotizaciones en borrador/);
    db.close();
  });
});

describe('contrato de proyectos', () => {
  it('listarProyectos entrega campos camelCase', () => {
    const db = abrir();
    const cliente = crearContraparte(db, { nombre: 'Cliente I', esCliente: true, esProveedor: false, responsable: 'p' });
    crearProyecto(db, { codigo: 'PRJ-002', nombre: 'Proyecto dos', contraparteId: cliente, responsable: 'p' });
    const proyectos = listarProyectos(db);
    expect(proyectos[0]?.contraparteNombre).toBe('Cliente I');
    expect(proyectos[0]?.codigo).toBe('PRJ-002');
    db.close();
  });
});
