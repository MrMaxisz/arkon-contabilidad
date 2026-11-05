import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { abrirBase, prepararRutasDatos } from '../src/main/db/conexion';
import { aplicarMigraciones } from '../src/main/db/aplicarMigraciones';
import { sembrarCatalogoBase } from '../src/main/servicios/cuentas';
import { crearContraparte, registrarVenta, registrarCompra, anularDocumento } from '../src/main/servicios/operacion';
import { registrarCobro, registrarPago, registrarTransferencia } from '../src/main/servicios/tesoreria';
import { auxiliarContrapartes, auxiliarEfectivo } from '../src/main/servicios/fiscal';
import { despachar } from '../src/main/comandos';

let dir: string;
let rutaDb: string;
let rutas: ReturnType<typeof prepararRutasDatos>;
const abiertas: Array<ReturnType<typeof abrirBase>> = [];

function abrir(): ReturnType<typeof abrirBase> {
  const db = abrirBase(rutaDb);
  aplicarMigraciones(db);
  abiertas.push(db);
  return db;
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arkon-b3-'));
  rutas = prepararRutasDatos(path.join(dir, 'datos'));
  rutaDb = path.join(rutas.datos, 'op.db');
  const db = abrir();
  db.prepare("INSERT INTO ambito (id, nombre, tipo) VALUES ('administrativo', 'Prueba b3', 'administrativo')").run();
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

function contexto() {
  const db = abrir();
  return {
    db,
    rutas,
    versionApp: 'prueba',
    rutaDb,
    reabrirBase(this: { db: ReturnType<typeof abrirBase> }) {
      if (this.db.open) {
        this.db.close();
      }
      this.db = abrirBase(rutaDb);
      aplicarMigraciones(this.db);
    }
  };
}

function idCuenta(db: ReturnType<typeof abrirBase>, codigo: string): number {
  return (db.prepare('SELECT id FROM cuenta WHERE codigo = ?').get(codigo) as { id: number }).id;
}

describe('bloque 3: auxiliares conciliados con documentos, aplicaciones y mayor', () => {
  it('auxiliar de clientes y proveedores concilia tras ventas, compras, cobros y pagos', () => {
    const ctx = contexto();
    const cliente = crearContraparte(ctx.db, { nombre: 'Cliente Auxiliar', esCliente: true, esProveedor: false, responsable: 'p' });
    const proveedor = crearContraparte(ctx.db, { nombre: 'Proveedor Auxiliar', esCliente: false, esProveedor: true, responsable: 'p' });
    const venta = registrarVenta(ctx.db, {
      contraparteId: cliente,
      fechaOperacion: '2026-12-01',
      concepto: 'Venta auxiliar',
      tipoIngreso: 'instalaciones',
      base: '200.00',
      tasa: '0',
      claveIdempotencia: 'v-aux',
      responsable: 'p'
    });
    const compra = registrarCompra(ctx.db, {
      contraparteId: proveedor,
      fechaOperacion: '2026-12-02',
      concepto: 'Compra auxiliar',
      condicion: 'credito',
      lineas: [{ descripcion: 'Material', cuentaCodigo: '5101', cantidad: '1', precioUnitario: '80.00', tasa: '0', tratamiento: 'exento' }],
      claveIdempotencia: 'c-aux',
      responsable: 'p'
    });
    registrarCobro(ctx.db, {
      fechaOperacion: '2026-12-05',
      contraparteId: cliente,
      cuentaDestinoId: idCuenta(ctx.db, '1101'),
      monto: '150.00',
      concepto: 'Cobro parcial',
      aplicaciones: [{ documentoTipo: 'venta', documentoId: venta.id, monto: '150.00' }],
      claveIdempotencia: 'cob-aux',
      responsable: 'p'
    });
    registrarPago(ctx.db, {
      fechaOperacion: '2026-12-06',
      contraparteId: proveedor,
      cuentaOrigenId: idCuenta(ctx.db, '1101'),
      monto: '50.00',
      concepto: 'Pago parcial',
      aplicaciones: [{ documentoTipo: 'compra', documentoId: compra.id, monto: '50.00' }],
      claveIdempotencia: 'pag-aux',
      responsable: 'p'
    });

    const auxiliar = auxiliarContrapartes(ctx.db);
    expect(auxiliar.conciliaMayor).toBe(true);
    const clienteAux = auxiliar.clientes.find(c => c.contraparteId === cliente);
    expect(clienteAux?.saldoMinor).toBe('50.00');
    const proveedorAux = auxiliar.proveedores.find(p => p.contraparteId === proveedor);
    expect(proveedorAux?.saldoMinor).toBe('30.00');
    ctx.db.close();
    const idx = abiertas.findIndex(d => !d.open);
    if (idx >= 0) {
      abiertas.splice(idx, 1);
    }
  });

  it('auxiliar de efectivo concilia con el mayor tras cobros, pagos y transferencias', () => {
    const ctx = contexto();
    const cliente = crearContraparte(ctx.db, { nombre: 'Cliente Efectivo', esCliente: true, esProveedor: false, responsable: 'p' });
    const venta = registrarVenta(ctx.db, {
      contraparteId: cliente,
      fechaOperacion: '2026-12-01',
      concepto: 'Venta efectivo',
      tipoIngreso: 'instalaciones',
      base: '100.00',
      tasa: '0',
      claveIdempotencia: 'v-efec',
      responsable: 'p'
    });
    registrarCobro(ctx.db, {
      fechaOperacion: '2026-12-05',
      contraparteId: cliente,
      cuentaDestinoId: idCuenta(ctx.db, '1101'),
      monto: '100.00',
      concepto: 'Cobro total',
      aplicaciones: [{ documentoTipo: 'venta', documentoId: venta.id, monto: '100.00' }],
      claveIdempotencia: 'cob-efec',
      responsable: 'p'
    });
    registrarTransferencia(ctx.db, {
      fechaOperacion: '2026-12-06',
      cuentaOrigenId: idCuenta(ctx.db, '1101'),
      cuentaDestinoId: idCuenta(ctx.db, '1103'),
      monto: '40.00',
      concepto: 'Depósito',
      claveIdempotencia: 'trf-efec',
      responsable: 'p'
    });

    const efectivo = auxiliarEfectivo(ctx.db);
    expect(efectivo.conciliaMayor).toBe(true);
    const caja = efectivo.cuentas.find(c => c.codigo === '1101');
    expect(caja?.saldoMinor).toBe('60.00');
    const bancos = efectivo.cuentas.find(c => c.codigo === '1103');
    expect(bancos?.saldoMinor).toBe('40.00');
    ctx.db.close();
    const idx = abiertas.findIndex(d => !d.open);
    if (idx >= 0) {
      abiertas.splice(idx, 1);
    }
  });

  it('los auxiliares desde despachar persisten tras cerrar y reabrir; reversos y anticipos concilian', () => {
    const ctx = contexto();
    const cliente = crearContraparte(ctx.db, { nombre: 'Cliente Persistente', esCliente: true, esProveedor: false, responsable: 'p' });
    const venta = registrarVenta(ctx.db, {
      contraparteId: cliente,
      fechaOperacion: '2026-12-01',
      concepto: 'Venta persistente',
      tipoIngreso: 'oym',
      base: '300.00',
      tasa: '0',
      claveIdempotencia: 'v-pers',
      responsable: 'p'
    });
    registrarCobro(ctx.db, {
      fechaOperacion: '2026-12-05',
      contraparteId: cliente,
      cuentaDestinoId: idCuenta(ctx.db, '1101'),
      monto: '350.00',
      concepto: 'Cobro con excedente',
      aplicaciones: [{ documentoTipo: 'venta', documentoId: venta.id, monto: '300.00' }],
      claveIdempotencia: 'cob-pers',
      responsable: 'p'
    });

    const desdeDespacho = despachar(ctx, 'auxiliar:contrapartes', undefined) as { clientes: Array<{ saldoMinor: string }>; conciliaMayor: boolean };
    expect(desdeDespacho.clientes).toHaveLength(0);
    expect(desdeDespacho.conciliaMayor).toBe(true);
    ctx.db.close();
    const idx = abiertas.findIndex(d => !d.open);
    if (idx >= 0) {
      abiertas.splice(idx, 1);
    }

    const ctxReabierto = contexto();
    const trasReabrir = despachar(ctxReabierto, 'auxiliar:contrapartes', undefined) as { clientes: unknown[]; conciliaMayor: boolean };
    expect(trasReabrir.clientes).toHaveLength(0);
    expect(trasReabrir.conciliaMayor).toBe(true);

    const venta2 = registrarVenta(ctxReabierto.db, {
      contraparteId: cliente,
      fechaOperacion: '2026-12-10',
      concepto: 'Venta a anular',
      tipoIngreso: 'instalaciones',
      base: '50.00',
      tasa: '0',
      claveIdempotencia: 'v-anul',
      responsable: 'p'
    });
    anularDocumento(ctxReabierto.db, 'venta', venta2.id, 'p', 'motivo sintético');
    const trasAnular = auxiliarContrapartes(ctxReabierto.db);
    expect(trasAnular.conciliaMayor).toBe(true);
    ctxReabierto.db.close();
    const idx2 = abiertas.findIndex(d => !d.open);
    if (idx2 >= 0) {
      abiertas.splice(idx2, 1);
    }
  });
});
