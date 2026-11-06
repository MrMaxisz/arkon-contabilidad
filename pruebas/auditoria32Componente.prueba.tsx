// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

const invocar = vi.hoisted(() => vi.fn());
const guardarCsvAuxiliarMock = vi.hoisted(() => vi.fn());

vi.mock('../src/renderer/api', () => ({
  api: () => ({
    invocar: (comando: string, datos?: unknown) => invocar(comando, datos),
    guardarCsvAuxiliar: (solicitud: unknown) => guardarCsvAuxiliarMock(solicitud)
  })
}));

import Reportes from '../src/renderer/vistas/Reportes';

interface Detalleveloz {
  contraparteId: number;
  contraparteNombre: string;
  saldoMinor: string;
  documentos: Array<{ folio: string; fecha: string; concepto: string; totalMinor: string; aplicadoMinor: string; saldoMinor: string }>;
}

function detalle(id: number, folio: string, saldo: string): Detalleveloz {
  return {
    contraparteId: id,
    contraparteNombre: `Cliente ${id}`,
    saldoMinor: saldo,
    documentos: [{ folio, fecha: '2026-11-01', concepto: `Documento ${folio}`, totalMinor: saldo, aplicadoMinor: '0.00', saldoMinor: saldo }]
  };
}

beforeEach(() => {
  invocar.mockReset();
  guardarCsvAuxiliarMock.mockReset();
});

afterEach(() => {
  cleanup();
});

function configurarApi(deferidas: Map<number, (r: Detalleveloz) => void>) {
  invocar.mockImplementation((comando: string, datos?: { contraparteId?: number; hastaFecha?: string }) => {
    switch (comando) {
      case 'contraparte:listar':
        return Promise.resolve([
          { id: 1, nombre: 'Cliente Uno', esCliente: true, esProveedor: false },
          { id: 2, nombre: 'Cliente Dos', esCliente: true, esProveedor: false }
        ]);
      case 'auxiliar:contrapartes':
        return Promise.resolve({ clientes: [], proveedores: [], totalClientesMinor: '0.00', totalProveedoresMinor: '0.00', conciliaMayor: true });
      case 'auxiliar:efectivo':
        return Promise.resolve({ cuentas: [], totalMinor: '0.00', conciliaMayor: true });
      case 'auxiliar:contraparteDetalle': {
        const id = Number(datos?.contraparteId);
        return new Promise<Detalleveloz>(resolve => {
          deferidas.set(id, resolve);
          if (id === 2) {
            resolve(detalle(2, 'V-000002', '20.00'));
          }
        });
      }
      default:
        return Promise.resolve([]);
    }
  });
}

describe('auditoría 32: respuestas tardías y exportación con corte en Reportes', () => {
  it('una respuesta tardía de otra consulta no reemplaza el detalle visible', async () => {
    const deferidas = new Map<number, (r: Detalleveloz) => void>();
    configurarApi(deferidas);
    render(<Reportes />);

    const selector = await screen.findByLabelText(/^Cliente$/);
    fireEvent.change(selector, { target: { value: '1' } });
    expect(deferidas.has(1)).toBe(true);

    fireEvent.change(selector, { target: { value: '2' } });
    await waitFor(() => screen.getByText('Documento V-000002'));
    expect(screen.queryByText('Documento V-000001')).toBeNull();

    const resolver1 = deferidas.get(1);
    resolver1?.(detalle(1, 'V-000001', '10.00'));
    await new Promise(r => setTimeout(r, 20));

    expect(screen.getByText('Documento V-000002')).toBeTruthy();
    expect(screen.queryByText('Documento V-000001')).toBeNull();
    expect(screen.getByText(/Saldo al corte/)).toBeTruthy();
  });

  it('el botón de detalle envía contraparte y corte al guardar y los errores no dejan detalle viejo', async () => {
    const deferidas = new Map<number, (r: Detalleveloz) => void>();
    configurarApi(deferidas);
    guardarCsvAuxiliarMock.mockResolvedValue({ guardado: true, ruta: 'C:\\sintetico\\auxiliar.csv' });
    render(<Reportes />);

    const selector = await screen.findByLabelText(/^Cliente$/);
    fireEvent.change(selector, { target: { value: '2' } });
    const corte = screen.getByLabelText(/Fecha de corte/) as HTMLInputElement;
    fireEvent.change(corte, { target: { value: '2026-11-30' } });
    await waitFor(() => screen.getByText('Documento V-000002'));

    fireEvent.click(screen.getByText(/Guardar detalle al corte seleccionado…/));
    await waitFor(() => expect(guardarCsvAuxiliarMock).toHaveBeenCalledWith({
      tipo: 'cliente',
      alcance: 'detalle',
      contraparteId: 2,
      hastaFecha: '2026-11-30'
    }));
    expect(screen.getByText(/Detalle guardado en/)).toBeTruthy();

    invocar.mockImplementation((comando: string) => {
      if (comando === 'auxiliar:contraparteDetalle') {
        return Promise.reject(new Error('fallo sintético'));
      }
      return Promise.resolve([]);
    });
    fireEvent.change(selector, { target: { value: '1' } });
    await waitFor(() => screen.getByText(/Error al consultar detalle: fallo sintético/));
    expect(screen.queryByText('Documento V-000002')).toBeNull();
    expect(screen.queryByText(/Saldo al corte/)).toBeNull();
  });
});
