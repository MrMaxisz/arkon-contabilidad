// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';

const invocar = vi.hoisted(() => vi.fn());

vi.mock('../src/renderer/api', () => ({
  api: () => ({
    invocar: (comando: string, datos?: unknown) => invocar(comando, datos)
  })
}));

import Ventas from '../src/renderer/vistas/Ventas';

const VENTA = {
  id: 5, folio: 'V-000002', fecha: '2026-11-10', concepto: 'Venta sintética QA',
  contraparteId: 1, contraparteNombre: 'Cliente QA', totalMinor: '7.25', saldoMinor: '7.25',
  estado: 'registrada', clasificacionDocumento: null, proyectoId: null
};

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  invocar.mockReset();
  invocar.mockImplementation((comando: string) => {
    switch (comando) {
      case 'contraparte:listar':
        return Promise.resolve([{ id: 1, nombre: 'Cliente QA', esCliente: true, esProveedor: false }]);
      case 'proyecto:listar':
        return Promise.resolve([]);
      case 'venta:listar':
        return Promise.resolve([VENTA]);
      default:
        return Promise.resolve([]);
    }
  });
});

afterEach(() => {
  cleanup();
});

async function abrirDialogo() {
  render(<Ventas />);
  return await screen.findByText('Anular');
}

describe('auditoría 51: diálogo de anulación en Ventas', () => {
  it('abrir el diálogo NO invoca el comando; cancelar tampoco cambia nada', async () => {
    const btn = await abrirDialogo();
    await waitFor(() => screen.getByText('V-000002'));
    fireEvent.click(btn);

    await waitFor(() => screen.getByText(/Anular venta V-000002/));
    expect(screen.getAllByText(/\$7\.25/).length).toBeGreaterThan(0);
    expect(screen.getByText(/reverso\s+contable/)).toBeTruthy();
    // Diálogo abierto: el comando NO fue invocado.
    expect(invocar.mock.calls.some(c => c[0] === 'documento:anular')).toBe(false);

    fireEvent.click(screen.getByText('Cancelar'));
    await waitFor(() => expect(screen.queryByText(/Anular venta V-000002/)).toBeNull());
    expect(invocar.mock.calls.some(c => c[0] === 'documento:anular')).toBe(false);
  });

  it('faltan motivo o responsable: no se invoca el comando y se muestra el error', async () => {
    fireEvent.click(await abrirDialogo());
    await waitFor(() => screen.getByText(/Anular venta V-000002/));

    const form = screen.getByText(/Sí, anular V-000002/).closest('form')!;
    const dentro = within(form);
    fireEvent.submit(form);
    const dialogo = screen.getByRole('dialog');
    await waitFor(() => within(dialogo).getByRole('alert'));
    expect(within(dialogo).getByRole('alert').textContent).toContain('mínimo 10 caracteres');
    expect(invocar.mock.calls.some(c => c[0] === 'documento:anular')).toBe(false);

    fireEvent.change(dentro.getByLabelText(/Motivo de la anulación\n?/), { target: { value: 'motivo sintético de prueba' } });
    fireEvent.change(dentro.getByLabelText(/Responsable\n?/), { target: { value: '' } });
    fireEvent.submit(form);
    await waitFor(() => within(screen.getByRole('dialog')).getByRole('alert'));
    expect(within(screen.getByRole('dialog')).getByRole('alert').textContent).toContain('exige responsable');
    expect(invocar.mock.calls.some(c => c[0] === 'documento:anular')).toBe(false);
  });

  it('confirmación invoca una sola vez con motivo/responsable y muestra aviso de anulación', async () => {
    let anulada = false;
    invocar.mockImplementation((comando: string) => {
      if (comando === 'documento:anular') {
        anulada = true;
        return Promise.resolve({ ok: true });
      }
      if (comando === 'venta:listar') {
        return Promise.resolve([anulada ? { ...VENTA, estado: 'anulada' } : VENTA]);
      }
      return Promise.resolve([]);
    });
    fireEvent.click(await abrirDialogo());
    await waitFor(() => screen.getByText(/Anular venta V-000002/));

    const form = screen.getByText(/Sí, anular V-000002/).closest('form')!;
    const dentro = within(form);
    fireEvent.change(dentro.getByLabelText(/Motivo de la anulación\n?/), { target: { value: 'motivo sintético de anulación completa' } });
    fireEvent.change(dentro.getByLabelText(/Responsable\n?/), { target: { value: 'qa' } });
    fireEvent.submit(form);
    fireEvent.submit(form);

    await waitFor(() => screen.getByText(/V-000002 anulada con reverso contable/));
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ block: 'center' });
    const llamadas = invocar.mock.calls.filter(c => c[0] === 'documento:anular');
    expect(llamadas.length).toBe(1);
    const payload = llamadas[0]![1] as Record<string, unknown>;
    expect(payload.tipo).toBe('venta');
    expect(payload.documentoId).toBe(5);
    expect(payload.motivo).toBe('motivo sintético de anulación completa');
    expect(payload.responsable).toBe('qa');
  });

  it('rechazo con formato real de IPC: el texto exacto queda dentro del diálogo sin prefijo técnico', async () => {
    invocar.mockImplementation((comando: string) => {
      if (comando === 'documento:anular') {
        return Promise.reject(new Error("Error invoking remote method 'arkon': Error: El documento V-000002 tiene cobros o pagos aplicados; anúlelos primero"));
      }
      if (comando === 'venta:listar') {
        return Promise.resolve([VENTA]);
      }
      return Promise.resolve([]);
    });
    fireEvent.click(await abrirDialogo());
    await waitFor(() => screen.getByText(/Anular venta V-000002/));
    const form = screen.getByText(/Sí, anular V-000002/).closest('form')!;
    const dentro = within(form);
    fireEvent.change(dentro.getByLabelText(/Motivo de la anulación\n?/), { target: { value: 'motivo sintético de rechazo' } });
    fireEvent.change(dentro.getByLabelText(/Responsable\n?/), { target: { value: 'qa' } });
    fireEvent.submit(form);

    const dialogo = screen.getByRole('dialog');
    await waitFor(() => within(dialogo).getByRole('alert'));
    expect(within(dialogo).getByRole('alert').textContent)
      .toBe('El documento V-000002 tiene cobros o pagos aplicados; anúlelos primero');
    expect(screen.queryByText(/anulada con reverso/)).toBeNull();
  });
});
