// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { COMANDOS_PERMITIDOS } from '../src/preload/comandosPermitidos';

const invocar = vi.hoisted(() => vi.fn());

vi.mock('../src/renderer/api', () => ({
  api: () => ({
    invocar: (comando: string, datos?: unknown) => invocar(comando, datos)
  })
}));

import Cierre from '../src/renderer/vistas/Cierre';

beforeEach(() => {
  invocar.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('auditoría 32: vista Cierre y puente', () => {
  it('los comandos de apertura y cierre están permitidos en el preload', () => {
    expect(COMANDOS_PERMITIDOS.has('apertura:registrar')).toBe(true);
    expect(COMANDOS_PERMITIDOS.has('cierre:estado')).toBe(true);
    expect(COMANDOS_PERMITIDOS.has('cierre:ejercicio')).toBe(true);
    expect(COMANDOS_PERMITIDOS.has('cierre:reabrir')).toBe(true);
  });

  it('la vista consulta el estado, cierra el ejercicio y muestra el resultado persistido', async () => {
    invocar.mockImplementation((comando: string) => {
      if (comando === 'cierre:estado') {
        return Promise.resolve({
          anio: 2026,
          periodos: [{ id: 1, inicio: '2026-12-01', fin: '2026-12-31', estado: 'abierto' }],
          cuentasResultado: [{ codigo: '4101', nombre: 'Ingresos por instalaciones', tipo: 'ingreso', saldoMinor: '200.00' }],
          resultadoNetoMinor: '200.00',
          cierreExistente: null,
          periodoDiciembreAbierto: true
        });
      }
      if (comando === 'cierre:ejercicio') {
        return Promise.resolve({ folio: 'A-000003', duplicado: false, netoMinor: '200.00' });
      }
      return Promise.resolve({});
    });
    render(<Cierre />);

    fireEvent.change(screen.getByLabelText(/Año del ejercicio\n?/), { target: { value: '2026' } });
    await waitFor(() => screen.getByText(/Resultado neto del ejercicio: \$200\.00/));
    expect(invocar).toHaveBeenCalledWith('cierre:estado', { anio: 2026 });

    fireEvent.change(screen.getByLabelText(/^Responsable$/), { target: { value: 'contador sintético' } });
    fireEvent.change(screen.getByLabelText(/^Motivo$/), { target: { value: 'cierre sintético' } });
    fireEvent.change(screen.getByLabelText(/Referencia de soporte\n?/), { target: { value: 'soporte sintético' } });
    fireEvent.click(screen.getByText(/Contabilizar cierre y cerrar diciembre/));

    await waitFor(() => screen.getByText(/Ejercicio 2026 cerrado con asiento A-000003/));
    expect(invocar).toHaveBeenCalledWith('cierre:ejercicio', expect.objectContaining({
      anio: 2026,
      responsable: 'contador sintético',
      referencia: 'soporte sintético'
    }));
  });

  it('un fallo del cierre se muestra sin marcarse como cerrado', async () => {
    invocar.mockImplementation((comando: string) => {
      if (comando === 'cierre:estado') {
        return Promise.resolve({
          anio: 2026,
          periodos: [{ id: 1, inicio: '2026-12-01', fin: '2026-12-31', estado: 'abierto' }],
          cuentasResultado: [],
          resultadoNetoMinor: '0.00',
          cierreExistente: null,
          periodoDiciembreAbierto: true
        });
      }
      if (comando === 'cierre:ejercicio') {
        return Promise.reject(new Error('El ejercicio 2026 no tiene movimientos en cuentas de resultados'));
      }
      return Promise.resolve({});
    });
    render(<Cierre />);

    fireEvent.change(screen.getByLabelText(/Año del ejercicio\n?/), { target: { value: '2026' } });
    await waitFor(() => screen.getByText(/Sin saldos pendientes/));
    fireEvent.change(screen.getByLabelText(/^Responsable$/), { target: { value: 'p' } });
    fireEvent.change(screen.getByLabelText(/^Motivo$/), { target: { value: 'm' } });
    fireEvent.change(screen.getByLabelText(/Referencia de soporte\n?/), { target: { value: 'r' } });
    fireEvent.click(screen.getByText(/Contabilizar cierre y cerrar diciembre/));

    await waitFor(() => screen.getByText(/no tiene movimientos en cuentas de resultados/));
    expect(screen.queryByText(/cerrado con asiento/)).toBeNull();
  });
});
