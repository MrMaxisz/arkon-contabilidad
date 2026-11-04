// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

const invocar = vi.hoisted(() => vi.fn());

vi.mock('../src/renderer/api', () => ({
  api: () => ({ invocar: (comando: string, datos?: unknown) => invocar(comando, datos) })
}));

import CobrosPagos from '../src/renderer/vistas/CobrosPagos';

const saldos = ['10000', '7000'];
let llamadasSaldo = 0;

function combos(): Array<HTMLSelectElement> {
  return screen.getAllByRole('combobox') as Array<HTMLSelectElement>;
}

function textos(): Array<HTMLInputElement> {
  return screen.getAllByRole('textbox') as Array<HTMLInputElement>;
}

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  invocar.mockReset();
  llamadasSaldo = 0;
  invocar.mockImplementation((comando: string) => {
    switch (comando) {
      case 'contraparte:listar':
        return Promise.resolve([
          { id: 1, nombre: 'Cliente Exclusivo', esCliente: true, esProveedor: false },
          { id: 2, nombre: 'Proveedor Exclusivo', esCliente: false, esProveedor: true }
        ]);
      case 'cuenta:listar':
        return Promise.resolve([]);
      case 'venta:listar':
        return Promise.resolve([
          {
            id: 5,
            folio: 'V-000001',
            concepto: 'Venta sintética',
            contraparteId: 1,
            contraparteNombre: 'Cliente Exclusivo',
            totalMinor: '100.00',
            saldoMinor: '100.00',
            estado: 'registrada'
          }
        ]);
      case 'compra:listar':
        return Promise.resolve([]);
      case 'anticipo:saldo':
        return Promise.resolve({ saldoMinor: saldos[Math.min(llamadasSaldo++, saldos.length - 1)] });
      case 'anticipo:aplicar':
        return Promise.resolve({ folio: 'AAP-000001' });
      default:
        return Promise.resolve([]);
    }
  });
});

describe('décima revisión: saldo visible de anticipos', () => {
  it('tras aplicar un anticipo, el saldo mostrado se consulta de nuevo y refleja el remanente', async () => {
    render(<CobrosPagos />);

    fireEvent.change(combos()[0], { target: { value: 'anticipo' } });
    await waitFor(() => expect(combos()).toHaveLength(4));

    fireEvent.change(combos()[2], { target: { value: '1' } });
    await waitFor(() => screen.getByText('Saldo de anticipo disponible: $100.00.'));
    expect(invocar.mock.calls.filter(c => c[0] === 'anticipo:saldo')).toHaveLength(1);

    fireEvent.change(combos()[3], { target: { value: '5' } });
    fireEvent.change(textos()[1], { target: { value: '30.00' } });
    fireEvent.change(textos()[0], { target: { value: 'prueba' } });
    fireEvent.click(screen.getByRole('button', { name: 'Registrar' }));

    await waitFor(() => screen.getByText('Saldo de anticipo disponible: $70.00.'));
    const consultasSaldo = invocar.mock.calls.filter(c => c[0] === 'anticipo:saldo');
    expect(consultasSaldo).toHaveLength(2);
    expect(consultasSaldo[1]?.[1]).toEqual({ tipo: 'cliente', contraparteId: 1 });

    const aplicaciones = invocar.mock.calls.filter(c => c[0] === 'anticipo:aplicar');
    expect(aplicaciones).toHaveLength(1);
    expect(aplicaciones[0]?.[1]).toMatchObject({
      tipo: 'cliente',
      contraparteId: 1,
      documentoTipo: 'venta',
      documentoId: 5,
      monto: '30.00'
    });
  });

  it('cambiar de contraparte descarta la respuesta obsoleta y muestra el saldo de la selección actual', async () => {
    render(<CobrosPagos />);

    fireEvent.change(combos()[0], { target: { value: 'anticipo' } });
    await waitFor(() => expect(combos()).toHaveLength(4));
    fireEvent.change(combos()[2], { target: { value: '1' } });
    await waitFor(() => screen.getByText('Saldo de anticipo disponible: $100.00.'));

    invocar.mockImplementation((comando: string) => {
      if (comando === 'anticipo:saldo') {
        return new Promise(resolve => setTimeout(() => resolve({ saldoMinor: '5000' }), 50));
      }
      return Promise.resolve([]);
    });
    fireEvent.change(combos()[1], { target: { value: 'proveedor' } });
    fireEvent.change(combos()[2], { target: { value: '2' } });
    await waitFor(() => screen.getByText('Saldo de anticipo disponible: $50.00.'));
    expect(screen.queryByText('Saldo de anticipo disponible: $100.00.')).toBeNull();
  });
});
