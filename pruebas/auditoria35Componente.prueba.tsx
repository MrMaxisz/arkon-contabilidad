// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';

const invocar = vi.hoisted(() => vi.fn());
const lecturasDiferidas = vi.hoisted(() => new Map<number, (v: unknown) => void>());
const guardarAnexo1VentasMock = vi.hoisted(() => vi.fn());

vi.mock('../src/renderer/api', () => ({
  api: () => ({
    invocar: (comando: string, datos?: unknown) => invocar(comando, datos),
    guardarCsv: () => Promise.resolve({ guardado: false }),
    guardarAnexoF07: (anexo: number, mes: string) => guardarAnexo1VentasMock(anexo, mes)
  })
}));

import Impuestos from '../src/renderer/vistas/Impuestos';

beforeEach(() => {
  invocar.mockReset();
  guardarAnexo1VentasMock.mockReset();
  invocar.mockImplementation((comando: string, datos?: unknown) => {
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
      case 'fiscal:metadatosLeer': {
        const datosLeer = datos as { documentoId: number; tipo?: string };
        if (datosLeer.tipo === 'compra') {
          if (lecturasDiferidas.has(datosLeer.documentoId)) {
            return new Promise(resolve => {
              lecturasDiferidas.set(datosLeer.documentoId, resolve);
            });
          }
          return Promise.resolve({
            id: datosLeer.documentoId,
            folio: 'CMP-000001',
            fecha: '2026-11-07',
            contraparte: 'Proveedor Sintético',
            clase_documento_fiscal: null,
            numero_resolucion: null,
            serie_documento: null,
            numero_documento_autorizado: null,
            tratamiento_venta: null,
            tipo_operacion_renta: null,
            tipo_ingreso_renta: null,
            clasificacion_renta: null,
            sector: null,
            tipo_costo_gasto: null
          });
        }
        if (lecturasDiferidas.has(datosLeer.documentoId)) {
          return new Promise(resolve => {
            lecturasDiferidas.set(datosLeer.documentoId, resolve);
          });
        }
        const idLeer = (datos as { documentoId: number }).documentoId;
        return Promise.resolve({
          id: idLeer,
          folio: `V-00000${idLeer === 12 ? 2 : 1}`,
          fecha: idLeer === 12 ? '2026-11-06' : '2026-11-05',
          contraparte: idLeer === 12 ? 'Cliente Dos Sintético' : 'Cliente Sintético A35',
          clase_documento_fiscal: null,
          numero_resolucion: null,
          serie_documento: null,
          numero_documento_autorizado: null,
          tratamiento_venta: null,
          tipo_operacion_renta: null,
          tipo_ingreso_renta: null
        });
      }
      case 'documento:listarVinculos':
        return Promise.resolve({
          venta: [
            { id: 7, folio: 'V-000001', concepto: 'Venta sintética', fecha: '2026-11-05' },
            { id: 12, folio: 'V-000002', concepto: 'Venta dos sintética', fecha: '2026-11-06' }
          ],
          compra: [{ id: 21, folio: 'CMP-000001', concepto: 'Compra sintética', fecha: '2026-11-07' }],
          cotizacion: [],
          proyecto: []
        });
      case 'fiscal:anexo2Ventas':
      case 'fiscal:anexo3Compras':
        return Promise.resolve({
          version: 'diagnostico',
          mes: '2026-11',
          folios: [{ folio: 'X-000001', documentoId: 21, faltantes: ['clase de documento (columna B: 1, 2, 3 o 4)'] }],
          listos: [],
          bloqueado: true,
          motivo: 'Hay documentos con metadatos fiscales incompletos',
          fuente: 'Manual F-07 v14'
        });
      case 'fiscal:metadatosCompletar': {
        const datosCompletar = datos as Record<string, unknown>;
        if (typeof datosCompletar.responsable !== 'string' || !datosCompletar.responsable) {
          return Promise.reject(new Error('Campo requerido: responsable'));
        }
        if (typeof datosCompletar.motivo !== 'string' || !datosCompletar.motivo) {
          return Promise.reject(new Error('Campo requerido: motivo'));
        }
        if (datosCompletar.tipo === 'compra') {
          if (typeof datosCompletar.clasificacionRenta !== 'string' || !datosCompletar.clasificacionRenta) {
            return Promise.reject(new Error('Clasificación (columna R) de compra inválida: catálogo 1-2'));
          }
        }
        return Promise.resolve({ ok: true });
      }
      default:
        return Promise.resolve([]);
    }
  });
});

afterEach(() => {
  cleanup();
  lecturasDiferidas.clear();
});

describe('auditoría 35: componente Impuestos con Anexo 1 F-07', () => {
  it('diagnóstico muestra faltantes específicos y el bloqueo; guardar rechazado se hace visible', async () => {
    guardarAnexo1VentasMock.mockRejectedValue(new Error('El anexo de presentación está bloqueado. Faltantes: V-000001: NIT o NRC del cliente'));
    render(<Impuestos />);
    fireEvent.click(screen.getByRole('tab', { name: 'Anexos' }));

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
    expect(guardarAnexo1VentasMock).toHaveBeenCalledWith(1, '2026-11');
  });

  it('una lectura tardía de otra venta no reemplaza la selección vigente y el error limpia el destino', async () => {
    render(<Impuestos />);
    fireEvent.click(screen.getByRole('tab', { name: 'Anexos' }));
    await waitFor(() => screen.getByText(/Anexo 1 F-07 v14/));

    const selectorVenta = () =>
      screen
        .getAllByRole('combobox')
        .find(c => Array.from((c as HTMLSelectElement).options).some(o => o.value === '12')) as HTMLSelectElement;

    lecturasDiferidas.set(7, () => undefined);
    fireEvent.change(selectorVenta(), { target: { value: '7' } });
    await waitFor(() => expect(lecturasDiferidas.get(7)).toBeInstanceOf(Function));
    expect(lecturasDiferidas.has(7)).toBe(true);

    fireEvent.change(selectorVenta(), { target: { value: '12' } });
    await waitFor(() => screen.getByText(/Documento seleccionado: V-000002/));

    lecturasDiferidas.get(7)?.({
      id: 7,
      folio: 'V-000001',
      fecha: '2026-11-05',
      contraparte: 'Cliente Sintético A35',
      clase_documento_fiscal: '1',
      numero_resolucion: 'ANTIGUA',
      serie_documento: null,
      numero_documento_autorizado: null,
      tratamiento_venta: null,
      tipo_operacion_renta: null,
      tipo_ingreso_renta: null
    });
    await new Promise(r => setTimeout(r, 20));

    expect(screen.getByText(/Documento seleccionado: V-000002/)).toBeTruthy();
    expect(screen.queryByText(/V-000001 del/)).toBeNull();
    const selectorDespues = selectorVenta();
    expect(selectorDespues.value).toBe('12');

    fireEvent.change(selectorVenta(), { target: { value: '0' } });
    await waitFor(() => expect(screen.queryByText(/Documento seleccionado/)).toBeNull());
    expect((screen.getByText('Registrar metadatos') as HTMLButtonElement).disabled).toBe(true);

    lecturasDiferidas.set(30, () => undefined);
    invocar.mockImplementation((comando: string, datos?: unknown) => {
      if (comando === 'fiscal:metadatosLeer') {
        return Promise.reject(new Error('fallo sintético de lectura'));
      }
      return Promise.resolve([]);
    });
    fireEvent.change(selectorVenta(), { target: { value: '12' } });
    await waitFor(() => screen.getByText(/No se pudo cargar la venta 12/));
    expect((screen.getByText('Registrar metadatos') as HTMLButtonElement).disabled || (screen.getByText('Cargando documento…') as HTMLButtonElement).disabled).toBe(true);
  });

  it('secciones Anexo 2 y Anexo 3: diagnóstico, guardado por puente y flujo de compra', async () => {
    guardarAnexo1VentasMock.mockResolvedValue({ guardado: true, ruta: 'C:\\sintetico\\anexo2.csv', filas: 2 });
    render(<Impuestos />);
    fireEvent.click(screen.getByRole('tab', { name: 'Anexos' }));
    await waitFor(() => screen.getByText(/Anexo 2 F-07 v14/));
    expect(screen.getByText(/Anexo 3 F-07 v14/)).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText('2026-11'), { target: { value: '2026-11' } });
    fireEvent.click(screen.getByText('Diagnosticar Anexo 3'));
    await waitFor(() => screen.getByText(/X-000001: clase de documento/));

    fireEvent.click(screen.getByText('Guardar Anexo 2…'));
    await waitFor(() => screen.getByText(/Anexo 2 guardado en/));
    expect(guardarAnexo1VentasMock).toHaveBeenCalledWith(2, '2026-11');

    const form = screen.getByText('Registrar metadatos').closest('form') as HTMLFormElement;
    const dentro = within(form);
    const selectorTipo = dentro.getAllByRole('combobox').find(
      c => Array.from((c as HTMLSelectElement).options).some(o => o.value === 'compra')
    ) as HTMLSelectElement;
    fireEvent.change(selectorTipo, { target: { value: 'compra' } });
    await waitFor(() =>
      expect(
        dentro.getAllByRole('combobox').some(c =>
          Array.from((c as HTMLSelectElement).options).some(o => o.value === '21')
        )
      ).toBe(true)
    );
    // Completar desde el diagnóstico 3 debe abrir la COMPRA (tipo explícito), no una venta.
    fireEvent.click(screen.getByText('Completar…'));
    await waitFor(() => screen.getByText(/Documento seleccionado: CMP-000001 del 2026-11-07 · Proveedor Sintético/));
    expect(invocar.mock.calls.some(c => c[0] === 'fiscal:metadatosLeer' && (c[1] as { tipo: string }).tipo === 'compra')).toBe(true);

    // Rellenar y guardar: el payload de compra lleva R/S/T y NO exige tipoIngresoRenta.
    fireEvent.change(dentro.getByLabelText(/Resolución\n?/) as HTMLInputElement, { target: { value: 'R-SINTETICA' } });
    fireEvent.change(dentro.getByLabelText(/^Serie\n?/) as HTMLInputElement, { target: { value: 'A' } });
    fireEvent.change(dentro.getByLabelText(/Número autorizado\n?/) as HTMLInputElement, { target: { value: 'CCF-1' } });
    fireEvent.change(dentro.getByLabelText(/Clasificación \(R\)\n?/) as HTMLInputElement, { target: { value: '2' } });
    fireEvent.change(dentro.getByLabelText(/Sector \(S\)\n?/) as HTMLInputElement, { target: { value: '4' } });
    fireEvent.change(dentro.getByLabelText(/Tipo costo\/gasto \(T\)\n?/) as HTMLInputElement, { target: { value: '7' } });
    fireEvent.change(dentro.getAllByLabelText(/Responsable\n?/)[0] as HTMLInputElement, { target: { value: 'p' } });
    fireEvent.change(dentro.getAllByLabelText(/^Motivo\n?/)[0] as HTMLInputElement, { target: { value: 'motivo sintético' } });
    const selectorQ = dentro.getAllByRole('combobox').find(
      c => Array.from((c as HTMLSelectElement).options).some(o => o.value === '4') && (c as HTMLSelectElement).options.length === 5
    ) as HTMLSelectElement;
    fireEvent.change(selectorQ, { target: { value: '1' } });
    fireEvent.click(screen.getByText('Registrar metadatos'));

    await waitFor(() => screen.getByText(/Metadatos fiscales registrados en bitácora/));
    const llamadaGuardar = invocar.mock.calls.find(c => c[0] === 'fiscal:metadatosCompletar');
    expect(llamadaGuardar).toBeTruthy();
    const payload = llamadaGuardar![1] as Record<string, unknown>;
    expect(payload.tipo).toBe('compra');
    expect(payload.clasificacionRenta).toBe('2');
    expect(payload.sector).toBe('4');
    expect(payload.tipoCostoGasto).toBe('7');
    expect(payload.tipoIngresoRenta).toBeUndefined();
    // Tras guardar se reconsulta el diagnóstico del ANEXO DE ORIGEN (3), no el 1.
    expect(invocar.mock.calls.some(c => c[0] === 'fiscal:anexo3Compras')).toBe(true);
  });

  it('la vía auditada registra metadatos y refresca el diagnóstico', async () => {
    render(<Impuestos />);
    fireEvent.click(screen.getByRole('tab', { name: 'Anexos' }));
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
