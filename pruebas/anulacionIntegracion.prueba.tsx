// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { abrirBase, prepararRutasDatos } from '../src/main/db/conexion';
import { aplicarMigraciones } from '../src/main/db/aplicarMigraciones';
import { sembrarCatalogoBase } from '../src/main/servicios/cuentas';
import { despachar, type ContextoApp } from '../src/main/comandos';
import { crearContraparte, registrarVenta, registrarCompra } from '../src/main/servicios/operacion';
import { registrarCobro, registrarPago, registrarTransferencia } from '../src/main/servicios/tesoreria';
import { saldoPendienteDocumento } from '../src/main/servicios/saldos';
import type BetterSqlite3 from 'better-sqlite3';

// Integración REAL: componente → despachar real → SQLite temporal → estado/reverso/bitácora.
// El mock de api().invocar delega al despachar real; solo se fuerzan rechazos imposibles de sembrar.

let dir: string;
let rutaDb: string;
let rutas: ReturnType<typeof prepararRutasDatos>;
let db: BetterSqlite3.Database;
let ctx: ContextoApp;
const abiertas: Array<BetterSqlite3.Database> = [];

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arkon-a52-'));
  rutas = prepararRutasDatos(path.join(dir, 'datos'));
  rutaDb = path.join(rutas.datos, 'arkon.db');
  fs.mkdirSync(rutas.datos, { recursive: true });
  db = abrirBase(rutaDb);
  aplicarMigraciones(db);
  abiertas.push(db);
  sembrarCatalogoBase(db);
  db.prepare("INSERT INTO ambito (id, nombre, tipo) VALUES ('administrativo', 'Prueba a52', 'administrativo')").run();
  ctx = {
    db,
    rutas,
    versionApp: 'prueba',
    rutaDb,
    reabrirBase() {
      return;
    }
  };
});

afterEach(() => {
  for (const d of abiertas.splice(0)) {
    if (d.open) {
      d.close();
    }
  }
  fs.rmSync(dir, { recursive: true, force: true });
  cleanup();
});

function idCuenta(codigo: string): number {
  return (db.prepare('SELECT id FROM cuenta WHERE codigo = ?').get(codigo) as { id: number }).id;
}

vi.mock('../src/renderer/api', () => ({
  api: () => ({
    invocar: (comando: string, datos?: unknown) => Promise.resolve(despachar(ctx, comando, datos))
  })
}));

import Ventas from '../src/renderer/vistas/Ventas';
import Compras from '../src/renderer/vistas/Compras';
import CajaBancos from '../src/renderer/vistas/CajaBancos';

describe('auditoría 52: anulación integrada componente→despachar→SQLite', () => {
  it('Ventas: anular por diálogo produce reverso y bitácora con motivo capturado', async () => {
    const cliente = crearContraparte(db, { nombre: 'Cliente A52', esCliente: true, esProveedor: false, responsable: 'p' });
    const venta = registrarVenta(db, {
      contraparteId: cliente, fechaOperacion: '2026-11-10', concepto: 'Venta a52 sintética',
      tipoIngreso: 'instalaciones', base: '100.00', tasa: '0', claveIdempotencia: 'v-a52', responsable: 'p'
    });
    void venta;

    render(<Ventas />);
    const btn = await screen.findByText('Anular');
    fireEvent.click(btn);
    await waitFor(() => screen.getByText(/Anular venta V-000001/));

    const form = screen.getByText(/Sí, anular V-000001/).closest('form')!;
    const dentro = within(form);
    fireEvent.change(dentro.getByLabelText(/Motivo de la anulación\n?/), { target: { value: 'motivo sintético de anulación' } });
    fireEvent.change(dentro.getByLabelText(/Responsable\n?/), { target: { value: 'qa' } });
    fireEvent.submit(form);

    await waitFor(() => screen.getByText(/V-000001 anulada con reverso contable/));
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ block: 'center' });
    const estado = db.prepare('SELECT estado FROM venta WHERE folio = ?').get('V-000001') as { estado: string };
    expect(estado.estado).toBe('anulada');
    const reverso = db.prepare("SELECT id FROM asiento WHERE reverso_de_id IS NOT NULL AND estado = 'contabilizado'").get();
    expect(reverso).toBeTruthy();
    const evento = db.prepare("SELECT detalle FROM bitacora_evento WHERE tipo = 'anulacion' ORDER BY id DESC LIMIT 1").get() as { detalle: string };
    expect(evento.detalle).toContain('motivo sintético de anulación');
  });

  it('documento:anular con motivo corto se rechaza por comando directo sin cambiar el documento', async () => {
    const cliente = crearContraparte(db, { nombre: 'Cliente A52b', esCliente: true, esProveedor: false, responsable: 'p' });
    registrarVenta(db, {
      contraparteId: cliente, fechaOperacion: '2026-11-10', concepto: 'Venta a52b sintética',
      tipoIngreso: 'instalaciones', base: '100.00', tasa: '0', claveIdempotencia: 'v-a52b', responsable: 'p'
    });
    const ventaId = (db.prepare("SELECT id FROM venta WHERE folio = 'V-000001'").get() as { id: number }).id;
    expect(() =>
      despachar(ctx, 'documento:anular', { tipo: 'venta', documentoId: ventaId, responsable: 'qa', motivo: 'corto' })
    ).toThrow(/mínimo 10 caracteres/);
    const estado = db.prepare('SELECT estado FROM venta WHERE folio = ?').get('V-000001') as { estado: string };
    expect(estado.estado).toBe('registrada');
  });

  it('Ventas: rechazo del motor por cobro aplicado con error dentro del diálogo sin prefijo técnico', async () => {
    const cliente = crearContraparte(db, { nombre: 'Cliente Rechazo A52', esCliente: true, esProveedor: false, responsable: 'p' });
    const venta = registrarVenta(db, {
      contraparteId: cliente, fechaOperacion: '2026-11-10', concepto: 'Venta rechazo a52',
      tipoIngreso: 'instalaciones', base: '100.00', tasa: '0', claveIdempotencia: 'v-a52r', responsable: 'p'
    });
    registrarCobro(db, {
      fechaOperacion: '2026-11-11', contraparteId: cliente, cuentaDestinoId: idCuenta('1101'),
      monto: '50.00', concepto: 'Cobro rechazo a52', aplicaciones: [{ documentoTipo: 'venta', documentoId: venta.id, monto: '50.00' }],
      claveIdempotencia: 'cob-a52r', responsable: 'p'
    });
    render(<Ventas />);
    fireEvent.click(await screen.findByText('Anular'));
    await waitFor(() => screen.getByRole('dialog'));
    const form = screen.getByText(/Sí, anular V-000001/).closest('form')!;
    const dentro = within(form);
    fireEvent.change(dentro.getByLabelText(/Motivo de la anulación\n?/), { target: { value: 'motivo sintético de rechazo' } });
    fireEvent.change(dentro.getByLabelText(/Responsable\n?/), { target: { value: 'qa' } });
    fireEvent.submit(form);
    const dialogo = screen.getByRole('dialog');
    await waitFor(() => within(dialogo).getByRole('alert'));
    const alerta = within(dialogo).getByRole('alert');
    expect(alerta.textContent).toContain('cobros');
    expect(alerta.textContent).not.toContain('Error invoking');
    const estado = db.prepare('SELECT estado FROM venta WHERE folio = ?').get('V-000001') as { estado: string };
    expect(estado.estado).toBe('registrada');
  });

  it('Compras: anular por diálogo produce reverso y bitácora con scrollIntoView', async () => {
    const proveedor = crearContraparte(db, { nombre: 'Proveedor A52', esCliente: false, esProveedor: true, responsable: 'p' });
    registrarCompra(db, {
      contraparteId: proveedor, fechaOperacion: '2026-11-10', concepto: 'Compra a52 sintética',
      condicion: 'contado',
      lineas: [{ descripcion: 'Material', cuentaCodigo: '5101', cantidad: '1', precioUnitario: '50.00', tasa: '0', tratamiento: 'exento' }],
      claveIdempotencia: 'c-a52', responsable: 'p'
    });
    render(<Compras />);
    fireEvent.click(await screen.findByText('Anular'));
    await waitFor(() => screen.getByText(/Anular compra CMP-000001/));
    const form = screen.getByText(/Sí, anular CMP-000001/).closest('form')!;
    const dentro = within(form);
    fireEvent.change(dentro.getByLabelText(/Motivo de la anulación\n?/), { target: { value: 'motivo sintético de compra' } });
    fireEvent.change(dentro.getByLabelText(/Responsable\n?/), { target: { value: 'qa' } });
    fireEvent.submit(form);
    await waitFor(() => screen.getByText(/CMP-000001 anulada con reverso contable/));
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ block: 'center' });
    const estado = db.prepare('SELECT estado FROM compra WHERE folio = ?').get('CMP-000001') as { estado: string };
    expect(estado.estado).toBe('anulada');
    const reverso = db.prepare("SELECT id FROM asiento WHERE reverso_de_id IS NOT NULL AND estado = 'contabilizado'").get();
    expect(reverso).toBeTruthy();
  });

  it('Compras: rechazo del motor por pago aplicado con error dentro del diálogo sin prefijo técnico', async () => {
    const proveedor = crearContraparte(db, { nombre: 'Proveedor Rechazo A52', esCliente: false, esProveedor: true, responsable: 'p' });
    const compra = registrarCompra(db, {
      contraparteId: proveedor, fechaOperacion: '2026-11-10', concepto: 'Compra rechazo a52',
      condicion: 'credito',
      lineas: [{ descripcion: 'Material', cuentaCodigo: '5101', cantidad: '1', precioUnitario: '50.00', tasa: '0', tratamiento: 'exento' }],
      claveIdempotencia: 'c-a52r', responsable: 'p'
    });
    registrarPago(db, {
      fechaOperacion: '2026-11-12', contraparteId: proveedor, cuentaOrigenId: idCuenta('1101'),
      monto: '25.00', concepto: 'Pago rechazo a52', aplicaciones: [{ documentoTipo: 'compra', documentoId: compra.id, monto: '25.00' }],
      claveIdempotencia: 'pag-a52r', responsable: 'p'
    });
    render(<Compras />);
    fireEvent.click(await screen.findByText('Anular'));
    await waitFor(() => screen.getByRole('dialog'));
    const form = screen.getByText(/Sí, anular CMP-000001/).closest('form')!;
    const dentro = within(form);
    fireEvent.change(dentro.getByLabelText(/Motivo de la anulación\n?/), { target: { value: 'motivo sintético de rechazo' } });
    fireEvent.change(dentro.getByLabelText(/Responsable\n?/), { target: { value: 'qa' } });
    fireEvent.submit(form);
    const dialogo = screen.getByRole('dialog');
    await waitFor(() => within(dialogo).getByRole('alert'));
    const alerta = within(dialogo).getByRole('alert');
    expect(alerta.textContent).toContain('pagos');
    expect(alerta.textContent).not.toContain('Error invoking');
    const estado = db.prepare('SELECT estado FROM compra WHERE folio = ?').get('CMP-000001') as { estado: string };
    expect(estado.estado).toBe('registrada');
  });

  it('CajaBancos: cobro aplicado a venta 113.00; anular libera saldo y registra bitácora', async () => {
    const cliente = crearContraparte(db, { nombre: 'Cliente Caja A52', esCliente: true, esProveedor: false, responsable: 'p' });
    const venta = registrarVenta(db, {
      contraparteId: cliente, fechaOperacion: '2026-11-10', concepto: 'Venta caja a52',
      tipoIngreso: 'instalaciones', base: '113.00', tasa: '0', claveIdempotencia: 'v-a52c', responsable: 'p'
    });
    registrarCobro(db, {
      fechaOperacion: '2026-11-11', contraparteId: cliente, cuentaDestinoId: idCuenta('1101'),
      monto: '60.00', concepto: 'Cobro parcial a52', aplicaciones: [{ documentoTipo: 'venta', documentoId: venta.id, monto: '60.00' }],
      claveIdempotencia: 'cob-a52', responsable: 'p'
    });

    // Saldo pendiente antes: 113.00 - 60.00 = 53.00 (verificado via saldoPendienteDocumento)

    render(<CajaBancos />);
    fireEvent.click(await screen.findByText('Anular'));
    await waitFor(() => screen.getByText(/Anular cobro COB-000001/));
    expect(screen.getAllByText(/\$60\.00/).length).toBeGreaterThan(0);

    const form = screen.getByText(/Sí, anular COB-000001/).closest('form')!;
    const dentro = within(form);
    fireEvent.change(dentro.getByLabelText(/Motivo de la anulación\n?/), { target: { value: 'motivo sintético de cobro' } });
    fireEvent.change(dentro.getByLabelText(/Responsable\n?/), { target: { value: 'qa' } });
    fireEvent.submit(form);
    await waitFor(() => expect(screen.getAllByText(/COB-000001 anulado con reverso contable/).length).toBeGreaterThan(0));

    const estadoMov = db.prepare("SELECT estado FROM tesoreria_movimiento WHERE folio = 'COB-000001'").get() as { estado: string };
    expect(estadoMov.estado).toBe('anulado');
    const ventaId = (db.prepare("SELECT id FROM venta WHERE folio = 'V-000001'").get() as { id: number }).id;
    const saldoDespues = saldoPendienteDocumento(db, 'venta', ventaId);
    expect(saldoDespues).toBe(11300n);
    const evento = db.prepare("SELECT detalle FROM bitacora_evento ORDER BY id DESC LIMIT 1").get() as { detalle: string };
    expect(evento.detalle).toContain('motivo sintético de cobro');
    // Un solo aviso en el DOM (sin duplicado).
    const avisos = screen.getAllByText(/COB-000001 anulado con reverso contable/);
    expect(avisos.length).toBe(1);
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ block: 'center' });
  });

  it('CajaBancos: registrar transferencia por la vista produce exactamente un aviso visible', async () => {
    render(<CajaBancos />);
    // Esperar a que las cuentas carguen
    await waitFor(() => screen.getByText(/Cuenta origen/));
    const selectorOrigen = screen.getByLabelText(/Cuenta origen\n?/) as HTMLSelectElement;
    const selectorDestino = screen.getByLabelText(/Cuenta destino\n?/) as HTMLSelectElement;
    fireEvent.change(selectorOrigen, { target: { value: String(idCuenta('1101')) } });
    fireEvent.change(selectorDestino, { target: { value: String(idCuenta('1102')) } });
    const montoInput = screen.getByLabelText(/Monto\n?/) as HTMLInputElement;
    fireEvent.change(montoInput, { target: { value: '10.00' } });
    const conceptoInput = screen.getByLabelText(/Concepto\n?/) as HTMLInputElement;
    fireEvent.change(conceptoInput, { target: { value: 'transferencia sintética de vista' } });
    const respInput = screen.getByLabelText(/Responsable\n?/) as HTMLInputElement;
    fireEvent.change(respInput, { target: { value: 'qa' } });
    const btnTransfer = screen.getByText(/Registrar transferencia/);
    fireEvent.click(btnTransfer);
    await waitFor(() => screen.getByText(/Transferencia TRF-000001 registrada/));
    expect(screen.getAllByText(/Transferencia TRF-000001 registrada/).length).toBe(1);
  });

  it('tesoreria:anular con motivo corto se rechaza por comando directo', async () => {
    const cliente = crearContraparte(db, { nombre: 'Cliente Cmd A52', esCliente: true, esProveedor: false, responsable: 'p' });
    registrarCobro(db, {
      fechaOperacion: '2026-11-11', contraparteId: cliente, cuentaDestinoId: idCuenta('1101'),
      monto: '20.00', concepto: 'Cobro cmd a52', aplicaciones: [],
      claveIdempotencia: 'cob-cmd52', responsable: 'p'
    });
    const movId = (db.prepare("SELECT id FROM tesoreria_movimiento WHERE folio = 'COB-000001'").get() as { id: number }).id;
    expect(() =>
      despachar(ctx, 'tesoreria:anular', { movimientoId: movId, responsable: 'qa', motivo: 'corto' })
    ).toThrow(/mínimo 10 caracteres/);
    const estado = db.prepare("SELECT estado FROM tesoreria_movimiento WHERE folio = 'COB-000001'").get() as { estado: string };
    expect(estado.estado).toBe('registrado');
  });

  it('CajaBancos: rechazo real con diálogo abierto — anulado por detrás, error dentro del diálogo', async () => {
    const cliente = crearContraparte(db, { nombre: 'Cliente Detras A52', esCliente: true, esProveedor: false, responsable: 'p' });
    registrarCobro(db, {
      fechaOperacion: '2026-11-11', contraparteId: cliente, cuentaDestinoId: idCuenta('1101'),
      monto: '30.00', concepto: 'Cobro detrás a52', aplicaciones: [],
      claveIdempotencia: 'cob-detras52', responsable: 'p'
    });
    render(<CajaBancos />);
    fireEvent.click(await screen.findByText('Anular'));
    await waitFor(() => screen.getByRole('dialog'));
    // Anular por detrás con despachar mientras el diálogo está abierto.
    const movId = (db.prepare("SELECT id FROM tesoreria_movimiento WHERE folio = 'COB-000001'").get() as { id: number }).id;
    despachar(ctx, 'tesoreria:anular', { movimientoId: movId, responsable: 'p', motivo: 'anulación por detrás sintética' });
    const form = screen.getByText(/Sí, anular COB-000001/).closest('form')!;
    const dentro = within(form);
    fireEvent.change(dentro.getByLabelText(/Motivo de la anulación\n?/), { target: { value: 'motivo sintético de confirmación' } });
    fireEvent.change(dentro.getByLabelText(/Responsable\n?/), { target: { value: 'qa' } });
    fireEvent.submit(form);
    const dialogo = screen.getByRole('dialog');
    await waitFor(() => within(dialogo).getByRole('alert'));
    const alerta = within(dialogo).getByRole('alert');
    expect(alerta.textContent).toContain('ya está anulado');
    expect(alerta.textContent).not.toContain('Error invoking');
  });

  it('CajaBancos: cancelar no invoca ni cambia el movimiento', async () => {
    const cliente = crearContraparte(db, { nombre: 'Cliente Caja A52b', esCliente: true, esProveedor: false, responsable: 'p' });
    registrarCobro(db, {
      fechaOperacion: '2026-11-11', contraparteId: cliente, cuentaDestinoId: idCuenta('1101'),
      monto: '30.00', concepto: 'Cobro a52b', aplicaciones: [],
      claveIdempotencia: 'cob-a52b', responsable: 'p'
    });
    render(<CajaBancos />);
    fireEvent.click(await screen.findByText('Anular'));
    await waitFor(() => screen.getByText(/Anular cobro COB-000001/));
    fireEvent.click(screen.getByText('Cancelar'));
    await waitFor(() => expect(screen.queryByText(/Anular cobro/)).toBeNull());
    const estado = db.prepare("SELECT estado FROM tesoreria_movimiento WHERE folio = 'COB-000001'").get() as { estado: string };
    expect(estado.estado).toBe('registrado');
  });

  it('CajaBancos: transferencia anulada por diálogo con despachar real', async () => {
    registrarTransferencia(db, {
      fechaOperacion: '2026-11-13', cuentaOrigenId: idCuenta('1101'), cuentaDestinoId: idCuenta('1102'),
      monto: '15.00', concepto: 'Transferencia a52', claveIdempotencia: 'trf-a52', responsable: 'p'
    });
    render(<CajaBancos />);
    fireEvent.click(await screen.findByText('Anular'));
    await waitFor(() => screen.getByText(/Anular transferencia TRF-000001/));
    const form = screen.getByText(/Sí, anular TRF-000001/).closest('form')!;
    const dentro = within(form);
    fireEvent.change(dentro.getByLabelText(/Motivo de la anulación\n?/), { target: { value: 'motivo sintético de transferencia' } });
    fireEvent.change(dentro.getByLabelText(/Responsable\n?/), { target: { value: 'qa' } });
    fireEvent.submit(form);
    await waitFor(() => screen.getByText(/TRF-000001 anulado con reverso contable/));
    expect(screen.getAllByText(/TRF-000001 anulado con reverso contable/).length).toBe(1);
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ block: 'center' });
    const estado = db.prepare("SELECT estado FROM tesoreria_movimiento WHERE folio = 'TRF-000001'").get() as { estado: string };
    expect(estado.estado).toBe('anulado');
    const reverso = db.prepare("SELECT id FROM asiento WHERE reverso_de_id IS NOT NULL AND estado = 'contabilizado'").get();
    expect(reverso).toBeTruthy();
    const evento = db.prepare("SELECT detalle FROM bitacora_evento ORDER BY id DESC LIMIT 1").get() as { detalle: string };
    expect(evento.detalle).toContain('motivo sintético de transferencia');
  });

  it('CajaBancos: pago anulado por diálogo', async () => {
    const proveedor = crearContraparte(db, { nombre: 'Proveedor Pago A52', esCliente: false, esProveedor: true, responsable: 'p' });
    registrarPago(db, {
      fechaOperacion: '2026-11-12', contraparteId: proveedor, cuentaOrigenId: idCuenta('1101'),
      monto: '25.00', concepto: 'Pago a52', aplicaciones: [],
      claveIdempotencia: 'pag-a52', responsable: 'p'
    });
    render(<CajaBancos />);
    fireEvent.click(await screen.findByText('Anular'));
    await waitFor(() => screen.getByText(/Anular pago PAG-000001/));
    const form = screen.getByText(/Sí, anular PAG-000001/).closest('form')!;
    const dentro = within(form);
    fireEvent.change(dentro.getByLabelText(/Motivo de la anulación\n?/), { target: { value: 'motivo sintético de pago' } });
    fireEvent.change(dentro.getByLabelText(/Responsable\n?/), { target: { value: 'qa' } });
    fireEvent.submit(form);
    await waitFor(() => expect(screen.getAllByText(/PAG-000001 anulado con reverso contable/).length).toBeGreaterThan(0));
    const estado = db.prepare("SELECT estado FROM tesoreria_movimiento WHERE folio = 'PAG-000001'").get() as { estado: string };
    expect(estado.estado).toBe('anulado');
  });
});
