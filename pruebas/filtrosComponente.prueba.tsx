// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// Pruebas de filtros: timeout ampliado (fallaban a 5000 ms con el equipo cargado, auditoría 72).
vi.setConfig({ testTimeout: 20000 });

import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

const invocar = vi.hoisted(() => vi.fn());

vi.mock('../src/renderer/api', () => ({
  api: () => ({ invocar: (comando: string, datos?: unknown) => invocar(comando, datos) })
}));

import Ventas from '../src/renderer/vistas/Ventas';
import Compras from '../src/renderer/vistas/Compras';

function ventaSintetica(id: number, folio: string) {
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
    clasificacionDocumento: 'contribuyente',
    tipoDocumento: 'factura'
  };
}

function compraSintetica(id: number, folio: string) {
  return {
    id,
    folio,
    fecha: '2026-10-01',
    concepto: `Compra ${id}`,
    contraparteId: 1,
    contraparteNombre: 'Prov Sintético',
    totalMinor: '100.00',
    saldoMinor: '100.00',
    estado: 'registrada',
    clasificacionDocumento: 'contribuyente',
    tipoDocumento: 'factura'
  };
}

function baseMock() {
  invocar.mockImplementation((comando: string, datos?: unknown) => {
    switch (comando) {
      case 'contraparte:listar':
        return Promise.resolve([
          { id: 1, nombre: 'Cliente Sintético', esCliente: true, esProveedor: true }
        ]);
      case 'proyecto:listar':
        return Promise.resolve([]);
      case 'cuenta:listar':
        return Promise.resolve([]);
      case 'venta:listar': {
        const opciones = datos as { desde?: number } | undefined;
        const desde = opciones?.desde ?? 0;
        const total: Array<ReturnType<typeof ventaSintetica>> = [];
        for (let i = 1; i <= 101; i++) {
          total.push(ventaSintetica(i, `V-${String(i).padStart(6, '0')}`));
        }
        return Promise.resolve(total.slice(desde, desde + 100));
      }
      case 'compra:listar': {
        const opciones = datos as { desde?: number } | undefined;
        const desde = opciones?.desde ?? 0;
        const total: Array<ReturnType<typeof compraSintetica>> = [];
        for (let i = 1; i <= 101; i++) {
          total.push(compraSintetica(i, `CMP-${String(i).padStart(6, '0')}`));
        }
        return Promise.resolve(total.slice(desde, desde + 100));
      }
      default:
        return Promise.resolve([]);
    }
  });
}

beforeEach(() => {
  invocar.mockReset();
  baseMock();
});

afterEach(() => {
  cleanup();
});

function llamadasListado(comando: string): Array<Record<string, unknown> | undefined> {
  return invocar.mock.calls.filter(c => c[0] === comando).map(c => c[1] as Record<string, unknown> | undefined);
}

describe('decimoquinta revisión: filtros y paginación conectados', () => {
  it('Ventas: cambiar de mes consulta con ese mes y Siguientes cambia el offset', async () => {
    render(<Ventas />);
    await waitFor(() => screen.getByText('V-000100'));
    expect(llamadasListado('venta:listar')).toHaveLength(1);

    const filtroMes = screen.getByLabelText(/Filtrar por mes/) as HTMLInputElement;
    fireEvent.change(filtroMes, { target: { value: '2026-09' } });
    await waitFor(() => expect(llamadasListado('venta:listar').length).toBeGreaterThanOrEqual(2));
    const llamadas = llamadasListado('venta:listar');
    const ultima = llamadas[llamadas.length - 1];
    expect(ultima).toMatchObject({ mes: '2026-09', limite: 100 });
    expect(ultima?.desde ?? 0).toBe(0);

    await waitFor(() => screen.getByText('Ventas de 2026-09'));
    fireEvent.click(screen.getByRole('button', { name: 'Siguientes' }));
    await waitFor(() => expect(llamadasListado('venta:listar').length).toBeGreaterThanOrEqual(3));
    const llamadas2 = llamadasListado('venta:listar');
    expect(llamadas2[llamadas2.length - 1]).toMatchObject({ mes: '2026-09', desde: 100 });
    await waitFor(() => screen.getByText('V-000101'));
  });

  it('Ventas: cambiar de mes desde una página avanzada reinicia a la primera página y muestra sus documentos', async () => {
    render(<Ventas />);
    await waitFor(() => screen.getByText('V-000100'));
    fireEvent.click(screen.getByRole('button', { name: 'Siguientes' }));
    await waitFor(() => screen.getByText('V-000101'));

    const filtroMes = screen.getByLabelText(/Filtrar por mes/) as HTMLInputElement;
    fireEvent.change(filtroMes, { target: { value: '2026-09' } });
    const llamadas = llamadasListado('venta:listar');
    const ultima = llamadas[llamadas.length - 1];
    expect(ultima).toMatchObject({ mes: '2026-09', desde: 0 });
    await waitFor(() => screen.getByText('V-000001'));
    expect(screen.queryByText('V-000101')).toBeNull();
  });

  it('Compras: cambiar de mes consulta con ese mes y Siguientes cambia el offset', async () => {
    render(<Compras />);
    await waitFor(() => screen.getByText('CMP-000100'));
    expect(llamadasListado('compra:listar')).toHaveLength(1);

    const filtroMes = screen.getByLabelText(/Filtrar por mes/) as HTMLInputElement;
    fireEvent.change(filtroMes, { target: { value: '2026-09' } });
    await waitFor(() => expect(llamadasListado('compra:listar').length).toBeGreaterThanOrEqual(2));
    const llamadas = llamadasListado('compra:listar');
    expect(llamadas[llamadas.length - 1]).toMatchObject({ mes: '2026-09', limite: 100 });

    await waitFor(() => screen.getByText('Compras de 2026-09'));
    fireEvent.click(screen.getByRole('button', { name: 'Siguientes' }));
    await waitFor(() => expect(llamadasListado('compra:listar').length).toBeGreaterThanOrEqual(3));
    const llamadas2 = llamadasListado('compra:listar');
    expect(llamadas2[llamadas2.length - 1]).toMatchObject({ mes: '2026-09', desde: 100 });
    await waitFor(() => screen.getByText('CMP-000101'));
  });

  it('Compras: cambiar de mes desde una página avanzada reinicia a la primera página y muestra sus documentos', async () => {
    render(<Compras />);
    await waitFor(() => screen.getByText('CMP-000100'));
    fireEvent.click(screen.getByRole('button', { name: 'Siguientes' }));
    await waitFor(() => screen.getByText('CMP-000101'));

    const filtroMes = screen.getByLabelText(/Filtrar por mes/) as HTMLInputElement;
    fireEvent.change(filtroMes, { target: { value: '2026-09' } });
    const llamadas = llamadasListado('compra:listar');
    const ultima = llamadas[llamadas.length - 1];
    expect(ultima).toMatchObject({ mes: '2026-09', desde: 0 });
    await waitFor(() => screen.getByText('CMP-000001'));
    expect(screen.queryByText('CMP-000101')).toBeNull();
  });

  it('Cobros y pagos: las consultas sin opciones de venta/compra no fallan y muestran documentos', async () => {
    const { default: CobrosPagos } = await import('../src/renderer/vistas/CobrosPagos');
    render(<CobrosPagos />);
    await waitFor(() => expect(llamadasListado('venta:listar')).toHaveLength(1));
    await waitFor(() => expect(llamadasListado('compra:listar')).toHaveLength(1));
    expect(screen.queryByText(/Payload inválido/)).toBeNull();
    const modo = (screen.getAllByRole('combobox') as Array<HTMLSelectElement>)[0];
    fireEvent.change(modo, { target: { value: 'cobro' } });
    await waitFor(() => expect(screen.queryByText(/Payload inválido/)).toBeNull());
  });
});
