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
      invocar('__registrarAdjunto', { entidad, entidadId, responsable }),
    abrirAdjunto: (id: number) => invocar('__abrirAdjunto', { id })
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
      case 'documento:listarVinculos':
        return Promise.resolve({
          venta: [{ folio: 'V-000001', concepto: 'Venta sintética', fecha: '2026-11-01' }],
          compra: [
            { folio: 'CMP-000001', concepto: 'Compra sintética uno', fecha: '2026-11-02' },
            { folio: 'CMP-000002', concepto: 'Compra sintética dos', fecha: '2026-11-03' }
          ],
          cotizacion: [],
          proyecto: []
        });
      case 'respaldo:estadoPeriodico':
        return Promise.resolve({
          intervaloMinutos: 30,
          ultimoRespaldo: { creadoEn: '2026-11-04 10:00:00', nombre: 'respaldo-automatico-sintetico.db' },
          ultimoFallo: { creadoEn: '2026-11-05 10:00:00', detalle: 'fallo sintético del temporizador' },
          proximaEjecucion: '2026-11-05T11:00:00.000Z'
        });
      case 'adjunto:verificar':
        return Promise.resolve({ id: 1, nombreOriginal: 'factura.txt', ruta: 'C:\\sintetico\\factura.txt', existe: true, hashCoincide: true });
      case '__abrirAdjunto':
        return Promise.resolve({ abierto: true, nombreOriginal: 'factura.txt' });
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
    const selectorDocumento = screen.getByLabelText(/^Documento\n?/) as HTMLSelectElement;
    expect(selectorDocumento.value).toBe('');
    fireEvent.change(selectorDocumento, { target: { value: 'CMP-000002' } });
    const inputs = screen.getAllByRole('textbox');
    const responsableInput = inputs.find(i => i.required && !i.placeholder) as HTMLInputElement;
    fireEvent.change(responsableInput, { target: { value: 'prueba' } });

    fireEvent.click(screen.getByText('Registrar adjunto…'));

    await waitFor(() => screen.getByText(/nuevo\.txt registrado con hash/));
    expect(invocar.mock.calls.some(c => c[0] === '__registrarAdjunto' && (c[1] as { entidadId: string }).entidadId === 'CMP-000002')).toBe(true);
    expect(invocar.mock.calls.some(c => c[0] === 'adjunto:listar')).toBe(true);
  });

  it('el estado periódico muestra éxito, fallo reciente y próxima ejecución, y se refresca al guardar', async () => {
    render(<Respaldo />);

    await waitFor(() => screen.getByText(/Último respaldo automático: respaldo-automatico-sintetico\.db/));
    expect(screen.getByText(/Pr\u00f3xima ejecuci\u00f3n: 2026-11-05T11:00:00/)).toBeTruthy();
    expect(screen.getByText(/fallo sint\u00e9tico del temporizador/)).toBeTruthy();

    const intervaloInput = screen.getByLabelText(/Intervalo \(minutos/) as HTMLInputElement;
    fireEvent.change(intervaloInput, { target: { value: '60' } });
    fireEvent.click(screen.getByText('Guardar configuraci\u00f3n'));

    await waitFor(() => screen.getByText(/Configuraci\u00f3n de respaldo peri\u00f3dico guardada/));
    const consultasEstado = invocar.mock.calls.filter(c => c[0] === 'respaldo:estadoPeriodico').length;
    expect(consultasEstado).toBeGreaterThanOrEqual(2);
  });

  it('verificar y abrir adjunto usan los puentes con id del listado', async () => {
    render(<Respaldo />);

    await waitFor(() => screen.getByText('factura.txt'));
    fireEvent.click(screen.getByText('Verificar'));
    await waitFor(() => screen.getByText(/hash correcto/));
    expect(invocar.mock.calls.some(c => c[0] === 'adjunto:verificar' && (c[1] as { id: number }).id === 1)).toBe(true);

    fireEvent.click(screen.getByText('Abrir'));
    await waitFor(() => screen.getByText(/abierto con la aplicaci\u00f3n del sistema/));
    expect(invocar.mock.calls.some(c => c[0] === '__abrirAdjunto' && (c[1] as { id: number }).id === 1)).toBe(true);
  });

  it('guardar configuraci\u00f3n peri\u00f3dica invoca el comando con valores validados', async () => {
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
