// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

const invocar = vi.hoisted(() => vi.fn());

vi.mock('../src/renderer/api', () => ({
  api: () => ({
    invocar: (comando: string, datos?: unknown) => invocar(comando, datos),
    guardarCsv: () => Promise.resolve({ guardado: false }),
    pdfCotizacion: () => Promise.resolve({ guardado: false }),
    registrarAdjunto: (entidad: string, entidadId: string, responsable: string) =>
      invocar('__registrarAdjunto', { entidad, entidadId, responsable })
  })
}));

import Respaldo from '../src/renderer/vistas/Respaldo';

beforeEach(() => {
  invocar.mockReset();
  invocar.mockImplementation((comando: string) => {
    switch (comando) {
      case 'respaldo:listar':
        return Promise.resolve([]);
      case 'adjunto:listar':
        return Promise.resolve([
          { id: 1, entidad: 'compra', entidadId: 'CMP-000001', nombreOriginal: 'factura.txt', hashSha256: 'abcd1234'.repeat(8), creadoEn: '2026-11-04' }
        ]);
      case 'config:respaldoPeriodicoLeer':
        return Promise.resolve({ intervaloMinutos: 30, retencion: 5 });
      case '__registrarAdjunto':
        return Promise.resolve({
          registrado: true,
          adjunto: { nombreOriginal: 'nuevo.txt', hashSha256: 'ef5678'.repeat(10) }
        });
      default:
        return Promise.resolve([]);
    }
  });
});

afterEach(() => {
  cleanup();
});

describe('auditoría 26: panel de adjuntos en Respaldo', () => {
  it('renderiza el panel con formulario, tabla de adjuntos y configuración periódica', async () => {
    render(<Respaldo />);

    await waitFor(() => screen.getByText('Adjuntos'));
    expect(screen.getByText('Registrar adjunto…')).toBeTruthy();
    expect(screen.getByText('factura.txt')).toBeTruthy();
    expect(screen.getByText('CMP-000001')).toBeTruthy();
    expect(screen.getByText('Respaldo periódico')).toBeTruthy();
    expect(screen.getByText('Guardar configuración')).toBeTruthy();

    const intervaloInput = screen.getByLabelText(/Intervalo \(minutos/) as HTMLInputElement;
    expect(intervaloInput.value).toBe('30');
    const retencionInput = screen.getByLabelText(/Retención \(respaldos/) as HTMLInputElement;
    expect(retencionInput.value).toBe('5');
  });

  it('registrarAdjunto se llama con los datos del formulario y actualiza la lista', async () => {
    render(<Respaldo />);

    await waitFor(() => screen.getByText('Adjuntos'));
    const inputs = screen.getAllByRole('textbox');
    const folioInput = inputs.find(i => i.placeholder === 'CMP-000001') as HTMLInputElement;
    fireEvent.change(folioInput, { target: { value: 'CMP-000002' } });
    const responsableInput = inputs.find(i => i.required && !i.placeholder) as HTMLInputElement;
    fireEvent.change(responsableInput, { target: { value: 'prueba' } });

    fireEvent.click(screen.getByText('Registrar adjunto…'));

    await waitFor(() => screen.getByText(/nuevo\.txt registrado con hash/));
    expect(invocar.mock.calls.some(c => c[0] === '__registrarAdjunto' && (c[1] as { entidadId: string }).entidadId === 'CMP-000002')).toBe(true);
    expect(invocar.mock.calls.some(c => c[0] === 'adjunto:listar')).toBe(true);
  });

  it('guardar configuración periódica invoca el comando con valores validados', async () => {
    render(<Respaldo />);

    await waitFor(() => screen.getByText('Respaldo periódico'));
    const intervaloInput = screen.getByLabelText(/Intervalo \(minutos/) as HTMLInputElement;
    fireEvent.change(intervaloInput, { target: { value: '120' } });
    fireEvent.click(screen.getByText('Guardar configuración'));

    await waitFor(() => screen.getByText(/Configuración de respaldo periódico guardada/));
    expect(
      invocar.mock.calls.some(c => c[0] === 'config:respaldoPeriodicoGuardar' && (c[1] as { intervaloMinutos: number }).intervaloMinutos === 120)
    ).toBe(true);
  });
});
