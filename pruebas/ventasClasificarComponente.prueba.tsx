// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

const invocar = vi.hoisted(() => vi.fn());

vi.mock('../src/renderer/api', () => ({
  api: () => ({ invocar: (comando: string, datos?: unknown) => invocar(comando, datos) })
}));

import Ventas from '../src/renderer/vistas/Ventas';

function combos(): Array<HTMLSelectElement> {
  return screen.getAllByRole('combobox') as Array<HTMLSelectElement>;
}

function textos(): Array<HTMLInputElement> {
  return screen.getAllByRole('textbox') as Array<HTMLInputElement>;
}

function ventaSintetica(id: number, folio: string, clasificacion: string | null, tipo: string | null) {
  return {
    id,
    folio,
    fecha: '2026-10-01',
    concepto: `Venta ${id}`,
    contraparteId: 1,
    contraparteNombre: 'Cliente Sintético',
    totalMinor: '100.00',
    saldoMinor: '100.00',
    estado: 'registrada',
    clasificacionDocumento: clasificacion,
    tipoDocumento: tipo
  };
}

beforeEach(() => {
  invocar.mockReset();
  invocar.mockImplementation((comando: string) => {
    switch (comando) {
      case 'contraparte:listar':
        return Promise.resolve([{ id: 1, nombre: 'Cliente Sintético', esCliente: true, esProveedor: false }]);
      case 'proyecto:listar':
        return Promise.resolve([]);
      case 'venta:listar':
        return Promise.resolve([]);
      default:
        return Promise.resolve([]);
    }
  });
});

afterEach(() => {
  cleanup();
});

describe('decimocuarta revisión: diálogo de clasificación precargado', () => {
  it('abrir el diálogo conserva la clasificación conocida y exige el tipo faltante', async () => {
    invocar.mockImplementation((comando: string) => {
      if (comando === 'venta:listar') {
        return Promise.resolve([ventaSintetica(5, 'V-000001', 'consumidor_final', null)]);
      }
      if (comando === 'contraparte:listar') {
        return Promise.resolve([{ id: 1, nombre: 'Cliente Sintético', esCliente: true, esProveedor: false }]);
      }
      return Promise.resolve([]);
    });

    render(<Ventas />);
    await waitFor(() => screen.getByText('V-000001'));
    fireEvent.click(screen.getByRole('button', { name: 'Clasificar' }));

    await waitFor(() => screen.getByRole('button', { name: 'Completar clasificación' }));
    const dialogoCombos = combos();
    const selectClasificacion = dialogoCombos[dialogoCombos.length - 2];
    const selectTipo = dialogoCombos[dialogoCombos.length - 1];
    expect(selectClasificacion.value).toBe('consumidor_final');
    expect(selectTipo.value).toBe('');

    fireEvent.change(selectTipo, { target: { value: 'recibo' } });
    const dialogoTextos = textos();
    const motivo = dialogoTextos.find(t => t.placeholder === '' && t.required && t.value === '') ?? dialogoTextos[dialogoTextos.length - 1];
    fireEvent.change(motivo, { target: { value: 'completar tipo sintético' } });
    const responsables = screen.getAllByDisplayValue ? [] : [];
    void responsables;
    const responsableInput = screen.getAllByRole('textbox').find(t => t.closest('form')?.textContent?.includes('Clasificar'));
    if (responsableInput) {
      fireEvent.change(responsableInput, { target: { value: 'prueba' } });
    }
    fireEvent.click(screen.getByRole('button', { name: 'Completar clasificación' }));

    await waitFor(() => {
      const llamada = invocar.mock.calls.find(c => c[0] === 'documento:clasificar');
      expect(llamada).toBeTruthy();
      expect(llamada?.[1]).toMatchObject({
        tipo: 'venta',
        documentoId: 5,
        clasificacionDocumento: 'consumidor_final',
        tipoDocumento: 'recibo'
      });
    });
  });

  it('documentos consecutivos no heredan la selección del anterior', async () => {
    invocar.mockImplementation((comando: string) => {
      if (comando === 'venta:listar') {
        return Promise.resolve([
          ventaSintetica(5, 'V-000001', 'consumidor_final', null),
          ventaSintetica(6, 'V-000002', null, 'factura')
        ]);
      }
      if (comando === 'documento:clasificar') {
        return Promise.resolve({ ok: true });
      }
      if (comando === 'contraparte:listar') {
        return Promise.resolve([{ id: 1, nombre: 'Cliente Sintético', esCliente: true, esProveedor: false }]);
      }
      return Promise.resolve([]);
    });

    render(<Ventas />);
    await waitFor(() => screen.getByText('V-000001'));
    const botonesClasificar = screen.getAllByRole('button', { name: 'Clasificar' });
    fireEvent.click(botonesClasificar[0]);
    await waitFor(() => screen.getByRole('button', { name: 'Completar clasificación' }));
    let dialogoCombos = combos();
    expect(dialogoCombos[dialogoCombos.length - 2].value).toBe('consumidor_final');
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    fireEvent.click(botonesClasificar[1]);
    await waitFor(() => screen.getByRole('button', { name: 'Completar clasificación' }));
    dialogoCombos = combos();
    expect(dialogoCombos[dialogoCombos.length - 2].value).toBe('');
    expect(dialogoCombos[dialogoCombos.length - 1].value).toBe('factura');
  });
});
