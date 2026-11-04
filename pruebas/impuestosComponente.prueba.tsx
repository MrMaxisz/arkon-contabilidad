// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

const invocar = vi.hoisted(() => vi.fn());

vi.mock('../src/renderer/api', () => ({
  api: () => ({ invocar: (comando: string, datos?: unknown) => invocar(comando, datos) })
}));

import Impuestos from '../src/renderer/vistas/Impuestos';

type Resolver = (valor: unknown) => void;

function baseMockResolve(comando: string, datos?: unknown): Promise<unknown> {
  switch (comando) {
    case 'vigencia:listar':
      return Promise.resolve([]);
    case 'contraparte:listar':
      return Promise.resolve([]);
    case 'retencion:listar':
      return Promise.resolve([]);
    case 'fiscal:politicas':
      return Promise.resolve({ anticipoHechoGenerador: 'pendiente', ivaComprasCreditoFiscal: false, perfilIvaInscritoConfig: false });
    case 'fiscal:libroVentas':
      return Promise.resolve({ filas: [], baseMinor: '0.00', ivaMinor: '0.00', totalMinor: '0.00' });
    case 'fiscal:libroCompras':
      return Promise.resolve({ filas: [], baseMinor: '0.00', ivaMinor: '0.00', totalMinor: '0.00' });
    case 'reporte:estadoResultados':
      return Promise.resolve({
        mes: '2026-10',
        filas: [],
        ingresosMinor: '0.00',
        costosGastosMinor: '0.00',
        resultadoMinor: '0.00'
      });
    case 'fiscal:conciliar':
      return Promise.resolve({
        mes: '2026-10',
        debitoLibroMinor: '0.00',
        debitoMayorMinor: '0.00',
        conciliaDebito: true,
        ivaDocumentadoComprasMinor: '0.00',
        creditoAcreditableLibroMinor: '0.00',
        creditoMayorMinor: '0.00',
        conciliaCredito: true,
        nota: 'nota sintética'
      });
    default:
      return Promise.resolve([]);
  }
}

beforeEach(() => {
  invocar.mockReset();
  invocar.mockImplementation((comando: string, datos?: unknown) => baseMockResolve(comando, datos));
});

afterEach(() => {
  cleanup();
});

function botonExportarVentas(): HTMLButtonElement {
  return screen.getByRole('button', { name: /Exportar libro de ventas/ }) as HTMLButtonElement;
}

function selectorMes(): HTMLInputElement {
  return screen.getByLabelText(/Mes/) as HTMLInputElement;
}

function textoExportacion(): string | null {
  const el = screen.queryByText((_: unknown, elemento: Element | null) =>
    elemento?.tagName === 'P' && Boolean(elemento.textContent?.includes('Exportación de'))
  );
  return el?.textContent ?? null;
}

describe('decimotercera revisión: CSV asociado a mes y tipo', () => {
  it('cambiar de mes limpia el CSV mostrado', async () => {
    invocar.mockImplementation((comando: string, datos?: unknown) => {
      if (comando === 'fiscal:exportarCsv') {
        return Promise.resolve({
          csv: 'folio,fecha,clasificacion,tipo_documento,base,iva,total\nV-000001,2026-09-01,contribuyente,ccf,100.00,0.00,100.00',
          version: 'interna-v1',
          advertencia: 'advertencia sintética'
        });
      }
      return baseMockResolve(comando, datos);
    });

    render(<Impuestos />);
    fireEvent.change(selectorMes(), { target: { value: '2026-09' } });
    fireEvent.click(botonExportarVentas());
    await waitFor(() => expect(textoExportacion()).toContain('Exportación de 2026-09 · libro de ventas'));
    expect(screen.getByText(/V-000001,2026-09-01/)).toBeTruthy();

    fireEvent.change(selectorMes(), { target: { value: '2026-10' } });
    await waitFor(() => expect(textoExportacion()).toBeNull());
    expect(screen.queryByText(/V-000001,2026-09-01/)).toBeNull();
  });

  it('la respuesta tardía de septiembre no reemplaza el CSV de octubre', async () => {
    const pendientes: Array<Resolver> = [];
    invocar.mockImplementation((comando: string, datos?: unknown) => {
      if (comando === 'fiscal:exportarCsv') {
        const datosExport = datos as { tipo: string; mes: string };
        return new Promise(resolve => {
          pendientes.push(() => resolve({
            csv: `folio,fecha\nFILA-${datosExport.mes}-${datosExport.tipo}`,
            version: 'interna-v1',
            advertencia: 'advertencia sintética'
          }));
        });
      }
      return baseMockResolve(comando, datos);
    });

    render(<Impuestos />);
    fireEvent.change(selectorMes(), { target: { value: '2026-09' } });
    fireEvent.click(botonExportarVentas());
    await waitFor(() => expect(pendientes).toHaveLength(1));

    fireEvent.change(selectorMes(), { target: { value: '2026-10' } });
    fireEvent.click(botonExportarVentas());
    await waitFor(() => expect(pendientes).toHaveLength(2));

    pendientes[1]?.();
    await waitFor(() => expect(textoExportacion()).toContain('Exportación de 2026-10 · libro de ventas'));
    expect(screen.getByText(/FILA-2026-10-venta/)).toBeTruthy();

    pendientes[0]?.();
    await new Promise(r => setTimeout(r, 30));
    expect(screen.getByText(/FILA-2026-10-venta/)).toBeTruthy();
    expect(screen.queryByText(/FILA-2026-09-venta/)).toBeNull();
    expect(textoExportacion()).toContain('Exportación de 2026-10');
  });

  it('una respuesta de ventas tardía no reemplaza la exportación posterior de compras', async () => {
    const pendientes: Array<Resolver> = [];
    invocar.mockImplementation((comando: string, datos?: unknown) => {
      if (comando === 'fiscal:exportarCsv') {
        const datosExport = datos as { tipo: string; mes: string };
        return new Promise(resolve => {
          pendientes.push(() => resolve({
            csv: `folio,fecha\nFILA-${datosExport.mes}-${datosExport.tipo}`,
            version: 'interna-v1',
            advertencia: 'advertencia sintética'
          }));
        });
      }
      return baseMockResolve(comando, datos);
    });

    render(<Impuestos />);
    fireEvent.change(selectorMes(), { target: { value: '2026-10' } });
    fireEvent.click(botonExportarVentas());
    await waitFor(() => expect(pendientes).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: /Exportar libro de compras/ }));
    await waitFor(() => expect(pendientes).toHaveLength(2));

    pendientes[1]?.();
    await waitFor(() => expect(textoExportacion()).toContain('Exportación de 2026-10 · libro de compras'));
    expect(screen.getByText(/FILA-2026-10-compra/)).toBeTruthy();

    pendientes[0]?.();
    await new Promise(r => setTimeout(r, 30));
    expect(screen.getByText(/FILA-2026-10-compra/)).toBeTruthy();
    expect(screen.queryByText(/FILA-2026-10-venta/)).toBeNull();
  });
});
