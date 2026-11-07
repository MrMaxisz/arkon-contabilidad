// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

// Bloque 5B: en Cotizaciones, catálogo y contrapartes las filas muestran a lo sumo
// dos acciones; el resto va en un menú, con etiquetas claras (sin "Documento…").
// Cifras a mano: base 1,500.00 y tasa 13% → IVA 195.00 y total 1,695.00.

const invocar = vi.hoisted(() => vi.fn());

vi.mock('../src/renderer/api', () => ({
  api: () => ({
    invocar: (comando: string, datos?: unknown) => invocar(comando, datos),
    pdfCotizacion: () => Promise.resolve({ guardado: false })
  })
}));

import Cotizaciones from '../src/renderer/vistas/Cotizaciones';

const COTIZACION = {
  id: 7,
  numero: 'COT-2-1201',
  revision: 1,
  contraparteId: 3,
  contraparteNombre: 'Cliente QA 5B',
  fecha: '2026-11-06',
  estado: 'borrador',
  baseMinor: '1500.00',
  ivaMinor: '195.00',
  totalMinor: '1695.00'
};

beforeEach(() => {
  invocar.mockReset();
  invocar.mockImplementation((comando: string) => {
    switch (comando) {
      case 'cotizacion:listar':
        return Promise.resolve([COTIZACION]);
      case 'contraparte:listar':
        return Promise.resolve([{ id: 3, nombre: 'Cliente QA 5B', esCliente: true, esProveedor: false }]);
      case 'item:listar':
        return Promise.resolve([]);
      default:
        return Promise.resolve([]);
    }
  });
});

afterEach(cleanup);

describe('bloque 5B: acciones de fila y etiquetas claras', () => {
  it('borrador: a lo sumo dos acciones visibles y el resto en el menú', async () => {
    render(<Cotizaciones />);
    await waitFor(() => screen.getByText('COT-2-1201'));
    const fila = screen.getByText('COT-2-1201').closest('tr')!;
    // Fuera del menú solo hay dos botones por fila, con etiquetas claras.
    const visibles = Array.from(fila.querySelectorAll('.acciones-fila > button')).map(b => b.textContent);
    expect(visibles).toEqual(['Editar', 'Generar PDF']);
    expect(screen.queryByText('Documento…')).toBeNull();
    // La Aprobación, la nueva revisión y la anulación están agrupadas en el menú.
    fireEvent.click(screen.getByText('Más acciones'));
    expect(fila.textContent).toContain('Aprobar');
    expect(fila.textContent).toContain('Nueva revisión');
    expect(fila.textContent).toContain('Anular');
  });

  it('montos de la tabla con separador de miles (base 1500 × 1.13 = 1695)', async () => {
    render(<Cotizaciones />);
    await screen.findByText('COT-2-1201');
    expect(screen.getByText('$1,500.00')).not.toBeNull();
    expect(screen.getByText('$195.00')).not.toBeNull();
    expect(screen.getByText('$1,695.00')).not.toBeNull();
  });
});
