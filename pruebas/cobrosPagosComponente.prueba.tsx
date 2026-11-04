// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

const invocar = vi.hoisted(() => vi.fn());

vi.mock('../src/renderer/api', () => ({
  api: () => ({ invocar: (comando: string, datos?: unknown) => invocar(comando, datos) })
}));

import CobrosPagos from '../src/renderer/vistas/CobrosPagos';

type Resolver = (valor: unknown) => void;

function combos(): Array<HTMLSelectElement> {
  return screen.getAllByRole('combobox') as Array<HTMLSelectElement>;
}

function textos(): Array<HTMLInputElement> {
  return screen.getAllByRole('textbox') as Array<HTMLInputElement>;
}

const CONTRAPARTES = [
  { id: 1, nombre: 'Cliente Alfa', esCliente: true, esProveedor: false },
  { id: 2, nombre: 'Cliente Beta', esCliente: true, esProveedor: false }
];

const VENTA = {
  id: 5,
  folio: 'V-000001',
  concepto: 'Venta sintética',
  contraparteId: 1,
  contraparteNombre: 'Cliente Alfa',
  totalMinor: '100.00',
  saldoMinor: '100.00',
  estado: 'registrada'
};

function baseMockResolve(comando: string): Promise<unknown> {
  switch (comando) {
    case 'contraparte:listar':
      return Promise.resolve(CONTRAPARTES);
    case 'cuenta:listar':
      return Promise.resolve([]);
    case 'venta:listar':
      return Promise.resolve([VENTA]);
    case 'compra:listar':
      return Promise.resolve([]);
    default:
      return Promise.resolve([]);
  }
}

beforeEach(() => {
  invocar.mockReset();
  invocar.mockImplementation((comando: string) => baseMockResolve(comando));
});

afterEach(() => {
  cleanup();
});

describe('décima revisión: saldo visible de anticipos', () => {
  it('tras aplicar un anticipo, el saldo mostrado se consulta de nuevo y refleja el remanente', async () => {
    let llamadasSaldo = 0;
    invocar.mockImplementation((comando: string) => {
      if (comando === 'anticipo:saldo') {
        return Promise.resolve({ saldoMinor: llamadasSaldo++ === 0 ? '10000' : '7000' });
      }
      return baseMockResolve(comando);
    });

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
});

describe('undécima revisión: respuestas de selecciones anteriores', () => {
  it('la respuesta tardía de Alfa no reemplaza el saldo visible de Beta', async () => {
    const pendientes: Array<Resolver> = [];
    invocar.mockImplementation((comando: string) => {
      if (comando === 'anticipo:saldo') {
        return new Promise(resolve => {
          pendientes.push(resolve);
        });
      }
      return baseMockResolve(comando);
    });

    render(<CobrosPagos />);
    fireEvent.change(combos()[0], { target: { value: 'anticipo' } });
    await waitFor(() => expect(combos()).toHaveLength(4));

    fireEvent.change(combos()[2], { target: { value: '1' } });
    await waitFor(() => expect(pendientes).toHaveLength(1));

    fireEvent.change(combos()[2], { target: { value: '2' } });
    await waitFor(() => expect(pendientes).toHaveLength(2));

    pendientes[1]?.({ saldoMinor: '5000' });
    await waitFor(() => screen.getByText('Saldo de anticipo disponible: $50.00.'));

    pendientes[0]?.({ saldoMinor: '10000' });
    await new Promise(r => setTimeout(r, 30));
    expect(screen.getByText('Saldo de anticipo disponible: $50.00.')).toBeTruthy();
    expect(screen.queryByText('Saldo de anticipo disponible: $100.00.')).toBeNull();
  });

  it('durante una aplicación pendiente los selectores se bloquean y no puede reactivarse una selección anterior', async () => {
    let llamadasSaldo = 0;
    const resolverAplicar: Array<Resolver> = [];
    invocar.mockImplementation((comando: string) => {
      if (comando === 'anticipo:saldo') {
        return Promise.resolve({ saldoMinor: llamadasSaldo++ === 0 ? '10000' : '7000' });
      }
      if (comando === 'anticipo:aplicar') {
        return new Promise(resolve => {
          resolverAplicar.push(resolve);
        });
      }
      return baseMockResolve(comando);
    });

    render(<CobrosPagos />);
    fireEvent.change(combos()[0], { target: { value: 'anticipo' } });
    await waitFor(() => expect(combos()).toHaveLength(4));
    fireEvent.change(combos()[2], { target: { value: '1' } });
    await waitFor(() => screen.getByText('Saldo de anticipo disponible: $100.00.'));

    fireEvent.change(combos()[3], { target: { value: '5' } });
    fireEvent.change(textos()[1], { target: { value: '30.00' } });
    fireEvent.change(textos()[0], { target: { value: 'prueba' } });
    fireEvent.click(screen.getByRole('button', { name: 'Registrar' }));

    await waitFor(() => expect(combos()[2].disabled).toBe(true));
    expect(combos()[0].disabled).toBe(true);
    expect(combos()[1].disabled).toBe(true);

    resolverAplicar[0]?.({ folio: 'AAP-000001' });
    await waitFor(() => screen.getByText('Saldo de anticipo disponible: $70.00.'));
    await waitFor(() => expect(combos()[2].disabled).toBe(false));
  });

  it('quitar la selección invalida la consulta pendiente y no muestra saldo sin contraparte', async () => {
    const pendientes: Array<Resolver> = [];
    invocar.mockImplementation((comando: string) => {
      if (comando === 'anticipo:saldo') {
        return new Promise(resolve => {
          pendientes.push(resolve);
        });
      }
      return baseMockResolve(comando);
    });

    render(<CobrosPagos />);
    fireEvent.change(combos()[0], { target: { value: 'anticipo' } });
    await waitFor(() => expect(combos()).toHaveLength(4));
    fireEvent.change(combos()[2], { target: { value: '1' } });
    await waitFor(() => expect(pendientes).toHaveLength(1));

    fireEvent.change(combos()[2], { target: { value: '0' } });
    await waitFor(() => expect(screen.queryByText(/Saldo de anticipo disponible/)).toBeNull());
    expect(screen.queryByText('Consultando saldo de anticipo…')).toBeNull();

    pendientes[0]?.({ saldoMinor: '10000' });
    await new Promise(r => setTimeout(r, 30));
    expect(screen.queryByText(/Saldo de anticipo disponible/)).toBeNull();
  });
});
