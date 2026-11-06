// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';

// Auditoría 71 (P2-71-2 y P1-71-1): Escape en Compras, CajaBancos y Contabilidad,
// y Escape inerte con la anulación de asiento en curso.

const invocar = vi.hoisted(() => vi.fn());

vi.mock('../src/renderer/api', () => ({
  api: () => ({
    invocar: (comando: string, datos?: unknown) => invocar(comando, datos)
  })
}));

import Compras from '../src/renderer/vistas/Compras';
import CajaBancos from '../src/renderer/vistas/CajaBancos';
import Contabilidad from '../src/renderer/vistas/Contabilidad';

const COMPRA = {
  id: 3, folio: 'CMP-000001', fecha: '2026-11-10', concepto: 'Compra sintética a71',
  contraparteNombre: 'Proveedor QA', totalMinor: '50.00', saldoMinor: '50.00',
  estado: 'registrada', clasificacionDocumento: null, tipoDocumento: null
};

const MOVIMIENTO = {
  id: 2, folio: 'COB-000001', tipo: 'cobro', fecha: '2026-11-11', concepto: 'Cobro sintético a71',
  contraparteNombre: 'Cliente QA', montoMinor: '30.00', estado: 'registrado'
};

const ASIENTO = {
  id: 7, folio: 'A-000001', fechaOperacion: '2026-11-10', concepto: 'Asiento sintético a71',
  estado: 'contabilizado', totalMinor: '100.00', reversoDeId: null
};

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  invocar.mockReset();
  invocar.mockImplementation((comando: string) => {
    switch (comando) {
      case 'compra:listar':
        return Promise.resolve([COMPRA]);
      case 'contraparte:listar':
        return Promise.resolve([{ id: 1, nombre: 'Proveedor QA', esCliente: false, esProveedor: true }]);
      case 'proyecto:listar':
        return Promise.resolve([]);
      case 'cuenta:listar':
        return Promise.resolve([{ id: 1, codigo: '1101', nombre: 'Efectivo', esGrupo: false }]);
      case 'asiento:listar':
        return Promise.resolve([ASIENTO]);
      case 'mayor:consultar':
        return Promise.resolve({ cuenta: null, movimientos: [], saldoMinor: '0.00' });
      case 'tesoreria:listar':
        return Promise.resolve([MOVIMIENTO]);
      case 'cuenta:listarTesoreria':
        return Promise.resolve([{ id: 1, codigo: '1101', nombre: 'Efectivo' }]);
      default:
        return Promise.resolve([]);
    }
  });
});

afterEach(() => {
  cleanup();
});

describe('auditoría 71: Escape en Compras', () => {
  it('Escape cierra el diálogo sin invocar y devuelve el foco al botón Anular', async () => {
    render(<Compras />);
    const btn = await screen.findByText('Anular');
    await waitFor(() => screen.getByText('CMP-000001'));
    fireEvent.click(btn);
    await waitFor(() => screen.getByRole('dialog'));
    const motivo = screen.getByLabelText(/Motivo de la anulación\n?/);
    motivo.focus();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(invocar.mock.calls.some(c => c[0] === 'documento:anular')).toBe(false);
    expect(document.activeElement).toBe(btn);
  });

  it('con la anulación en curso, Escape no hace nada y no se puede reenviar', async () => {
    let resolver: ((valor: unknown) => void) | null = null;
    invocar.mockImplementation((comando: string) => {
      if (comando === 'documento:anular') {
        return new Promise<unknown>(res => {
          resolver = res;
        });
      }
      if (comando === 'compra:listar') {
        return Promise.resolve([COMPRA]);
      }
      return Promise.resolve([]);
    });
    render(<Compras />);
    fireEvent.click(await screen.findByText('Anular'));
    await waitFor(() => screen.getByRole('dialog'));
    const form = screen.getByText(/Sí, anular CMP-000001/).closest('form')!;
    fireEvent.change(within(form).getByLabelText(/Motivo de la anulación\n?/), { target: { value: 'motivo sintético en curso' } });
    fireEvent.change(within(form).getByLabelText(/Responsable\n?/), { target: { value: 'qa' } });
    fireEvent.submit(form);
    await waitFor(() => expect(screen.getByText(/Anulando…/)).toBeTruthy());
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.submit(form);
    expect(invocar.mock.calls.filter(c => c[0] === 'documento:anular').length).toBe(1);
    resolver?.({ ok: true });
  });
});

describe('auditoría 71: Escape en CajaBancos', () => {
  it('Escape cierra el diálogo sin invocar y devuelve el foco al botón Anular', async () => {
    render(<CajaBancos />);
    const btn = await screen.findByText('Anular');
    await waitFor(() => screen.getByText('COB-000001'));
    fireEvent.click(btn);
    await waitFor(() => screen.getByRole('dialog'));
    const motivo = screen.getByLabelText(/Motivo de la anulación\n?/);
    motivo.focus();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(invocar.mock.calls.some(c => c[0] === 'tesoreria:anular')).toBe(false);
    expect(document.activeElement).toBe(btn);
  });

  it('con la anulación en curso, Escape no hace nada y no se puede reenviar', async () => {
    let resolver: ((valor: unknown) => void) | null = null;
    invocar.mockImplementation((comando: string) => {
      if (comando === 'tesoreria:anular') {
        return new Promise<unknown>(res => {
          resolver = res;
        });
      }
      if (comando === 'tesoreria:listar') {
        return Promise.resolve([MOVIMIENTO]);
      }
      return Promise.resolve([]);
    });
    render(<CajaBancos />);
    fireEvent.click(await screen.findByText('Anular'));
    await waitFor(() => screen.getByRole('dialog'));
    const form = screen.getByText(/Sí, anular COB-000001/).closest('form')!;
    fireEvent.change(within(form).getByLabelText(/Motivo de la anulación\n?/), { target: { value: 'motivo sintético en curso' } });
    fireEvent.change(within(form).getByLabelText(/Responsable\n?/), { target: { value: 'qa' } });
    fireEvent.submit(form);
    await waitFor(() => expect(screen.getByText(/Anulando…/)).toBeTruthy());
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.submit(form);
    expect(invocar.mock.calls.filter(c => c[0] === 'tesoreria:anular').length).toBe(1);
    resolver?.({ ok: true });
  });
});

describe('auditoría 71: Escape en Contabilidad', () => {
  it('Escape cierra el diálogo sin invocar y devuelve el foco al botón Anular', async () => {
    render(<Contabilidad alCambiar={() => undefined} />);
    const btn = await screen.findByText('Anular');
    await waitFor(() => screen.getByText('A-000001'));
    fireEvent.click(btn);
    await waitFor(() => screen.getByText(/Anular asiento A-000001/));
    const motivo = screen.getByLabelText(/Motivo \(obligatorio\)\n?/);
    motivo.focus();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByText(/Anular asiento/)).toBeNull());
    expect(invocar.mock.calls.some(c => c[0] === 'asiento:anular')).toBe(false);
    expect(document.activeElement).toBe(btn);
  });

  it('con la anulación de asiento en curso, Escape no hace nada y no se puede reenviar (P1-71-1)', async () => {
    let resolver: ((valor: unknown) => void) | null = null;
    invocar.mockImplementation((comando: string) => {
      if (comando === 'asiento:anular') {
        return new Promise<unknown>(res => {
          resolver = res;
        });
      }
      if (comando === 'asiento:listar') {
        return Promise.resolve([ASIENTO]);
      }
      if (comando === 'cuenta:listar') {
        return Promise.resolve([{ id: 1, codigo: '1101', nombre: 'Efectivo', esGroup: false }]);
      }
      return Promise.resolve([]);
    });
    render(<Contabilidad alCambiar={() => undefined} />);
    fireEvent.click(await screen.findByText('Anular'));
    await waitFor(() => screen.getByText(/Anular asiento A-000001/));
    const form = screen.getByText('Confirmar anulación').closest('form')!;
    fireEvent.change(screen.getByLabelText(/Motivo \(obligatorio\)\n?/), { target: { value: 'motivo sintético en curso' } });
    // responsable se toma del formulario de captura: se llena su input
    const responsable = screen.getByLabelText(/Responsable\n?/);
    fireEvent.change(responsable, { target: { value: 'qa' } });
    fireEvent.submit(form);
    await waitFor(() => expect(screen.getByText(/Anulando…/)).toBeTruthy());
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByText(/Anular asiento A-000001/)).toBeTruthy();
    fireEvent.submit(form);
    expect(invocar.mock.calls.filter(c => c[0] === 'asiento:anular').length).toBe(1);
    resolver?.({ ok: true });
  });
});
