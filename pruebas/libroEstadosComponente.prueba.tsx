// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

// Auditoría 72 (P1-72-6 y P1-72-7): imprimir el libro recorre TODO el rango filtrado
// y las respuestas tardías se descartan.

const invocar = vi.hoisted(() => vi.fn());
const reportePdf = vi.hoisted(() => vi.fn());

vi.mock('../src/renderer/api', () => ({
  api: () => ({
    invocar: (comando: string, datos?: unknown) => invocar(comando, datos),
    reportePdf: (solicitud: unknown) => reportePdf(solicitud)
  })
}));

import LibroDiario from '../src/renderer/vistas/LibroDiario';
import EstadosFinancieros from '../src/renderer/vistas/EstadosFinancieros';

function partida(n: number) {
  return {
    id: n,
    folio: `A-${String(n).padStart(6, '0')}`,
    numero: n,
    fecha: '2026-01-10',
    concepto: `Partida sintética ${n}`,
    estado: 'contabilizado',
    origen: '',
    responsable: 'qa',
    totalMinor: '10.00'
  };
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  invocar.mockReset();
  reportePdf.mockReset();
  reportePdf.mockResolvedValue({ guardado: true, ruta: '/tmp/sintetico.pdf' });
});

afterEach(() => {
  cleanup();
});

describe('auditoría 72: imprimir el libro diario recorre TODO el rango filtrado', () => {
  it('con 21 partidas y página de 20, el PDF recibe las 21 con total y conteo', async () => {
    invocar.mockImplementation((comando: string, datos?: unknown) => {
      if (comando === 'libro:partidas') {
        const d = datos as { desde: number; limite: number };
        const todas = Array.from({ length: 21 }, (_, i) => partida(i + 1));
        return Promise.resolve({ partidas: todas.slice(d.desde, d.desde + d.limite), total: 21 });
      }
      if (comando === 'cuenta:listar') {
        return Promise.resolve([]);
      }
      return Promise.resolve([]);
    });
    render(<LibroDiario />);
    await waitFor(() => expect(screen.getByText(/21 partida\(s\)/)).toBeTruthy());
    fireEvent.click(screen.getByText('Imprimir libro…'));
    await waitFor(() => expect(reportePdf).toHaveBeenCalled());
    const solicitud = reportePdf.mock.calls[0]![0] as { titulo: string; periodo: string; tablas: Array<{ filas: string[][] }> };
    expect(solicitud.titulo).toBe('Libro diario');
    expect(solicitud.periodo).toContain('21 partida(s)');
    expect(solicitud.tablas[0]!.filas).toHaveLength(21);
    expect(solicitud.tablas[0]!.filas[0]![0]).toBe('A-000001');
    expect(solicitud.tablas[0]!.filas[20]![0]).toBe('A-000021');
  });
});

describe('auditoría 72: respuestas tardías descartadas', () => {
  it('LibroDiario: una consulta antigua no sobrescribe la nueva', async () => {
    let resolveres: Array<(v: unknown) => void> = [];
    invocar.mockImplementation((comando: string) => {
      if (comando === 'libro:partidas') {
        return new Promise(resolve => {
          resolveres.push(resolve);
        });
      }
      if (comando === 'cuenta:listar') {
        return Promise.resolve([]);
      }
      return Promise.resolve([]);
    });
    render(<LibroDiario />);
    await waitFor(() => expect(resolveres.length).toBe(1));
    // El usuario cambia la búsqueda: nueva consulta (id 2) mientras la 1 sigue pendiente.
    const busqueda = screen.getByLabelText(/Búsqueda por número\n?/);
    fireEvent.change(busqueda, { target: { value: 'A-000002' } });
    await waitFor(() => expect(resolveres.length).toBe(2));
    // La respuesta NUEVA (2) llega primero; la ANTIGUA (1) llega después y debe ignorarse.
    resolveres[1]!({ partidas: [partida(2)], total: 1 });
    resolveres[0]!({ partidas: [partida(1)], total: 1 });
    await waitFor(() => expect(screen.getByText('A-000002')).toBeTruthy());
    await waitFor(() => expect(screen.queryByText('A-000001')).toBeNull());
    expect(screen.getByText(/1 partida\(s\)/)).toBeTruthy();
  });

  it('EstadosFinancieros: la respuesta tardía de otro corte no reemplaza el balance visible', async () => {
    let resolveres: Array<(v: unknown) => void> = [];
    invocar.mockImplementation((comando: string) => {
      if (comando === 'balance:comprobacion') {
        return new Promise(resolve => {
          resolveres.push(resolve);
        });
      }
      return Promise.resolve([]);
    });
    render(<EstadosFinancieros />);
    await waitFor(() => expect(resolveres.length).toBe(1));
    const balanceInicial = {
      desde: '2026-01-01',
      hasta: '2026-12-31',
      filas: [],
      totalCargosMinor: '0.00',
      totalAbonosMinor: '0.00',
      cuadra: true
    };
    resolveres[0]!(balanceInicial);
    const hasta = await waitFor(() => screen.getByLabelText(/Hasta\n?/) as HTMLInputElement);
    fireEvent.change(hasta, { target: { value: '2026-06-30' } });
    await waitFor(() => expect(resolveres.length).toBe(2));
    const balanceNuevo = {
      desde: '2026-01-01',
      hasta: '2026-06-30',
      filas: [{ cuentaId: 1, codigo: '1101', nombre: 'Caja general', tipo: 'activo', esGrupo: false, saldoInicialMinor: '5.00', cargosMinor: '0.00', abonosMinor: '0.00', saldoFinalMinor: '5.00' }],
      totalCargosMinor: '0.00',
      totalAbonosMinor: '0.00',
      cuadra: true
    };
    resolveres[1]!(balanceNuevo);
    resolveres[0]!({ ...balanceNuevo, hasta: '2026-12-31', filas: [] });
    await waitFor(() => expect(screen.getByText('Caja general')).toBeTruthy());
    // El período visible es el nuevo; el antiguo no reemplaza la tabla.
    expect((screen.getByLabelText(/Hasta\n?/) as HTMLInputElement).value).toBe('2026-06-30');
    expect(screen.getByText('Caja general')).toBeTruthy();
  });
});
