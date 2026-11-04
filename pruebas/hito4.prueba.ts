import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { abrirBase } from '../src/main/db/conexion';
import { aplicarMigraciones } from '../src/main/db/aplicarMigraciones';
import { sembrarCatalogoBase } from '../src/main/servicios/cuentas';
import { crearContraparte, registrarVenta, registrarCompra, listarVentas } from '../src/main/servicios/operacion';
import { registrarCobro, registrarPago } from '../src/main/servicios/tesoreria';
import {
  crearVigencia,
  listarVigencias,
  inscritoIvaEnFecha,
  libroVentas,
  libroCompras,
  conciliarIva,
  registrarRetencion,
  listarRetenciones,
  saldoAnticipo,
  aplicarAnticipo,
  anularAplicacionAnticipo
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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arkon-hito4-'));
  rutaDb = path.join(dir, 'operativa.db');
  const db = abrir();
  db.prepare(
    "INSERT INTO ambito (id, nombre, tipo) VALUES ('administrativo', 'Prueba hito 4', 'administrativo')"
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

describe('hito 4: vigencias del perfil tributario', () => {
  it('una vigencia futura habilita el IVA solo desde su fecha, sin recálculo del historial', () => {
    const db = abrir();
    const cliente = crearContraparte(db, { nombre: 'Cliente K', esCliente: true, esProveedor: false, responsable: 'p' });
    expect(inscritoIvaEnFecha(db, '2026-06-01')).toBe(false);
    expect(() =>
      registrarVenta(db, {
        contraparteId: cliente,
        fechaOperacion: '2026-06-01',
        concepto: 'Venta antes de vigencia',
        tipoIngreso: 'instalaciones',
        base: '100.00',
        tasa: '13',
        claveIdempotencia: 'v-pre',
        responsable: 'p'
      })
    ).toThrow(/inscripción/);
    crearVigencia(db, { desde: '2026-07-01', inscritoIva: true, fuente: 'Registro de contribuyente sintético', responsable: 'p' });
    expect(inscritoIvaEnFecha(db, '2026-06-30')).toBe(false);
    expect(inscritoIvaEnFecha(db, '2026-07-01')).toBe(true);
    expect(() =>
      registrarVenta(db, {
        contraparteId: cliente,
        fechaOperacion: '2026-06-30',
        concepto: 'Venta antes de vigencia',
        tipoIngreso: 'instalaciones',
        base: '100.00',
        tasa: '13',
        claveIdempotencia: 'v-pre2',
        responsable: 'p'
      })
    ).toThrow(/inscripción/);
    const venta = registrarVenta(db, {
      contraparteId: cliente,
      fechaOperacion: '2026-07-05',
      concepto: 'Venta con vigencia',
      tipoIngreso: 'instalaciones',
      base: '200.00',
      tasa: '13',
      claveIdempotencia: 'v-post',
      responsable: 'p'
    });
    expect(venta.duplicado).toBe(false);
    const vigencias = listarVigencias(db);
    expect(vigencias).toHaveLength(1);
    expect(vigencias[0]?.inscritoIva).toBe(true);
    db.close();
  });

  it('las vigencias no se solapan', () => {
    const db = abrir();
    crearVigencia(db, { desde: '2026-07-01', hasta: '2026-09-30', inscritoIva: true, responsable: 'p' });
    expect(() => crearVigencia(db, { desde: '2026-09-15', inscritoIva: false, responsable: 'p' })).toThrow(/solapa/);
    crearVigencia(db, { desde: '2026-10-01', inscritoIva: false, responsable: 'p' });
    expect(listarVigencias(db)).toHaveLength(2);
    db.close();
  });
});

describe('hito 4: libros y conciliación de IVA', () => {
  it('los libros mensuales y el mayor concilian el débito fiscal', () => {
    const db = abrir();
    db.prepare("UPDATE configuracion SET valor = '1' WHERE clave = 'perfil_iva_inscrito'").run();
    const cliente = crearContraparte(db, { nombre: 'Cliente L', esCliente: true, esProveedor: false, responsable: 'p' });
    registrarVenta(db, {
      contraparteId: cliente,
      fechaOperacion: '2026-07-05',
      concepto: 'Venta gravada',
      tipoIngreso: 'instalaciones',
      base: '200.00',
      tasa: '13',
      claveIdempotencia: 'v-libro',
      responsable: 'p'
    });
    registrarVenta(db, {
      contraparteId: cliente,
      fechaOperacion: '2026-08-01',
      concepto: 'Venta de otro mes',
      tipoIngreso: 'instalaciones',
      base: '50.00',
      tasa: '13',
      claveIdempotencia: 'v-otro',
      responsable: 'p'
    });
    const libro = libroVentas(db, '2026-07');
    expect(libro.filas).toHaveLength(1);
    expect(libro.baseMinor).toBe('200.00');
    expect(libro.ivaMinor).toBe('26.00');
    const conciliacion = conciliarIva(db, '2026-07');
    expect(conciliacion.debitoLibroMinor).toBe('26.00');
    expect(conciliacion.debitoMayorMinor).toBe('26.00');
    expect(conciliacion.conciliaDebito).toBe(true);
    const compras = libroCompras(db, '2026-07');
    expect(compras.filas).toHaveLength(0);
    expect(conciliacion.conciliaCredito).toBe(true);
    db.close();
  });

  it('anular una venta la excluye de los totales del libro', () => {
    const db = abrir();
    db.prepare("UPDATE configuracion SET valor = '1' WHERE clave = 'perfil_iva_inscrito'").run();
    const cliente = crearContraparte(db, { nombre: 'Cliente M', esCliente: true, esProveedor: false, responsable: 'p' });
    const venta = registrarVenta(db, {
      contraparteId: cliente,
      fechaOperacion: '2026-07-06',
      concepto: 'Venta a anular',
      tipoIngreso: 'oym',
      base: '100.00',
      tasa: '13',
      claveIdempotencia: 'v-anu',
      responsable: 'p'
    });
    const libroAntes = libroVentas(db, '2026-07');
    expect(libroAntes.ivaMinor).toBe('13.00');
    db.prepare("UPDATE venta SET estado = 'anulada' WHERE id = ?").run(venta.id);
    const libroDespues = libroVentas(db, '2026-07');
    expect(libroDespues.ivaMinor).toBe('0.00');
    expect(listarVentas(db)[0]?.estado).toBe('anulada');
    db.close();
  });
});

describe('hito 4: retenciones como control', () => {
  it('se registran con base, regla y comprobante, sin efecto contable automático', () => {
    const db = abrir();
    const proveedor = crearContraparte(db, { nombre: 'Prov N', esCliente: false, esProveedor: true, responsable: 'p' });
    const ret = registrarRetencion(db, {
      tipo: 'efectuada',
      contraparteId: proveedor,
      fechaOperacion: '2026-07-10',
      base: '1000.00',
      tasa: '1',
      regla: 'Retención sintética de servicios',
      comprobante: 'CR-0001',
      concepto: 'Retención sobre servicio sintético',
      claveIdempotencia: 'ret-1',
      responsable: 'p'
    });
    expect(ret.folio).toBe('RET-000001');
    const duplicada = registrarRetencion(db, {
      tipo: 'efectuada',
      contraparteId: proveedor,
      fechaOperacion: '2026-07-10',
      base: '1000.00',
      tasa: '1',
      regla: 'Retención sintética de servicios',
      comprobante: 'CR-0001',
      concepto: 'Retención sobre servicio sintético',
      claveIdempotencia: 'ret-1',
      responsable: 'p'
    });
    expect(duplicada.duplicado).toBe(true);
    const lista = listarRetenciones(db);
    expect(lista).toHaveLength(1);
    expect(lista[0]?.montoMinor).toBe('10.00');
    const asientos = (db.prepare('SELECT COUNT(*) AS n FROM asiento').get() as { n: number }).n;
    expect(asientos).toBe(0);
    db.close();
  });
});

describe('hito 4: aplicación posterior de anticipos', () => {
  it('un anticipo recibido se aplica a una venta sin registrar dinero nuevo', () => {
    const db = abrir();
    const cliente = crearContraparte(db, { nombre: 'Cliente O', esCliente: true, esProveedor: false, responsable: 'p' });
    const venta = registrarVenta(db, {
      contraparteId: cliente,
      fechaOperacion: '2026-07-01',
      concepto: 'Venta sintética',
      tipoIngreso: 'instalaciones',
      base: '150.00',
      tasa: '0',
      claveIdempotencia: 'v-o',
      responsable: 'p'
    });
    registrarCobro(db, {
      fechaOperacion: '2026-07-02',
      contraparteId: cliente,
      cuentaDestinoId: idCuenta(db, '1101'),
      monto: '200.00',
      concepto: 'Cobro con excedente',
      aplicaciones: [{ documentoTipo: 'venta', documentoId: venta.id, monto: '150.00' }],
      claveIdempotencia: 'cob-o',
      responsable: 'p'
    });
    expect(saldoAnticipo(db, 'cliente', cliente)).toBe(5000n);
    const venta2 = registrarVenta(db, {
      contraparteId: cliente,
      fechaOperacion: '2026-07-20',
      concepto: 'Segunda venta sintética',
      tipoIngreso: 'oym',
      base: '80.00',
      tasa: '0',
      claveIdempotencia: 'v-o2',
      responsable: 'p'
    });
    const aplicacion = aplicarAnticipo(db, {
      tipo: 'cliente',
      contraparteId: cliente,
      documentoTipo: 'venta',
      documentoId: venta2.id,
      fechaOperacion: '2026-07-21',
      monto: '50.00',
      claveIdempotencia: 'aap-1',
      responsable: 'p'
    });
    expect(aplicacion.folio).toBe('AAP-000001');
    expect(saldoAnticipo(db, 'cliente', cliente)).toBe(0n);
    const duplicada = aplicarAnticipo(db, {
      tipo: 'cliente',
      contraparteId: cliente,
      documentoTipo: 'venta',
      documentoId: venta2.id,
      fechaOperacion: '2026-07-21',
      monto: '50.00',
      claveIdempotencia: 'aap-1',
      responsable: 'p'
    });
    expect(duplicada.duplicado).toBe(true);
    expect(() =>
      aplicarAnticipo(db, {
        tipo: 'cliente',
        contraparteId: cliente,
        documentoTipo: 'venta',
        documentoId: venta2.id,
        fechaOperacion: '2026-07-22',
        monto: '10.00',
        claveIdempotencia: 'aap-2',
        responsable: 'p'
      })
    ).toThrow(/anticipo disponible/);
    anularAplicacionAnticipo(db, aplicacion.id, 'p', 'motivo sintético');
    expect(saldoAnticipo(db, 'cliente', cliente)).toBe(5000n);
    db.close();
  });

  it('un anticipo a proveedor se aplica a una compra y los cruzados se rechazan', () => {
    const db = abrir();
    const prov = crearContraparte(db, { nombre: 'Prov P', esCliente: false, esProveedor: true, responsable: 'p' });
    const otro = crearContraparte(db, { nombre: 'Prov Q', esCliente: false, esProveedor: true, responsable: 'p' });
    const compra = registrarCompra(db, {
      contraparteId: prov,
      fechaOperacion: '2026-07-01',
      concepto: 'Compra sintética',
      condicion: 'credito',
      lineas: [{ descripcion: 'Material', cuentaCodigo: '5101', cantidad: '1', precioUnitario: '120.00', tasa: '0', tratamiento: 'exento' }],
      claveIdempotencia: 'c-p',
      responsable: 'p'
    });
    registrarPago(db, {
      fechaOperacion: '2026-07-02',
      contraparteId: prov,
      cuentaOrigenId: idCuenta(db, '1101'),
      monto: '150.00',
      concepto: 'Pago con excedente',
      aplicaciones: [{ documentoTipo: 'compra', documentoId: compra.id, monto: '120.00' }],
      claveIdempotencia: 'pag-p',
      responsable: 'p'
    });
    expect(saldoAnticipo(db, 'proveedor', prov)).toBe(3000n);
    const compra2 = registrarCompra(db, {
      contraparteId: prov,
      fechaOperacion: '2026-07-15',
      concepto: 'Segunda compra sintética',
      condicion: 'credito',
      lineas: [{ descripcion: 'Material', cuentaCodigo: '5101', cantidad: '1', precioUnitario: '60.00', tasa: '0', tratamiento: 'exento' }],
      claveIdempotencia: 'c-p2',
      responsable: 'p'
    });
    expect(() =>
      aplicarAnticipo(db, {
        tipo: 'proveedor',
        contraparteId: otro,
        documentoTipo: 'compra',
        documentoId: compra2.id,
        fechaOperacion: '2026-07-16',
        monto: '30.00',
        claveIdempotencia: 'aap-x',
        responsable: 'p'
      })
    ).toThrow(/otra contraparte/);
    const aplicacion = aplicarAnticipo(db, {
      tipo: 'proveedor',
      contraparteId: prov,
      documentoTipo: 'compra',
      documentoId: compra2.id,
      fechaOperacion: '2026-07-16',
      monto: '30.00',
      claveIdempotencia: 'aap-p',
      responsable: 'p'
    });
    expect(aplicacion.duplicado).toBe(false);
    expect(saldoAnticipo(db, 'proveedor', prov)).toBe(0n);
    db.close();
  });
});
