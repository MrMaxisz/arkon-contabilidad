import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { abrirBase } from '../src/main/db/conexion';
import { aplicarMigraciones } from '../src/main/db/aplicarMigraciones';
import { sembrarCatalogoBase } from '../src/main/servicios/cuentas';
import { crearContraparte, registrarVenta, registrarCompra, listarVentas, listarCompras, saldoPendienteDocumento, anularDocumento } from '../src/main/servicios/operacion';
import { registrarCobro, registrarPago, anularMovimiento } from '../src/main/servicios/tesoreria';
import { aplicarAnticipo, anularAplicacionAnticipo, saldoAnticipo, crearVigencia, cerrarVigencia, inscritoIvaEnFecha, conciliarIva } from '../src/main/servicios/fiscal';

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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arkon-rev8-'));
  rutaDb = path.join(dir, 'operativa.db');
  const db = abrir();
  db.prepare(
    "INSERT INTO ambito (id, nombre, tipo) VALUES ('administrativo', 'Prueba rev8', 'administrativo')"
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

describe('octava revisión: saldos con anticipos aplicados', () => {
  it('un anticipo aplicado descuenta del saldo y bloquea el doble cobro', () => {
    const db = abrir();
    const cliente = crearContraparte(db, { nombre: 'Cliente R', esCliente: true, esProveedor: false, responsable: 'p' });
    const venta = registrarVenta(db, {
      contraparteId: cliente,
      fechaOperacion: '2026-08-01',
      concepto: 'Venta sintética',
      tipoIngreso: 'instalaciones',
      base: '150.00',
      tasa: '0',
      claveIdempotencia: 'v-r',
      responsable: 'p'
    });
    registrarCobro(db, {
      fechaOperacion: '2026-08-02',
      contraparteId: cliente,
      cuentaDestinoId: idCuenta(db, '1101'),
      monto: '200.00',
      concepto: 'Cobro con excedente',
      aplicaciones: [{ documentoTipo: 'venta', documentoId: venta.id, monto: '150.00' }],
      claveIdempotencia: 'cob-r',
      responsable: 'p'
    });
    const venta2 = registrarVenta(db, {
      contraparteId: cliente,
      fechaOperacion: '2026-08-02',
      concepto: 'Segunda venta sintética',
      tipoIngreso: 'oym',
      base: '60.00',
      tasa: '0',
      claveIdempotencia: 'v-r2',
      responsable: 'p'
    });
    aplicarAnticipo(db, {
      tipo: 'cliente',
      contraparteId: cliente,
      documentoTipo: 'venta',
      documentoId: venta2.id,
      fechaOperacion: '2026-08-03',
      monto: '50.00',
      claveIdempotencia: 'aap-r',
      responsable: 'p'
    });
    expect(saldoPendienteDocumento(db, 'venta', venta.id)).toBe(0n);
    expect(saldoPendienteDocumento(db, 'venta', venta2.id)).toBe(1000n);
    const listadas = listarVentas(db);
    expect(listadas.find(v => v.id === venta2.id)?.saldoMinor).toBe('10.00');
    expect(() =>
      registrarCobro(db, {
        fechaOperacion: '2026-08-04',
        contraparteId: cliente,
        cuentaDestinoId: idCuenta(db, '1101'),
        monto: '20.00',
        concepto: 'Cobro indebido',
        aplicaciones: [{ documentoTipo: 'venta', documentoId: venta2.id, monto: '20.00' }],
        claveIdempotencia: 'cob-r2',
        responsable: 'p'
      })
    ).toThrow(/exceden el saldo pendiente/);
    db.close();
  });

  it('un anticipo aplicado parcial descuenta solo lo aplicado', () => {
    const db = abrir();
    const prov = crearContraparte(db, { nombre: 'Prov S', esCliente: false, esProveedor: true, responsable: 'p' });
    const compra = registrarCompra(db, {
      contraparteId: prov,
      fechaOperacion: '2026-08-01',
      concepto: 'Compra sintética',
      condicion: 'credito',
      lineas: [{ descripcion: 'Material', cuentaCodigo: '5101', cantidad: '1', precioUnitario: '100.00', tasa: '0', tratamiento: 'exento' }],
      claveIdempotencia: 'c-s',
      responsable: 'p'
    });
    registrarPago(db, {
      fechaOperacion: '2026-08-02',
      contraparteId: prov,
      cuentaOrigenId: idCuenta(db, '1101'),
      monto: '150.00',
      concepto: 'Pago con excedente',
      aplicaciones: [{ documentoTipo: 'compra', documentoId: compra.id, monto: '100.00' }],
      claveIdempotencia: 'pag-s',
      responsable: 'p'
    });
    const compra2 = registrarCompra(db, {
      contraparteId: prov,
      fechaOperacion: '2026-08-02',
      concepto: 'Segunda compra sintética',
      condicion: 'credito',
      lineas: [{ descripcion: 'Material', cuentaCodigo: '5101', cantidad: '1', precioUnitario: '100.00', tasa: '0', tratamiento: 'exento' }],
      claveIdempotencia: 'c-s2',
      responsable: 'p'
    });
    aplicarAnticipo(db, {
      tipo: 'proveedor',
      contraparteId: prov,
      documentoTipo: 'compra',
      documentoId: compra2.id,
      fechaOperacion: '2026-08-03',
      monto: '30.00',
      claveIdempotencia: 'aap-s',
      responsable: 'p'
    });
    expect(saldoPendienteDocumento(db, 'compra', compra.id)).toBe(0n);
    expect(saldoPendienteDocumento(db, 'compra', compra2.id)).toBe(7000n);
    expect(listarCompras(db).find(c => c.id === compra2.id)?.saldoMinor).toBe('70.00');
    db.close();
  });
});

describe('octava revisión: anulaciones con anticipos', () => {
  it('anular un documento con anticipo aplicado se rechaza; revertida la aplicación, procede', () => {
    const db = abrir();
    const cliente = crearContraparte(db, { nombre: 'Cliente T', esCliente: true, esProveedor: false, responsable: 'p' });
    const venta = registrarVenta(db, {
      contraparteId: cliente,
      fechaOperacion: '2026-08-01',
      concepto: 'Venta sintética',
      tipoIngreso: 'instalaciones',
      base: '80.00',
      tasa: '0',
      claveIdempotencia: 'v-t',
      responsable: 'p'
    });
    registrarCobro(db, {
      fechaOperacion: '2026-08-02',
      contraparteId: cliente,
      cuentaDestinoId: idCuenta(db, '1101'),
      monto: '100.00',
      concepto: 'Cobro con excedente',
      aplicaciones: [{ documentoTipo: 'venta', documentoId: venta.id, monto: '80.00' }],
      claveIdempotencia: 'cob-t',
      responsable: 'p'
    });
    const venta2 = registrarVenta(db, {
      contraparteId: cliente,
      fechaOperacion: '2026-08-02',
      concepto: 'Segunda venta sintética',
      tipoIngreso: 'oym',
      base: '20.00',
      tasa: '0',
      claveIdempotencia: 'v-t2',
      responsable: 'p'
    });
    const aplicacion = aplicarAnticipo(db, {
      tipo: 'cliente',
      contraparteId: cliente,
      documentoTipo: 'venta',
      documentoId: venta2.id,
      fechaOperacion: '2026-08-03',
      monto: '20.00',
      claveIdempotencia: 'aap-t',
      responsable: 'p'
    });
    expect(() => anularDocumento(db, 'venta', venta2.id, 'p', 'motivo')).toThrow(/aplicados/);
    anularAplicacionAnticipo(db, aplicacion.id, 'p', 'reversión previa sintética');
    expect(saldoAnticipo(db, 'cliente', cliente)).toBe(2000n);
    anularDocumento(db, 'venta', venta2.id, 'p', 'motivo sintético');
    const fila = db.prepare('SELECT estado FROM venta WHERE id = ?').get(venta2.id) as { estado: string };
    expect(fila.estado).toBe('anulada');
    db.close();
  });

  it('anular el cobro que financia un anticipo consumido se rechaza; con cobertura restante procede', () => {
    const db = abrir();
    const cliente = crearContraparte(db, { nombre: 'Cliente U', esCliente: true, esProveedor: false, responsable: 'p' });
    const venta = registrarVenta(db, {
      contraparteId: cliente,
      fechaOperacion: '2026-08-01',
      concepto: 'Venta sintética',
      tipoIngreso: 'instalaciones',
      base: '100.00',
      tasa: '0',
      claveIdempotencia: 'v-u',
      responsable: 'p'
    });
    const cobro1 = registrarCobro(db, {
      fechaOperacion: '2026-08-02',
      contraparteId: cliente,
      cuentaDestinoId: idCuenta(db, '1101'),
      monto: '60.00',
      concepto: 'Anticipo fuente uno',
      aplicaciones: [],
      claveIdempotencia: 'cob-u1',
      responsable: 'p'
    });
    registrarCobro(db, {
      fechaOperacion: '2026-08-02',
      contraparteId: cliente,
      cuentaDestinoId: idCuenta(db, '1101'),
      monto: '40.00',
      concepto: 'Anticipo fuente dos',
      aplicaciones: [],
      claveIdempotencia: 'cob-u2',
      responsable: 'p'
    });
    aplicarAnticipo(db, {
      tipo: 'cliente',
      contraparteId: cliente,
      documentoTipo: 'venta',
      documentoId: venta.id,
      fechaOperacion: '2026-08-03',
      monto: '80.00',
      claveIdempotencia: 'aap-u',
      responsable: 'p'
    });
    expect(saldoAnticipo(db, 'cliente', cliente)).toBe(2000n);
    expect(() => anularMovimiento(db, cobro1.id, 'p', 'sin cobertura suficiente')).toThrow(/financia anticipos/);
    registrarCobro(db, {
      fechaOperacion: '2026-08-04',
      contraparteId: cliente,
      cuentaDestinoId: idCuenta(db, '1101'),
      monto: '50.00',
      concepto: 'Anticipo fuente tres',
      aplicaciones: [],
      claveIdempotencia: 'cob-u3',
      responsable: 'p'
    });
    anularMovimiento(db, cobro1.id, 'p', 'con cobertura restante');
    expect(saldoAnticipo(db, 'cliente', cliente)).toBe(1000n);
    db.close();
  });

  it('anular el pago que financia un anticipo de proveedor consumido se rechaza', () => {
    const db = abrir();
    const prov = crearContraparte(db, { nombre: 'Prov V', esCliente: false, esProveedor: true, responsable: 'p' });
    const compra = registrarCompra(db, {
      contraparteId: prov,
      fechaOperacion: '2026-08-01',
      concepto: 'Compra sintética',
      condicion: 'credito',
      lineas: [{ descripcion: 'Material', cuentaCodigo: '5101', cantidad: '1', precioUnitario: '70.00', tasa: '0', tratamiento: 'exento' }],
      claveIdempotencia: 'c-v',
      responsable: 'p'
    });
    const pago = registrarPago(db, {
      fechaOperacion: '2026-08-02',
      contraparteId: prov,
      cuentaOrigenId: idCuenta(db, '1101'),
      monto: '70.00',
      concepto: 'Pago con excedente',
      aplicaciones: [],
      claveIdempotencia: 'pag-v',
      responsable: 'p'
    });
    aplicarAnticipo(db, {
      tipo: 'proveedor',
      contraparteId: prov,
      documentoTipo: 'compra',
      documentoId: compra.id,
      fechaOperacion: '2026-08-03',
      monto: '70.00',
      claveIdempotencia: 'aap-v',
      responsable: 'p'
    });
    expect(() => anularMovimiento(db, pago.id, 'p', 'sin cobertura')).toThrow(/financia anticipos/);
    db.close();
  });
});

describe('octava revisión: transición de vigencias', () => {
  it('cerrar la vigencia actual permite registrar la inscripción futura sin recálculo', () => {
    const db = abrir();
    crearVigencia(db, { desde: '2026-01-01', inscritoIva: false, descripcion: 'Régimen administrativo actual', responsable: 'p' });
    expect(() =>
      crearVigencia(db, { desde: '2027-01-01', inscritoIva: true, fuente: 'Inscripción sintética', responsable: 'p' })
    ).toThrow(/solapa/);
    cerrarVigencia(db, 1, '2026-12-31', 'p', 'constitución sintética de la entidad');
    crearVigencia(db, { desde: '2027-01-01', inscritoIva: true, fuente: 'Inscripción sintética', responsable: 'p' });
    expect(inscritoIvaEnFecha(db, '2026-06-15')).toBe(false);
    expect(inscritoIvaEnFecha(db, '2026-12-31')).toBe(false);
    expect(inscritoIvaEnFecha(db, '2027-01-01')).toBe(true);
    expect(() => cerrarVigencia(db, 1, '2026-11-30', 'p', 'ya cerrada')).toThrow(/cerrada/);
    db.close();
  });
});

describe('octava revisión: conciliación por tratamiento documentado', () => {
  it('compras con IVA al costo no rompen la conciliación del crédito fiscal', () => {
    const db = abrir();
    const prov = crearContraparte(db, { nombre: 'Prov W', esCliente: false, esProveedor: true, responsable: 'p' });
    registrarCompra(db, {
      contraparteId: prov,
      fechaOperacion: '2026-08-05',
      concepto: 'Compra con IVA al costo',
      condicion: 'credito',
      lineas: [{ descripcion: 'Material', cuentaCodigo: '5101', cantidad: '1', precioUnitario: '100.00', tasa: '13', tratamiento: 'gravado', precioConIva: false }],
      claveIdempotencia: 'c-w1',
      responsable: 'p'
    });
    const conciliacion = conciliarIva(db, '2026-08');
    expect(conciliacion.ivaDocumentadoComprasMinor).toBe('13.00');
    expect(conciliacion.creditoAcreditableLibroMinor).toBe('0.00');
    expect(conciliacion.creditoMayorMinor).toBe('0.00');
    expect(conciliacion.conciliaCredito).toBe(true);
    db.close();
  });

  it('compras con crédito fiscal activo concilian y el cambio de política no reinterpreta el historial', () => {
    const db = abrir();
    db.prepare("UPDATE configuracion SET valor = '1' WHERE clave = 'iva_compras_credito_fiscal'").run();
    const prov = crearContraparte(db, { nombre: 'Prov X', esCliente: false, esProveedor: true, responsable: 'p' });
    registrarCompra(db, {
      contraparteId: prov,
      fechaOperacion: '2026-08-05',
      concepto: 'Compra con crédito fiscal',
      condicion: 'credito',
      lineas: [{ descripcion: 'Material', cuentaCodigo: '5101', cantidad: '1', precioUnitario: '100.00', tasa: '13', tratamiento: 'gravado', precioConIva: false }],
      claveIdempotencia: 'c-x1',
      responsable: 'p'
    });
    db.prepare("UPDATE configuracion SET valor = '0' WHERE clave = 'iva_compras_credito_fiscal'").run();
    registrarCompra(db, {
      contraparteId: prov,
      fechaOperacion: '2026-08-06',
      concepto: 'Compra posterior al costo',
      condicion: 'credito',
      lineas: [{ descripcion: 'Material', cuentaCodigo: '5101', cantidad: '1', precioUnitario: '50.00', tasa: '13', tratamiento: 'gravado', precioConIva: false }],
      claveIdempotencia: 'c-x2',
      responsable: 'p'
    });
    const conciliacion = conciliarIva(db, '2026-08');
    expect(conciliacion.ivaDocumentadoComprasMinor).toBe('19.50');
    expect(conciliacion.creditoAcreditableLibroMinor).toBe('13.00');
    expect(conciliacion.creditoMayorMinor).toBe('13.00');
    expect(conciliacion.conciliaCredito).toBe(true);
    db.close();
  });
});
