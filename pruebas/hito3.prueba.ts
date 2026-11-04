import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { abrirBase } from '../src/main/db/conexion';
import { aplicarMigraciones } from '../src/main/db/aplicarMigraciones';
import { sembrarCatalogoBase } from '../src/main/servicios/cuentas';
import { balanceResumen, saldosPorCuenta } from '../src/main/servicios/estadosFinancieros';
import { mayorDeCuenta } from '../src/main/servicios/motorAsientos';
import {
  crearContraparte,
  crearProyecto,
  registrarCompra,
  registrarVenta,
  anularDocumento,
  listarCompras,
  saldoPendienteDocumento
} from '../src/main/servicios/operacion';
import {
  crearCotizacion,
  crearRevision,
  aprobarCotizacion,
  anularCotizacion,
  listarCotizaciones
} from '../src/main/servicios/cotizaciones';
import { registrarCobro, registrarPago, registrarTransferencia, anularMovimiento } from '../src/main/servicios/tesoreria';

let dir: string;
let rutaDb: string;

function abrir(): ReturnType<typeof abrirBase> {
  const db = abrirBase(rutaDb);
  aplicarMigraciones(db);
  return db;
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arkon-hito3-'));
  rutaDb = path.join(dir, 'operativa.db');
  const db = abrir();
  db.prepare(
    "INSERT INTO ambito (id, nombre, tipo) VALUES ('administrativo', 'Prueba hito 3', 'administrativo')"
  ).run();
  sembrarCatalogoBase(db, 'prueba');
  db.close();
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function idCuenta(db: ReturnType<typeof abrir>, codigo: string): number {
  return (db.prepare('SELECT id FROM cuenta WHERE codigo = ?').get(codigo) as { id: number }).id;
}

function saldoTexto(db: ReturnType<typeof abrir>, codigo: string): string {
  return saldosPorCuenta(db).find(s => s.codigo === codigo)?.saldoMinor ?? '0.00';
}

describe('hito 3: flujo comercial completo persistente', () => {
  it('cotización → aprobación → proyecto → venta → compra → cobro → pago reconcilia con el mayor tras reiniciar', () => {
    let db = abrir();
    const cliente = crearContraparte(db, {
      nombre: 'Cliente Sintético Uno',
      esCliente: true,
      esProveedor: false,
      responsable: 'prueba'
    });
    const proveedor = crearContraparte(db, {
      nombre: 'Proveedor Sintético Uno',
      esCliente: false,
      esProveedor: true,
      responsable: 'prueba'
    });

    const cot = crearCotizacion(db, {
      contraparteId: cliente,
      fecha: '2026-03-02',
      condiciones: 'Vigencia 15 días',
      responsable: 'prueba',
      lineas: [
        { tipo: 'servicio', descripcion: 'Servicio sintético', cantidad: '1', precioUnitario: '113.00', precioConIva: true, tasa: '13' },
        { tipo: 'material', descripcion: 'Material sintético exento', cantidad: '2', precioUnitario: '10.00', precioConIva: false, tasa: '0' }
      ]
    });
    expect(cot.numero).toBe('C-000001');
    const cotListadas = listarCotizaciones(db);
    expect(cotListadas[0]?.totalMinor).toBe('133.00');
    expect(cotListadas[0]?.baseMinor).toBe('120.00');
    expect(cotListadas[0]?.ivaMinor).toBe('13.00');

    const rev = crearRevision(db, cot.id, 'prueba');
    expect(rev.revision).toBe(2);
    aprobarCotizacion(db, rev.id, 'prueba');
    const aprobada = listarCotizaciones(db).find(c => c.id === rev.id);
    expect(aprobada?.estado).toBe('aprobada');
    expect(aprobada?.congelada).toBe(true);
    expect(() => crearRevision(db, rev.id, 'prueba')).toThrow(/aprobada/);

    const proyecto = crearProyecto(db, {
      codigo: 'PRJ-001',
      nombre: 'Proyecto sintético uno',
      contraparteId: cliente,
      cotizacionId: rev.id,
      responsable: 'prueba'
    });

    const venta = registrarVenta(db, {
      contraparteId: cliente,
      proyectoId: proyecto,
      fechaOperacion: '2026-03-10',
      concepto: 'Servicio reconocido sintético',
      tipoIngreso: 'instalaciones',
      base: '120.00',
      tasa: '0',
      claveIdempotencia: 'venta-1',
      responsable: 'prueba'
    });
    expect(venta.folio).toBe('V-000001');
    const ventaDuplicada = registrarVenta(db, {
      contraparteId: cliente,
      proyectoId: proyecto,
      fechaOperacion: '2026-03-10',
      concepto: 'Servicio reconocido sintético',
      tipoIngreso: 'instalaciones',
      base: '120.00',
      tasa: '0',
      claveIdempotencia: 'venta-1',
      responsable: 'prueba'
    });
    expect(ventaDuplicada.duplicado).toBe(true);

    const compra = registrarCompra(db, {
      contraparteId: proveedor,
      proyectoId: proyecto,
      fechaOperacion: '2026-03-12',
      concepto: 'Materiales sintéticos',
      condicion: 'credito',
      lineas: [
        { descripcion: 'Cable sintético', cuentaCodigo: '5101', cantidad: '10', precioUnitario: '5.00', tasa: '13', tratamiento: 'gravado', precioConIva: true },
        { descripcion: 'Transporte sintético exento', cuentaCodigo: '5103', cantidad: '1', precioUnitario: '20.00', tasa: '0', tratamiento: 'exento' }
      ],
      claveIdempotencia: 'compra-1',
      responsable: 'prueba'
    });
    expect(compra.folio).toBe('CMP-000001');

    const cobro = registrarCobro(db, {
      fechaOperacion: '2026-03-15',
      contraparteId: cliente,
      cuentaDestinoId: idCuenta(db, '1101'),
      monto: '130.00',
      concepto: 'Cobro con excedente sintético',
      aplicaciones: [{ documentoTipo: 'venta', documentoId: venta.id, monto: '120.00' }],
      claveIdempotencia: 'cobro-1',
      responsable: 'prueba'
    });
    expect(cobro.folio).toBe('COB-000001');

    const pago = registrarPago(db, {
      fechaOperacion: '2026-03-16',
      contraparteId: proveedor,
      cuentaOrigenId: idCuenta(db, '1101'),
      monto: '40.00',
      concepto: 'Pago parcial sintético',
      aplicaciones: [{ documentoTipo: 'compra', documentoId: compra.id, monto: '40.00' }],
      claveIdempotencia: 'pago-1',
      responsable: 'prueba'
    });
    expect(pago.folio).toBe('PAG-000001');

    const transferencia = registrarTransferencia(db, {
      fechaOperacion: '2026-03-17',
      cuentaOrigenId: idCuenta(db, '1101'),
      cuentaDestinoId: idCuenta(db, '1103'),
      monto: '50.00',
      concepto: 'Depósito bancario sintético',
      claveIdempotencia: 'trf-1',
      responsable: 'prueba'
    });
    expect(transferencia.folio).toBe('TRF-000001');

    db.close();

    db = abrir();
    const saldos = (codigo: string) => saldoTexto(db, codigo);
    expect(saldos('1101')).toBe('40.00');
    expect(saldos('1103')).toBe('50.00');
    expect(saldos('1201')).toBe('0.00');
    expect(saldos('2102')).toBe('-10.00');
    expect(saldos('2101')).toBe('-30.00');
    expect(saldos('4101')).toBe('-120.00');
    expect(saldos('5101')).toBe('50.00');
    expect(saldos('5103')).toBe('20.00');
    expect(saldoPendienteDocumento(db, 'compra', compra.id)).toBe(3000n);
    const balance = balanceResumen(db);
    expect(balance.cuadra).toBe(true);
    const compras = listarCompras(db);
    expect(compras[0]?.saldoMinor).toBe('30.00');
    db.close();
  });
});

describe('reglas de negocio del hito 3', () => {
  it('una cotización no crea asientos; su anulación exige motivo', () => {
    const db = abrir();
    const cliente = crearContraparte(db, { nombre: 'Cliente C2', esCliente: true, esProveedor: false, responsable: 'prueba' });
    const cot = crearCotizacion(db, {
      contraparteId: cliente,
      fecha: '2026-03-02',
      responsable: 'prueba',
      lineas: [
        { tipo: 'servicio', descripcion: 'Servicio', cantidad: '1', precioUnitario: '100.00', precioConIva: false, tasa: '13' }
      ]
    });
    const asientos = (db.prepare('SELECT COUNT(*) AS n FROM asiento').get() as { n: number }).n;
    expect(asientos).toBe(0);
    anularCotizacion(db, cot.id, 'prueba', 'motivo sintético');
    expect(listarCotizaciones(db)[0]?.estado).toBe('anulada');
    db.close();
  });

  it('la venta con IVA se rechaza sin inscripción y se admite con el perfil activado', () => {
    const db = abrir();
    const cliente = crearContraparte(db, { nombre: 'Cliente C3', esCliente: true, esProveedor: false, responsable: 'prueba' });
    expect(() =>
      registrarVenta(db, {
        contraparteId: cliente,
        fechaOperacion: '2026-03-10',
        concepto: 'Venta con IVA sin inscripción',
        tipoIngreso: 'oym',
        base: '100.00',
        tasa: '13',
        claveIdempotencia: 'v-iva-1',
        responsable: 'prueba'
      })
    ).toThrow(/inscripción/);
    db.prepare("UPDATE configuracion SET valor = '1' WHERE clave = 'perfil_iva_inscrito'").run();
    const venta = registrarVenta(db, {
      contraparteId: cliente,
      fechaOperacion: '2026-03-10',
      concepto: 'Venta con IVA inscrita',
      tipoIngreso: 'oym',
      base: '100.00',
      tasa: '13',
      claveIdempotencia: 'v-iva-2',
      responsable: 'prueba'
    });
    expect(venta.duplicado).toBe(false);
    expect(saldoTexto(db, '2201')).toBe('-13.00');
    db.close();
  });

  it('el IVA de compras va al costo por defecto y a crédito fiscal solo con la política activada', () => {
    const db = abrir();
    const proveedor = crearContraparte(db, { nombre: 'Proveedor P2', esCliente: false, esProveedor: true, responsable: 'prueba' });
    registrarCompra(db, {
      contraparteId: proveedor,
      fechaOperacion: '2026-03-12',
      concepto: 'Compra sintética',
      condicion: 'credito',
      lineas: [
        { descripcion: 'Material', cuentaCodigo: '5101', cantidad: '1', precioUnitario: '100.00', tasa: '13', tratamiento: 'gravado', precioConIva: false }
      ],
      claveIdempotencia: 'c-1',
      responsable: 'prueba'
    });
    expect(saldoTexto(db, '5101')).toBe('113.00');
    expect(saldoTexto(db, '1203')).toBe('0.00');
    db.prepare("UPDATE configuracion SET valor = '1' WHERE clave = 'iva_compras_credito_fiscal'").run();
    registrarCompra(db, {
      contraparteId: proveedor,
      fechaOperacion: '2026-03-13',
      concepto: 'Compra sintética con crédito fiscal',
      condicion: 'credito',
      lineas: [
        { descripcion: 'Material', cuentaCodigo: '5101', cantidad: '1', precioUnitario: '100.00', tasa: '13', tratamiento: 'gravado', precioConIva: false }
      ],
      claveIdempotencia: 'c-2',
      responsable: 'prueba'
    });
    expect(saldoTexto(db, '5101')).toBe('213.00');
    expect(saldoTexto(db, '1203')).toBe('13.00');
    db.close();
  });

  it('las aplicaciones no exceden el saldo pendiente y el excedente queda como anticipo', () => {
    const db = abrir();
    const cliente = crearContraparte(db, { nombre: 'Cliente C4', esCliente: true, esProveedor: false, responsable: 'prueba' });
    const venta = registrarVenta(db, {
      contraparteId: cliente,
      fechaOperacion: '2026-03-10',
      concepto: 'Venta sintética',
      tipoIngreso: 'instalaciones',
      base: '50.00',
      tasa: '0',
      claveIdempotencia: 'v-4',
      responsable: 'prueba'
    });
    expect(() =>
      registrarCobro(db, {
        fechaOperacion: '2026-03-15',
        contraparteId: cliente,
        cuentaDestinoId: idCuenta(db, '1101'),
        monto: '60.00',
        concepto: 'Cobro excedente',
        aplicaciones: [{ documentoTipo: 'venta', documentoId: venta.id, monto: '55.00' }],
        claveIdempotencia: 'cob-4',
        responsable: 'prueba'
      })
    ).toThrow(/exceden el saldo pendiente/);
    const cobro = registrarCobro(db, {
      fechaOperacion: '2026-03-15',
      contraparteId: cliente,
      cuentaDestinoId: idCuenta(db, '1101'),
      monto: '60.00',
      concepto: 'Cobro con excedente',
      aplicaciones: [{ documentoTipo: 'venta', documentoId: venta.id, monto: '50.00' }],
      claveIdempotencia: 'cob-5',
      responsable: 'prueba'
    });
    expect(cobro.duplicado).toBe(false);
    expect(saldoTexto(db, '1201')).toBe('0.00');
    expect(saldoTexto(db, '2102')).toBe('-10.00');
    db.close();
  });

  it('anular un documento con aplicaciones se rechaza; sin aplicaciones crea reverso', () => {
    const db = abrir();
    const cliente = crearContraparte(db, { nombre: 'Cliente C5', esCliente: true, esProveedor: false, responsable: 'prueba' });
    const venta = registrarVenta(db, {
      contraparteId: cliente,
      fechaOperacion: '2026-03-10',
      concepto: 'Venta sintética',
      tipoIngreso: 'instalaciones',
      base: '80.00',
      tasa: '0',
      claveIdempotencia: 'v-5',
      responsable: 'prueba'
    });
    registrarCobro(db, {
      fechaOperacion: '2026-03-15',
      contraparteId: cliente,
      cuentaDestinoId: idCuenta(db, '1101'),
      monto: '80.00',
      concepto: 'Cobro total',
      aplicaciones: [{ documentoTipo: 'venta', documentoId: venta.id, monto: '80.00' }],
      claveIdempotencia: 'cob-6',
      responsable: 'prueba'
    });
    expect(() => anularDocumento(db, 'venta', venta.id, 'prueba', 'motivo')).toThrow(/aplicados/);
    const venta2 = registrarVenta(db, {
      contraparteId: cliente,
      fechaOperacion: '2026-03-11',
      concepto: 'Venta sin cobro',
      tipoIngreso: 'instalaciones',
      base: '20.00',
      tasa: '0',
      claveIdempotencia: 'v-6',
      responsable: 'prueba'
    });
    anularDocumento(db, 'venta', venta2.id, 'prueba', 'motivo sintético');
    expect(saldoTexto(db, '1201')).toBe('0.00');
    const mayor = mayorDeCuenta(db, idCuenta(db, '4101'));
    expect(mayor.saldoMinor).toBe('-80.00');
    db.close();
  });

  it('la transferencia interna no genera ingresos ni gastos y su anulación revierte', () => {
    const db = abrir();
    registrarTransferencia(db, {
      fechaOperacion: '2026-03-17',
      cuentaOrigenId: idCuenta(db, '1101'),
      cuentaDestinoId: idCuenta(db, '1103'),
      monto: '25.00',
      concepto: 'Traspaso sintético',
      claveIdempotencia: 'trf-2',
      responsable: 'prueba'
    });
    expect(saldoTexto(db, '1101')).toBe('-25.00');
    expect(saldoTexto(db, '1103')).toBe('25.00');
    const mov = db.prepare('SELECT id FROM tesoreria_movimiento LIMIT 1').get() as { id: number };
    anularMovimiento(db, mov.id, 'prueba', 'motivo sintético');
    expect(saldoTexto(db, '1101')).toBe('0.00');
    expect(saldoTexto(db, '1103')).toBe('0.00');
    expect(balanceResumen(db).cuadra).toBe(true);
    db.close();
  });

  it('el pago sin aplicación queda como anticipo a proveedores', () => {
    const db = abrir();
    const proveedor = crearContraparte(db, { nombre: 'Proveedor P3', esCliente: false, esProveedor: true, responsable: 'prueba' });
    registrarPago(db, {
      fechaOperacion: '2026-03-18',
      contraparteId: proveedor,
      cuentaOrigenId: idCuenta(db, '1101'),
      monto: '30.00',
      concepto: 'Anticipo sintético',
      aplicaciones: [],
      claveIdempotencia: 'pag-2',
      responsable: 'prueba'
    });
    expect(saldoTexto(db, '1202')).toBe('30.00');
    expect(saldoTexto(db, '2101')).toBe('0.00');
    db.close();
  });
});
