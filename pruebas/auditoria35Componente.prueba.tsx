// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';

const invocar = vi.hoisted(() => vi.fn());
const guardarAnexo1VentasMock = vi.hoisted(() => vi.fn());

vi.mock('../src/renderer/api', () => ({
  api: () => ({
    invocar: (comando: string, datos?: unknown) => invocar(comando, datos),
    guardarCsv: () => Promise.resolve({ guardado: false }),
    guardarAnexo1Ventas: (mes: string) => guardarAnexo1VentasMock(mes)
  })
}));

import Impuestos from '../src/renderer/vistas/Impuestos';

beforeEach(() => {
  invocar.mockReset();
  guardarAnexo1VentasMock.mockReset();
  invocar.mockImplementation((comando: string) => {
    switch (comando) {
      case 'contraparte:listar':
        return Promise.resolve([]);
      case 'vigencia:listar':
        return Promise.resolve([]);
      case 'retencion:listar':
        return Promise.resolve([]);
      case 'fiscal:libroVentas':
      case 'fiscal:libroCompras':
        return Promise.resolve({ filas: [], baseMinor: '0.00', ivaMinor: '0.00', totalMinor: '0.00' });
      case 'fiscal:conciliar':
        return Promise.resolve({
          mes: '2026-11',
          debitoLibroMinor: '0.00',
          debitoMayorMinor: '0.00',
          conciliaDebito: true,
          ivaDocumentadoComprasMinor: '0.00',
          creditoAcreditableLibroMinor: '0.00',
          creditoMayorMinor: '0.00',
          conciliaCredito: true
        });
      case 'fiscal:politicas':
        return Promise.resolve({ anticipoHechoGenerador: 'pendiente', ivaComprasCreditoFiscal: false, perfilIvaInscritoConfig: false });
      case 'reporte:estadoResultados':
        return Promise.resolve({ mes: '2026-11', filas: [], ingresosMinor: '0.00', costosGastosMinor: '0.00', resultadoMinor: '0.00' });
      case 'fiscal:anexo1Ventas':
        return Promise.resolve({
          version: 'anexo-f07-v14-anexo1-esquema2',
          mes: '2026-11',
          folios: [{ folio: 'V-000001', documentoId: 7, faltantes: ['NIT (14 dígitos) o NRC válido del cliente', 'número de resolución (columna D)'] }],
          listos: [],
          bloqueado: true,
          motivo: 'Hay folios con metadatos fiscales incompletos',
          fuente: 'Manual F-07 v14'
        });
      case 'fiscal:metadatosLeer':
        return Promise.resolve({
          id: 7,
          folio: 'V-000001',
          fecha: '2026-11-05',
          contraparte: 'Cliente Sintético A35',
          clase_documento_fiscal: null,
          numero_resolucion: null,
          serie_documento: null,
          numero_documento_autorizado: null,
          tratamiento_venta: null,
          tipo_operacion_renta: null,
          tipo_ingreso_renta: null
        });
      case 'documento:listarVinculos':
        return Promise.resolve({
          venta: [{ id: 7, folio: 'V-000001', concepto: 'Venta sintética', fecha: '2026-11-05' }],
          compra: [],
          cotizacion: [],
          proyecto: []
        });
      case 'fiscal:metadatosCompletar':
        return Promise.resolve({ ok: true });
      default:
        return Promise.resolve([]);
    }
  });
});

afterEach(() => {
  cleanup();
});

describe('auditoría 35: componente Impuestos con Anexo 1 F-07', () => {
  it('diagnóstico muestra faltantes específicos y el bloqueo; guardar rechazado se hace visible', async () => {
    guardarAnexo1VentasMock.mockRejectedValue(new Error('El anexo de presentación está bloqueado. Faltantes: V-000001: NIT o NRC del cliente'));
    render(<Impuestos />);

    await waitFor(() => screen.getByText(/Anexo 1 F-07 v14/));
    const mesInput = screen.getByPlaceholderText("2026-11") as HTMLInputElement;
    fireEvent.change(mesInput, { target: { value: '2026-11' } });
    fireEvent.click(screen.getByText('Diagnosticar'));

    await waitFor(() => screen.getByText(/V-000001: NIT \(14 dígitos\) o NRC válido del cliente · número de resolución/));
    fireEvent.click(screen.getByText('Completar…'));
    await waitFor(() => screen.getByText(/Documento seleccionado: V-000001 del 2026-11-05 · Cliente Sintético A35/));
    expect(invocar.mock.calls.some(c => c[0] === 'fiscal:metadatosLeer' && (c[1] as { documentoId: number }).documentoId === 7)).toBe(true);
    expect(screen.getByText(/BLOQUEADO: Hay folios con metadatos fiscales incompletos/)).toBeTruthy();

    fireEvent.click(screen.getByText(/Guardar anexo de presentación…/));
    await waitFor(() => screen.getByText(/El anexo de presentación está bloqueado/));
    expect(guardarAnexo1VentasMock).toHaveBeenCalledWith('2026-11');
  });

  it('la vía auditada registra metadatos y refresca el diagnóstico', async () => {
    render(<Impuestos />);
    await waitFor(() => screen.getByText(/Anexo 1 F-07 v14/));

    fireEvent.change(screen.getByPlaceholderText("2026-11"), { target: { value: '2026-11' } });
    const form = screen.getByText('Registrar metadatos').closest('form') as HTMLFormElement;
    const dentro = within(form);
    const selectorVenta = dentro.getAllByRole('combobox').find(
      c => Array.from((c as HTMLSelectElement).options).some(o => o.value === '7')
    ) as HTMLSelectElement;
    fireEvent.change(selectorVenta, { target: { value: '7' } });
    await waitFor(() => screen.getByText(/Documento seleccionado: V-000001/));
    fireEvent.change(dentro.getByLabelText(/Resolución\n?/) as HTMLInputElement, { target: { value: 'R-SINTETICA' } });
    fireEvent.change(dentro.getByLabelText(/^Serie\n?/) as HTMLInputElement, { target: { value: 'A' } });
    fireEvent.change(dentro.getByLabelText(/Número autorizado\n?/) as HTMLInputElement, { target: { value: '000001' } });
    fireEvent.change(dentro.getByLabelText(/Responsable\n?/) as HTMLInputElement, { target: { value: 'p' } });
    fireEvent.change(dentro.getByLabelText(/^Motivo\n?/) as HTMLInputElement, { target: { value: 'motivo sintético' } });
    fireEvent.change(dentro.getByLabelText(/Tipo operación Renta/) as HTMLSelectElement, { target: { value: '1' } });
    fireEvent.change(dentro.getByLabelText(/Tipo ingreso Renta/) as HTMLSelectElement, { target: { value: '2' } });
    fireEvent.click(screen.getByText('Registrar metadatos'));

    await waitFor(() => screen.getByText(/Metadatos fiscales registrados en bitácora/));
    expect(invocar.mock.calls.some(c => c[0] === 'fiscal:metadatosCompletar')).toBe(true);
    const diagnosticos = invocar.mock.calls.filter(c => c[0] === 'fiscal:anexo1Ventas').length;
    expect(diagnosticos).toBeGreaterThanOrEqual(1);
  });
});
