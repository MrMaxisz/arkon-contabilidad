// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';

const invocar = vi.hoisted(() => vi.fn());
const guardarAnexoF14Mock = vi.hoisted(() => vi.fn());

vi.mock('../src/renderer/api', () => ({
  api: () => ({
    invocar: (comando: string, datos?: unknown) => invocar(comando, datos),
    guardarCsv: () => Promise.resolve({ guardado: false }),
    guardarAnexoF07: () => Promise.resolve({ guardado: false }),
    guardarAnexoF14: (mes: string) => guardarAnexoF14Mock(mes)
  })
}));

import Impuestos from '../src/renderer/vistas/Impuestos';

const NITS: Record<number, string> = { 31: '06141234561015', 32: '06146543211015' };

beforeEach(() => {
  invocar.mockReset();
  guardarAnexoF14Mock.mockReset();
  invocar.mockImplementation((comando: string, datos?: unknown) => {
    switch (comando) {
      case 'contraparte:listar':
        return Promise.resolve([]);
      case 'vigencia:listar':
        return Promise.resolve([]);
      case 'retencion:listar':
        return Promise.resolve([
          { id: 31, folio: 'RTN-000001', contraparteNombre: 'Proveedor Alfa', fecha: '2026-11-05' },
          { id: 32, folio: 'RTN-000002', contraparteNombre: 'Proveedor Beta', fecha: '2026-11-20' }
        ]);
      case 'fiscal:retencionMetadatosLeer': {
        const id = (datos as { retencionId: number }).retencionId;
        return Promise.resolve({
          id,
          folio: `RTN-00000${id === 32 ? 2 : 1}`,
          fecha: id === 32 ? '2026-11-20' : '2026-11-05',
          contraparte: id === 32 ? 'Proveedor Beta' : 'Proveedor Alfa',
          domiciliado: null,
          codigo_pais: null,
          nit_nif: null,
          dui: null,
          codigo_ingreso: null,
          tipo_operacion_f14: null,
          clasificacion_f14: null,
          sector_f14: null,
          tipo_costo_gasto_f14: null,
          involucra_nomina: null
        });
      }
      case 'fiscal:retencionMetadatosCompletar': {
        const p = datos as Record<string, unknown>;
        if (typeof p.responsable !== 'string' || !p.responsable) {
          return Promise.reject(new Error('Campo requerido: responsable'));
        }
        if (typeof p.motivo !== 'string' || !p.motivo) {
          return Promise.reject(new Error('Campo requerido: motivo'));
        }
        if (typeof p.involucraNomina !== 'boolean') {
          return Promise.reject(new Error('Debe declararse si la retención involucra nómina'));
        }
        return Promise.resolve({ ok: true });
      }
      case 'fiscal:anexoRetenciones':
        return Promise.resolve({
          version: 'anexo-f14-v16-esquema1',
          mes: '2026-11',
          folios: [],
          listos: [],
          bloqueado: false,
          motivo: '',
          fuente: 'Manual F-14 v16'
        });
      case 'fiscal:politicas':
        return Promise.resolve({ anticipoHechoGenerador: 'pendiente', ivaComprasCreditoFiscal: false, perfilIvaInscritoConfig: false });
      case 'fiscal:libroVentas':
      case 'fiscal:libroCompras':
        return Promise.resolve({ filas: [], baseMinor: '0.00', ivaMinor: '0.00', totalMinor: '0.00' });
      case 'fiscal:conciliar':
        return Promise.resolve({
          mes: '2026-11', debitoLibroMinor: '0.00', debitoMayorMinor: '0.00', conciliaDebito: true,
          ivaDocumentadoComprasMinor: '0.00', creditoAcreditableLibroMinor: '0.00', creditoMayorMinor: '0.00', conciliaCredito: true
        });
      case 'reporte:estadoResultados':
        return Promise.resolve({ mes: '2026-11', filas: [], ingresosMinor: '0.00', costosGastosMinor: '0.00', resultadoMinor: '0.00' });
      case 'documento:listarVinculos':
        return Promise.resolve({ venta: [], compra: [], cotizacion: [], proyecto: [] });
      default:
        return Promise.resolve([]);
    }
  });
});

afterEach(() => {
  cleanup();
});

describe('auditoría 41: formulario F-14 sin contaminación de identidad entre retenciones', () => {
  it('alternar retención carga los metadatos del sujeto correspondiente y el guardado usa el NIT visible', async () => {
    render(<Impuestos />);
    await waitFor(() => screen.getByText(/Anexo de Retenciones F-14 v16/));

    const formF14 = screen.getByText('Registrar metadatos F-14').closest('form') as HTMLFormElement;
    const dentro = within(formF14);
    const selectorRet = dentro.getAllByRole('combobox').find(
      c => Array.from((c as HTMLSelectElement).options).some(o => o.value === '32')
    ) as HTMLSelectElement;

    // Seleccionar retención A (id 31) y capturar su NIT.
    fireEvent.change(selectorRet, { target: { value: '31' } });
    await waitFor(() => expect(invocar.mock.calls.some(c => c[0] === 'fiscal:retencionMetadatosLeer' && (c[1] as { retencionId: number }).retencionId === 31)).toBe(true));
    const nitInput = dentro.getByLabelText(/NIT\/NIF \(D\)\n?/) as HTMLInputElement;
    fireEvent.change(nitInput, { target: { value: NITS[31] } });

    // Alternar a retención B: la lectura de B debe reemplazar el NIT de A (sin contaminación).
    fireEvent.change(selectorRet, { target: { value: '32' } });
    await waitFor(() => expect(invocar.mock.calls.some(c => c[0] === 'fiscal:retencionMetadatosLeer' && (c[1] as { retencionId: number }).retencionId === 32)).toBe(true));
    await waitFor(() => expect(nitInput.value).toBe(''));

    // Capturar NIT de B y guardar: el payload debe llevar retencionId 32 y el NIT de B.
    fireEvent.change(nitInput, { target: { value: NITS[32] } });
    fireEvent.change(dentro.getByLabelText(/Domiciliado \(A\)\n?/, { selector: 'select' }) as HTMLSelectElement, { target: { value: '1' } });
    fireEvent.change(dentro.getByLabelText(/País \(B\)\n?/) as HTMLInputElement, { target: { value: '9300' } });
    fireEvent.change(dentro.getByLabelText(/Código ingreso \(F\)\n?/) as HTMLInputElement, { target: { value: '42' } });
    fireEvent.change(dentro.getByLabelText(/Tipo operación \(S\)\n?/, { selector: 'select' }) as HTMLSelectElement, { target: { value: '1' } });
    fireEvent.change(dentro.getByLabelText(/Clasificación \(T\)\n?/, { selector: 'select' }) as HTMLSelectElement, { target: { value: '2' } });
    fireEvent.change(dentro.getByLabelText(/Sector \(U\)\n?/) as HTMLInputElement, { target: { value: '2' } });
    fireEvent.change(dentro.getByLabelText(/Tipo costo\/gasto \(V\)\n?/) as HTMLInputElement, { target: { value: '1' } });
    fireEvent.change(dentro.getByLabelText(/¿Involucra nómina\? \(J-R\)\n?/, { selector: 'select' }) as HTMLSelectElement, { target: { value: 'no' } });
    fireEvent.change(dentro.getByLabelText(/Responsable\n?/) as HTMLInputElement, { target: { value: 'p' } });
    fireEvent.change(dentro.getByLabelText(/^Motivo\n?/) as HTMLInputElement, { target: { value: 'motivo sintético' } });
    fireEvent.click(screen.getByText('Registrar metadatos F-14'));

    await waitFor(() => screen.getByText(/Metadatos F-14 registrados en bitácora/));
    const llamada = invocar.mock.calls.find(c => c[0] === 'fiscal:retencionMetadatosCompletar');
    const payload = llamada![1] as Record<string, unknown>;
    expect(payload.retencionId).toBe(32);
    expect(payload.nitNif).toBe(NITS[32]);
    expect(payload.responsable).toBe('p');
    expect(payload.motivo).toBe('motivo sintético');
    expect(payload.involucraNomina).toBe(false);
    // Tras guardar se recarga la retención y el diagnóstico F-14.
    expect(invocar.mock.calls.some(c => c[0] === 'fiscal:anexoRetenciones')).toBe(true);
  });

  it('el guardado F-14 por diálogo nativo invoca guardarAnexoF14 con el mes', async () => {
    guardarAnexoF14Mock.mockResolvedValue({ guardado: true, ruta: 'C:\\sintetico\\f14.csv', filas: 2 });
    render(<Impuestos />);
    await waitFor(() => screen.getByText(/Anexo de Retenciones F-14 v16/));
    fireEvent.change(screen.getByPlaceholderText('2026-11'), { target: { value: '2026-11' } });
    fireEvent.click(screen.getByText('Guardar anexo F-14…'));
    await waitFor(() => screen.getByText(/Anexo F-14 guardado en/));
    expect(guardarAnexoF14Mock).toHaveBeenCalledWith('2026-11');
  });
});
