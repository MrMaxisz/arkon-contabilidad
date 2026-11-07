// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, getConfig } from '@testing-library/react';

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

describe('5C: subáreas de impuestos', () => {
  it('amplía la espera asíncrona sin cambiar las aserciones', () => {
    expect(getConfig().asyncUtilTimeout).toBe(8000);
  });

  it('separa las cuatro áreas, conserva los borradores y los avisos legales de seguridad', async () => {
    render(<Impuestos />);
    expect(screen.getAllByRole('tab')).toHaveLength(4);
    expect(screen.getByRole('tab', { name: 'Configuración' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe('impuestos-tab-configuracion');
    expect(screen.queryByRole('heading', { name: 'Libros y conciliación de IVA' })).toBeNull();
    expect(screen.getByText(/Una futura inscripción configura una vigencia/).className).toBe('aviso seguridad');
    await screen.findByText(/PENDIENTE del contador responsable/);
    fireEvent.change(screen.getByLabelText('Fuente oficial'), { target: { value: 'Fuente sintética' } });

    fireEvent.click(screen.getByRole('tab', { name: 'Libros' }));
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1);
    expect(screen.getByRole('heading', { name: 'Libros y conciliación de IVA' })).toBeTruthy();
    fireEvent.change(selectorMes(), { target: { value: '2026-09' } });

    fireEvent.click(screen.getByRole('tab', { name: 'Retenciones' }));
    expect(screen.getByText(/Registro de control con base, regla/).className).toBe('aviso seguridad');
    fireEvent.change(screen.getByLabelText('Base'), { target: { value: '100.00' } });

    fireEvent.click(screen.getByRole('tab', { name: 'Anexos' }));
    expect(screen.getByText(/Estructura oficial F-07 v14/).className).toBe('aviso seguridad');
    expect(screen.getByText(/El anexo F-14 sigue el mismo bloqueo de activación formal/).className).toBe('aviso seguridad');
    expect((screen.getByRole('button', { name: 'Guardar anexo de presentación…' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Período del anexo (AAAA-MM)'), { target: { value: '2026-11' } });

    fireEvent.click(screen.getByRole('tab', { name: 'Configuración' }));
    expect((screen.getByLabelText('Fuente oficial') as HTMLInputElement).value).toBe('Fuente sintética');
    fireEvent.click(screen.getByRole('tab', { name: 'Libros' }));
    expect(selectorMes().value).toBe('2026-09');
    fireEvent.click(screen.getByRole('tab', { name: 'Retenciones' }));
    expect((screen.getByLabelText('Base') as HTMLInputElement).value).toBe('100.00');
    fireEvent.click(screen.getByRole('tab', { name: 'Anexos' }));
    expect((screen.getByLabelText('Período del anexo (AAAA-MM)') as HTMLInputElement).value).toBe('2026-11');
    expect(invocar.mock.calls.some(([comando]) => /crear|registrar|Completar|exportar/.test(comando))).toBe(false);
  });

  it('permite recorrer las pestañas con flechas, Inicio y Fin', async () => {
    render(<Impuestos />);
    const configuracion = screen.getByRole('tab', { name: 'Configuración' });
    configuracion.focus();
    fireEvent.keyDown(configuracion, { key: 'ArrowLeft' });
    const anexos = screen.getByRole('tab', { name: 'Anexos' });
    expect(document.activeElement).toBe(anexos);
    expect(anexos.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(anexos, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(configuracion);
    fireEvent.keyDown(configuracion, { key: 'End' });
    expect(document.activeElement).toBe(anexos);
    fireEvent.keyDown(anexos, { key: 'Home' });
    expect(document.activeElement).toBe(configuracion);
    expect(configuracion.tabIndex).toBe(0);
    expect(anexos.tabIndex).toBe(-1);
    await screen.findByText(/PENDIENTE del contador responsable/);
  });
});

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
    fireEvent.click(screen.getByRole('tab', { name: 'Libros' }));
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
    fireEvent.click(screen.getByRole('tab', { name: 'Libros' }));
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
    fireEvent.click(screen.getByRole('tab', { name: 'Libros' }));
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

describe('decimoctava revisión: estado de resultados asociado al mes vigente', () => {
  it('la respuesta tardía de septiembre no reemplaza el resultado de octubre', async () => {
    const pendientes: Array<Resolver> = [];
    invocar.mockImplementation((comando: string, datos?: unknown) => {
      if (comando === 'reporte:estadoResultados') {
        const mesPedido = (datos as { mes: string }).mes;
        return new Promise(resolve => {
          pendientes.push(() => resolve({
            mes: mesPedido,
            filas: [{ codigo: '4101', nombre: `Ingreso ${mesPedido}`, tipo: 'ingreso', importeMinor: mesPedido === '2026-10' ? '200.00' : '100.00' }],
            ingresosMinor: mesPedido === '2026-10' ? '200.00' : '100.00',
            costosGastosMinor: '0.00',
            resultadoMinor: mesPedido === '2026-10' ? '200.00' : '100.00'
          }));
        });
      }
      return baseMockResolve(comando, datos);
    });

    render(<Impuestos />);
    fireEvent.click(screen.getByRole('tab', { name: 'Libros' }));
    fireEvent.change(selectorMes(), { target: { value: '2026-09' } });
    const llamadasSept = invocar.mock.calls.filter(c => c[0] === 'reporte:estadoResultados').length;
    await waitFor(() => expect(pendientes).toHaveLength(llamadasSept));

    fireEvent.change(selectorMes(), { target: { value: '2026-10' } });
    await waitFor(() => expect(pendientes.length).toBeGreaterThanOrEqual(llamadasSept + 1));

    const indiceOctubre = pendientes.length - 1;
    pendientes[indiceOctubre]?.();
    await waitFor(() => screen.getByText('Estado de resultados de 2026-10'));
    expect(screen.getAllByText('$200.00').length).toBeGreaterThan(0);

    pendientes[llamadasSept - 1]?.();
    await new Promise(r => setTimeout(r, 30));
    expect(screen.getByText('Estado de resultados de 2026-10')).toBeTruthy();
    expect(screen.getAllByText('$200.00').length).toBeGreaterThan(0);
    expect(screen.queryByText('Estado de resultados de 2026-09')).toBeNull();
    expect(screen.queryAllByText('$100.00')).toHaveLength(0);
  });

  it('cambiar de mes limpia el estado de resultados visible y muestra el del mes nuevo', async () => {
    invocar.mockImplementation((comando: string, datos?: unknown) => {
      if (comando === 'reporte:estadoResultados') {
        const mesPedido = (datos as { mes: string }).mes;
        const esSeptiembre = mesPedido === '2026-09';
        return Promise.resolve({
          mes: mesPedido,
          filas: [],
          ingresosMinor: esSeptiembre ? '50.00' : '20.00',
          costosGastosMinor: '0.00',
          resultadoMinor: esSeptiembre ? '50.00' : '20.00'
        });
      }
      return baseMockResolve(comando, datos);
    });

    render(<Impuestos />);
    fireEvent.click(screen.getByRole('tab', { name: 'Libros' }));
    fireEvent.change(selectorMes(), { target: { value: '2026-09' } });
    await waitFor(() => screen.getByText('Estado de resultados de 2026-09'));
    expect(screen.getAllByText('$50.00').length).toBeGreaterThan(0);
    fireEvent.change(selectorMes(), { target: { value: '2026-10' } });
    await waitFor(() => screen.getByText('Estado de resultados de 2026-10'));
    expect(screen.queryByText('Estado de resultados de 2026-09')).toBeNull();
    expect(screen.queryAllByText('$50.00')).toHaveLength(0);
    expect(screen.getAllByText('$20.00').length).toBeGreaterThan(0);
  });
});
