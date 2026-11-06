// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';

// Bloque 3E: flujo principal de la pantalla de activos fijos.
// Cifras a mano: AF-000001 cuesta 1,200.00 con 500.00 acumulada y 700.00 en libros.

const invocar = vi.hoisted(() => vi.fn());
const reportePdf = vi.hoisted(() => vi.fn());

vi.mock('../src/renderer/api', () => ({
  api: () => ({
    invocar: (comando: string, datos?: unknown) => invocar(comando, datos),
    reportePdf: (solicitud: unknown) => reportePdf(solicitud)
  })
}));

import ActivosFijos from '../src/renderer/vistas/ActivosFijos';

const ACTIVO_A = {
  id: 1,
  codigo: 'AF-000001',
  descripcion: 'Herramienta sintética',
  categoria: 'Herramientas',
  ubicacion: 'Bodega sintética',
  responsable: 'qa',
  fechaAdquisicion: '2026-01-10',
  fechaInicioUso: '2026-01-15',
  costoMinor: '1200.00',
  residualMinor: '0.00',
  vidaUtilMeses: 12,
  estado: 'activo',
  cuentaActivoId: 1,
  cuentaDepreciacionId: 2,
  cuentaGastoId: 3,
  compraId: null,
  proyectoId: null,
  acumuladaMinor: '500.00',
  valorLibrosMinor: '700.00'
};

const ACTIVO_B = {
  ...ACTIVO_A,
  id: 2,
  codigo: 'AF-000002',
  descripcion: 'Equipo sintético',
  categoria: 'Equipos',
  ubicacion: 'Taller sintético',
  costoMinor: '1000.00',
  acumuladaMinor: '1000.00',
  valorLibrosMinor: '0.00'
};

const CUENTAS = [
  { id: 1, codigo: '1501', nombre: 'Activos fijos', tipo: 'activo', esGrupo: false, activa: true },
  { id: 2, codigo: '1502', nombre: 'Depreciación acumulada', tipo: 'activo', esGrupo: false, activa: true },
  { id: 3, codigo: '6101', nombre: 'Gasto de depreciación', tipo: 'gasto', esGrupo: false, activa: true },
  { id: 4, codigo: '1101', nombre: 'Efectivo', tipo: 'activo', esGrupo: false, activa: true }
];

const LOTE = {
  id: 1,
  mes: '2026-02',
  totalMinor: '500.00',
  responsable: 'qa',
  asientoFolio: 'A-000010',
  fecha: '2026-02-28'
};

const FICHA_A = {
  activo: ACTIVO_A,
  mesInicio: '2026-02',
  cuotas: [
    {
      mes: '2026-02', numero: 1, cuotaMinor: '100.00', acumuladoMinor: '100.00',
      aplicada: true, loteId: 1, asientoFolio: 'A-000010', fechaAplicacion: '2026-02-28'
    },
    {
      mes: '2026-03', numero: 2, cuotaMinor: '100.00', acumuladoMinor: '200.00',
      aplicada: false, loteId: null, asientoFolio: null, fechaAplicacion: null
    }
  ],
  acumuladaMinor: '500.00',
  valorLibrosMinor: '700.00',
  baja: null
};

const PREVIA = {
  mes: '2026-03',
  filas: [
    {
      activoId: 1,
      codigo: 'AF-000001',
      descripcion: 'Herramienta sintética',
      cuentaGastoId: 3,
      cuentaDepreciacionId: 2,
      numeroCuota: 2,
      mes: '2026-03',
      cuotaMinor: '100.00'
    }
  ],
  totalMinor: '100.00'
};

function respuestaBase(comando: string): unknown {
  switch (comando) {
    case 'activo:listar':
      return [ACTIVO_A, ACTIVO_B];
    case 'activo:ficha':
      return FICHA_A;
    case 'activo:ultimoLote':
      return LOTE;
    case 'cuenta:listar':
      return CUENTAS;
    case 'activo:previsualizarDepreciacion':
      return PREVIA;
    case 'activo:depreciarMes':
      return { loteId: 2, asientoFolio: 'A-000011', totalMinor: '100.00', existente: false };
    case 'activo:anularUltimoLote':
      return { mes: '2026-02', reversoFolio: 'A-000099' };
    case 'activo:alta':
      return { id: 3, codigo: 'AF-000003', asientoAltaId: 7 };
    case 'activo:baja':
      return {
        bajaId: 1,
        asientoFolio: 'A-000012',
        valorLibrosMinor: '700.00',
        resultadoMinor: '-700.00'
      };
    case 'reporte:activosFijosCuadro':
      return {
        corte: '2026-06-30',
        periodoDesde: '2026-01-01',
        periodoHasta: '2026-06-30',
        filas: [
          {
            activoId: 1, codigo: 'AF-000001', descripcion: 'Herramienta sintética', categoria: 'Herramientas',
            estado: 'activo', costoMinor: '1200.00', acumuladaMinor: '500.00',
            valorLibrosMinor: '700.00', gastoPeriodoMinor: '500.00'
          }
        ],
        categorias: [
          {
            categoria: 'Herramientas', costoMinor: '1200.00', acumuladaMinor: '500.00',
            valorLibrosMinor: '700.00', gastoPeriodoMinor: '500.00'
          }
        ],
        totales: {
          costoMinor: '1200.00', acumuladaMinor: '500.00',
          valorLibrosMinor: '700.00', gastoPeriodoMinor: '500.00'
        }
      };
    case 'reporte:activosFijosConciliacion':
      return { corte: '2026-06-30', filas: [], cuadra: true, totalDiferenciaMinor: '0.00' };
    default:
      return null;
  }
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  invocar.mockReset();
  reportePdf.mockReset();
  invocar.mockImplementation((comando: string) => Promise.resolve(respuestaBase(comando)));
  reportePdf.mockResolvedValue({ guardado: true, ruta: 'C:\\reportes\\activos.pdf' });
});

afterEach(() => {
  cleanup();
});

describe('bloque 3E: pantalla de activos fijos', () => {
  it('lista los activos y filtra en fila compacta por texto y categoría', async () => {
    render(<ActivosFijos />);
    expect(await screen.findByText('AF-000001')).toBeTruthy();
    expect(screen.getByText('AF-000002')).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/Buscar/), { target: { value: 'Equipo' } });
    await waitFor(() => expect(screen.queryByText('AF-000001')).toBeNull());
    expect(screen.getByText('AF-000002')).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/Buscar/), { target: { value: '' } });
    fireEvent.change(screen.getAllByLabelText(/Categoría/)[0]!, { target: { value: 'Herramientas' } });
    await waitFor(() => expect(screen.queryByText('AF-000002')).toBeNull());
    expect(screen.getByText('AF-000001')).toBeTruthy();
  });

  it('abre la ficha con el cuadro de depreciación aplicada y pendiente', async () => {
    render(<ActivosFijos />);
    await screen.findByText('AF-000001');
    fireEvent.click(screen.getAllByText('Ficha')[0]!);

    expect(await screen.findByText('Cuadro de depreciación')).toBeTruthy();
    expect(screen.getByText('Aplicada')).toBeTruthy();
    expect(screen.getByText('Pendiente')).toBeTruthy();
    expect(screen.getByText('A-000010')).toBeTruthy();
    expect(screen.getAllByText('$700.00').length).toBeGreaterThan(0);
  });

  it('exige vista previa antes de depreciar y registra el mes con el total calculado', async () => {
    render(<ActivosFijos />);
    await screen.findByText('AF-000001');

    fireEvent.change(screen.getByLabelText(/^Mes$/), { target: { value: '2026-03' } });
    fireEvent.change(screen.getAllByLabelText(/Responsable/)[0]!, { target: { value: 'qa' } });
    expect((screen.getByText('Depreciar mes') as HTMLButtonElement).disabled).toBe(true);
    expect(invocar.mock.calls.filter(c => c[0] === 'activo:depreciarMes').length).toBe(0);

    fireEvent.click(screen.getByText('Vista previa'));
    expect(await screen.findByText('2026-03')).toBeTruthy();
    expect(screen.getAllByText('$100.00').length).toBeGreaterThan(0);
    const previa = invocar.mock.calls.find(c => c[0] === 'activo:previsualizarDepreciacion');
    expect(previa?.[1]).toEqual({ mes: '2026-03' });
    expect((screen.getByText('Depreciar mes') as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(screen.getByText('Depreciar mes'));
    expect(await screen.findByText(/Depreciación de 2026-03 contabilizada por \$100\.00/)).toBeTruthy();
    const aplicada = invocar.mock.calls.find(c => c[0] === 'activo:depreciarMes');
    expect(aplicada?.[1]).toEqual({ mes: '2026-03', responsable: 'qa' });
  });

  it('descarta una vista previa tardía al cambiar de mes', async () => {
    let resolverAntigua: ((valor: unknown) => void) | null = null;
    invocar.mockImplementation((comando: string, datos?: unknown) => {
      if (comando === 'activo:previsualizarDepreciacion') {
        const mes = (datos as { mes: string }).mes;
        if (mes === '2026-02') {
          return new Promise<unknown>(resolver => {
            resolverAntigua = resolver;
          });
        }
        return Promise.resolve({
          mes: '2026-03',
          filas: [{ ...PREVIA.filas[0]!, mes: '2026-03', cuotaMinor: '200.00' }],
          totalMinor: '200.00'
        });
      }
      return Promise.resolve(respuestaBase(comando));
    });
    render(<ActivosFijos />);
    await screen.findByText('AF-000001');

    const mes = screen.getByLabelText(/^Mes$/);
    fireEvent.change(mes, { target: { value: '2026-02' } });
    fireEvent.click(screen.getByText('Vista previa'));
    await waitFor(() => expect(screen.getByText('Consultando…')).toBeTruthy());

    fireEvent.change(mes, { target: { value: '2026-03' } });
    await waitFor(() => expect(screen.getByText('Vista previa')).toBeTruthy());
    fireEvent.click(screen.getByText('Vista previa'));
    await waitFor(() => expect(screen.getAllByText('$200.00').length).toBeGreaterThan(0));

    resolverAntigua?.({ mes: '2026-02', filas: PREVIA.filas, totalMinor: '100.00' });
    await waitFor(() => expect(screen.queryByText('$100.00')).toBeNull());
    expect(screen.getAllByText('$200.00').length).toBeGreaterThan(0);
  });

  it('anula el último lote: Escape cancela sin invocar y la confirmación exige motivo y responsable', async () => {
    render(<ActivosFijos />);
    const boton = await screen.findByText('Anular último lote');
    fireEvent.click(boton);
    await screen.findByRole('dialog');
    const motivo = within(screen.getByRole('dialog')).getByLabelText(/Motivo de la anulación/);
    motivo.focus();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(invocar.mock.calls.some(c => c[0] === 'activo:anularUltimoLote')).toBe(false);
    expect(document.activeElement).toBe(boton);

    fireEvent.click(boton);
    const dialogo = await screen.findByRole('dialog');
    fireEvent.change(within(dialogo).getByLabelText(/Motivo de la anulación/), {
      target: { value: 'motivo sintético de anulación' }
    });
    fireEvent.change(within(dialogo).getByLabelText(/Responsable/), { target: { value: 'qa' } });
    fireEvent.click(within(dialogo).getByText('Sí, anular último lote'));

    expect(await screen.findByText(/Lote de 2026-02 anulado con reverso A-000099/)).toBeTruthy();
    const anulacion = invocar.mock.calls.find(c => c[0] === 'activo:anularUltimoLote');
    expect(anulacion?.[1]).toEqual({
      responsable: 'qa',
      motivo: 'motivo sintético de anulación'
    });
  });

  it('da de alta un activo con las cuentas elegidas', async () => {
    render(<ActivosFijos />);
    await screen.findByText('AF-000001');
    const form = screen.getByText('Dar de alta').closest('form')!;
    const dentro = within(form);
    fireEvent.change(dentro.getByLabelText(/Descripción/), { target: { value: 'Compresor sintético' } });
    fireEvent.change(dentro.getByLabelText(/Categoría/), { target: { value: 'Equipos' } });
    fireEvent.change(dentro.getByLabelText(/Ubicación/), { target: { value: 'Taller sintético' } });
    fireEvent.change(dentro.getByLabelText(/Responsable/), { target: { value: 'qa' } });
    fireEvent.change(dentro.getByLabelText(/Costo/), { target: { value: '1200.00' } });
    fireEvent.change(dentro.getByLabelText(/Cuenta de activo/), { target: { value: '1' } });
    fireEvent.change(dentro.getByLabelText(/Depreciación acumulada/), { target: { value: '2' } });
    fireEvent.change(dentro.getByLabelText(/Gasto de depreciación/), { target: { value: '3' } });
    fireEvent.change(dentro.getByLabelText(/Contrapartida/), { target: { value: '4' } });
    fireEvent.click(dentro.getByText('Dar de alta'));

    expect(await screen.findByText(/Activo AF-000003 dado de alta/)).toBeTruthy();
    const alta = invocar.mock.calls.find(c => c[0] === 'activo:alta');
    expect(alta?.[1]).toMatchObject({
      descripcion: 'Compresor sintético',
      categoria: 'Equipos',
      ubicacion: 'Taller sintético',
      responsable: 'qa',
      costoMinor: '1200.00',
      vidaUtilMeses: 12,
      cuentaActivoId: 1,
      cuentaDepreciacionId: 2,
      cuentaGastoId: 3,
      cuentaContrapartidaId: 4
    });
  });

  it('registra la venta desde la ficha con importe y cuenta de cobro', async () => {
    render(<ActivosFijos />);
    await screen.findByText('AF-000001');
    fireEvent.click(screen.getAllByText('Ficha')[0]!);
    expect(await screen.findByText('Cuadro de depreciación')).toBeTruthy();
    fireEvent.click(screen.getByText('Baja o venta'));
    const dialogo = await screen.findByRole('dialog');
    fireEvent.change(within(dialogo).getByLabelText(/Tipo/), { target: { value: 'venta' } });
    const importe = await within(dialogo).findByLabelText(/Importe/);
    fireEvent.change(importe, { target: { value: '800.00' } });
    fireEvent.change(within(dialogo).getByLabelText(/Cuenta de cobro/), { target: { value: '4' } });
    fireEvent.change(within(dialogo).getByLabelText(/Motivo/), {
      target: { value: 'venta sintética de activo' }
    });
    fireEvent.change(within(dialogo).getByLabelText(/Responsable/), { target: { value: 'qa' } });
    fireEvent.click(within(dialogo).getByText('Sí, registrar venta'));

    expect(await screen.findByText(/Venta de AF-000001 contabilizada/)).toBeTruthy();
    const baja = invocar.mock.calls.find(c => c[0] === 'activo:baja');
    expect(baja?.[1]).toEqual({
      activoId: 1,
      tipo: 'venta',
      fechaOperacion: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      importeMinor: '800.00',
      cuentaCobroId: 4,
      responsable: 'qa',
      motivo: 'venta sintética de activo'
    });
  });

  it('consulta el cuadro general, muestra la conciliación y guarda el PDF', async () => {
    render(<ActivosFijos />);
    await screen.findByText('AF-000001');
    fireEvent.click(screen.getByText('Consultar cuadro'));
    expect(await screen.findByText(/El cuadro concilia con el mayor/)).toBeTruthy();
    expect(screen.getAllByText('$1,200.00').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('$500.00').length).toBeGreaterThanOrEqual(2);

    fireEvent.click(screen.getByText('Guardar PDF…'));
    await waitFor(() => expect(reportePdf).toHaveBeenCalledTimes(1));
    const solicitud = reportePdf.mock.calls[0]![0] as {
      titulo: string;
      tablas: Array<{ titulo?: string; filas: string[][] }>;
    };
    expect(solicitud.titulo).toBe('Cuadro general de activos fijos');
    expect(solicitud.tablas.map(t => t.titulo)).toContain('Por activo');
    expect(solicitud.tablas.map(t => t.titulo)).toContain('Conciliación con el mayor');
    expect(solicitud.tablas[0]!.filas[0]).toEqual([
      'Herramientas', 'AF-000001', 'Herramienta sintética', '$1,200.00', '$500.00', '$700.00', '$500.00'
    ]);
    expect(await screen.findByText(/PDF del cuadro guardado/)).toBeTruthy();
  });
});
