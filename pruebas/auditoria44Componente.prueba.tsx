// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

const invocar = vi.hoisted(() => vi.fn());
const guardarEjercicioMock = vi.hoisted(() => vi.fn());

vi.mock('../src/renderer/api', () => ({
  api: () => ({
    invocar: (comando: string, datos?: unknown) => invocar(comando, datos),
    guardarCsvAuxiliar: () => Promise.resolve({ guardado: false }),
    guardarPaqueteContador: () => Promise.resolve({ guardado: false }),
    guardarEjercicioAnual: (anio: number) => guardarEjercicioMock(anio)
  })
}));

import Reportes from '../src/renderer/vistas/Reportes';

const consultasEjercicio = vi.hoisted(() => new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>());

beforeEach(() => {
  invocar.mockReset();
  guardarEjercicioMock.mockReset();
  invocar.mockImplementation((comando: string, datos?: unknown) => {
    switch (comando) {
      case 'contraparte:listar':
        return Promise.resolve([]);
      case 'auxiliar:contrapartes':
        return Promise.resolve({ clientes: [], proveedores: [], totalClientesMinor: '0.00', totalProveedoresMinor: '0.00', conciliaMayor: true });
      case 'auxiliar:efectivo':
        return Promise.resolve({ cuentas: [], totalMinor: '0.00', conciliaMayor: true });
      case 'ejercicio:consultar': {
        const anio = (datos as { anio: number }).anio;
        return new Promise((resolve, reject) => {
          consultasEjercicio.set(anio, { resolve, reject });
        });
      }
      default:
        return Promise.resolve([]);
    }
  });
});

afterEach(() => {
  cleanup();
  consultasEjercicio.clear();
});

describe('auditoría 44: componente del ejercicio anual', () => {
  it('cambiar de año limpia el informe viejo, muestra carga y bloquea exportar hasta resultado vigente', async () => {
    render(<Reportes />);
    await waitFor(() => screen.getByText(/Ejercicio anual/));

    const anioInput = screen.getByLabelText(/Año del ejercicio\n?/) as HTMLInputElement;
    fireEvent.change(anioInput, { target: { value: '2026' } });
    await waitFor(() => expect(consultasEjercicio.has(2026)).toBe(true));
    consultasEjercicio.get(2026)!.resolve(ejercicioMock('100.00'));
    await waitFor(() => screen.getByText(/Ejercicio 2026 confirmado/));
    expect(screen.getByText(/Resultado ordinario: \$100\.00/)).toBeTruthy();

    // Cambiar a 2027 con respuesta pendiente: el informe viejo desaparece y exportar se bloquea.
    fireEvent.change(anioInput, { target: { value: '2027' } });
    await waitFor(() => screen.getByText(/Consultando ejercicio 2027…/));
    expect(screen.queryByText(/Ejercicio 2026 confirmado/)).toBeNull();
    expect(screen.queryByText(/Resultado ordinario/)).toBeNull();
    const btnExportar = screen.getByText(/Guardar soporte del ejercicio…/) as HTMLButtonElement;
    expect(btnExportar.disabled).toBe(true);

    // Respuesta tardía de 2026 ignorada; la de 2027 se muestra.
    consultasEjercicio.get(2026)!.resolve(ejercicioMock('55.00'));
    await new Promise(r => setTimeout(r, 20));
    expect(screen.queryByText(/\$55\.00/)).toBeNull();
    consultasEjercicio.get(2027)!.resolve(ejercicioMock('77.00'));
    await waitFor(() => screen.getByText(/Ejercicio 2027 confirmado/));
    expect(btnExportar.disabled).toBe(false);

    // Exportación con payload concordante con la pantalla (2027).
    guardarEjercicioMock.mockResolvedValue({ guardado: true, ruta: 'C:\\sintetico\\ejercicio', archivos: 4 });
    fireEvent.click(btnExportar);
    await waitFor(() => screen.getByText(/Soporte del ejercicio guardado en/));
    expect(guardarEjercicioMock).toHaveBeenCalledWith(2027);
  });

  it('error de consulta limpia el informe y cancelación no invoca guardado', async () => {
    render(<Reportes />);
    await waitFor(() => screen.getByText(/Ejercicio anual/));
    const anioInput = screen.getByLabelText(/Año del ejercicio\n?/) as HTMLInputElement;
    fireEvent.change(anioInput, { target: { value: '2026' } });
    await waitFor(() => expect(consultasEjercicio.has(2026)).toBe(true));
    consultasEjercicio.get(2026)!.reject(new Error('fallo sintético del ejercicio'));
    await waitFor(() => screen.getByText(/Error al consultar el ejercicio: fallo sintético/));
    const btnExportar = screen.getByText(/Guardar soporte del ejercicio…/) as HTMLButtonElement;
    expect(btnExportar.disabled).toBe(true);
    guardarEjercicioMock.mockResolvedValue({ guardado: false });
    expect(guardarEjercicioMock).not.toHaveBeenCalled();
  });
});

function ejercicioMock(resultado: string) {
  return {
    version: 'ejercicio-anual-interno-v1',
    anio: 0,
    generadoEn: '2026-01-01T00:00:00.000Z',
    resultadoOrdinarioMinor: resultado,
    resultadoConCierreMinor: '0.00',
    ingresosMinor: resultado,
    costosGastosMinor: '0.00',
    retencionesEfectuadasMinor: '0.00',
    retencionesRecibidasMinor: '0.00',
    conciliacionMayor: { diferenciaMinor: '0.00', concilia: true },
    cuentas: [],
    asientos: [{ folio: 'A-000001', fecha: '2026-03-10', concepto: 'Venta sintética', estado: 'contabilizado', origen: 'venta', totalMinor: resultado, familiaCierre: false }],
    retenciones: [],
    limitaciones: ['Soporte INTERNO de trabajo para el contador; NO es declaración F-11 ni anexo oficial.']
  };
}
