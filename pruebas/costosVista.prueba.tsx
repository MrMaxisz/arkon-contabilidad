// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';

// Bloque 4B: pantalla de costos. Cifras a mano:
// Proyecto A: costo 142.00 (100+20+10+5+7) e ingreso 200.00 => margen 58.00 (29.00%).
// Proyecto B: costo 40.00 e ingreso 50.00 => margen 10.00 (20.00%).
// Sin proyecto: costo 11.00 (8+3) y sin ingreso => margen -11.00 y porcentaje indefinido.
// Totales: costo 193.00, ingreso 250.00, margen 57.00 (22.80%).

const invocar = vi.hoisted(() => vi.fn());
const reportePdf = vi.hoisted(() => vi.fn());

vi.mock('../src/renderer/api', () => ({
  api: () => ({
    invocar: (comando: string, datos?: unknown) => invocar(comando, datos),
    reportePdf: (solicitud: unknown) => reportePdf(solicitud)
  })
}));

import Costos from '../src/renderer/vistas/Costos';

function cuentasMateriales() {
  return [{ codigo: '5101', nombre: 'Costo de materiales', tipo: 'costo', importeMinor: '148.00' }];
}

function reporteProyecto(desde: string, hasta: string, codigoA = 'P-A') {
  return {
    desde,
    hasta,
    ambitoId: 'administrativo',
    proyectos: [
      {
        proyectoId: 1, codigo: codigoA, nombre: 'Proyecto A',
        materialesMinor: '100.00', personalMinor: '20.00', transporteMinor: '10.00',
        subcontratacionMinor: '5.00', otrosMinor: '7.00', costoMinor: '142.00',
        ingresoMinor: '200.00', margenMinor: '58.00', margenPorcentaje: '29.00',
        cuentas: [
          { codigo: '5101', nombre: 'Costo de materiales', tipo: 'costo', importeMinor: '100.00' }
        ]
      },
      {
        proyectoId: 2, codigo: 'P-B', nombre: 'Proyecto B',
        materialesMinor: '40.00', personalMinor: '0.00', transporteMinor: '0.00',
        subcontratacionMinor: '0.00', otrosMinor: '0.00', costoMinor: '40.00',
        ingresoMinor: '50.00', margenMinor: '10.00', margenPorcentaje: '20.00',
        cuentas: []
      }
    ],
    sinProyecto: {
      proyectoId: null, codigo: '', nombre: 'Sin proyecto',
      materialesMinor: '8.00', personalMinor: '0.00', transporteMinor: '0.00',
      subcontratacionMinor: '0.00', otrosMinor: '3.00', costoMinor: '11.00',
      ingresoMinor: '0.00', margenMinor: '-11.00', margenPorcentaje: null,
      cuentas: []
    },
    totalCostoMinor: '193.00',
    totalIngresoMinor: '250.00',
    totalMargenMinor: '57.00',
    margenPorcentaje: '22.80',
    provisional: true
  };
}

function reporteTipo(desde: string, hasta: string, comparativo: boolean) {
  return {
    desde,
    hasta,
    ambitoId: 'administrativo',
    tipos: [
      { tipo: 'materiales', nombre: 'Materiales', importeMinor: '148.00', cuentas: cuentasMateriales() },
      { tipo: 'personal', nombre: 'Personal', importeMinor: '20.00', cuentas: [] },
      { tipo: 'transporte', nombre: 'Transporte', importeMinor: '10.00', cuentas: [] },
      { tipo: 'subcontratacion', nombre: 'Subcontratación', importeMinor: '5.00', cuentas: [] },
      { tipo: 'otros', nombre: 'Otros costos', importeMinor: '10.00', cuentas: [] }
    ],
    totalCostoMinor: '193.00',
    periodoAnterior: comparativo
      ? {
          desde: '2026-02-01',
          hasta: '2026-02-28',
          ambitoId: 'administrativo',
          tipos: [
            { tipo: 'materiales', nombre: 'Materiales', importeMinor: '12.00', cuentas: [] },
            { tipo: 'personal', nombre: 'Personal', importeMinor: '0.00', cuentas: [] },
            { tipo: 'transporte', nombre: 'Transporte', importeMinor: '0.00', cuentas: [] },
            { tipo: 'subcontratacion', nombre: 'Subcontratación', importeMinor: '0.00', cuentas: [] },
            { tipo: 'otros', nombre: 'Otros costos', importeMinor: '0.00', cuentas: [] }
          ],
          totalCostoMinor: '12.00'
        }
      : null
  };
}

function conciliacion(desde: string, hasta: string) {
  return {
    desde,
    hasta,
    ambitoId: 'administrativo',
    totalCostosMinor: '193.00',
    costosEstadoResultadosMinor: '193.00',
    diferenciaMinor: '0.00',
    cuadra: true
  };
}

function respuesta(comando: string, datos?: unknown, codigoA = 'P-A'): unknown {
  const rango = (datos ?? {}) as { desde: string; hasta: string; comparativo?: boolean };
  switch (comando) {
    case 'reporte:costosPorProyecto':
      return reporteProyecto(rango.desde, rango.hasta, codigoA);
    case 'reporte:costosPorTipo':
      return reporteTipo(rango.desde, rango.hasta, rango.comparativo !== false);
    case 'reporte:costosConciliacion':
      return conciliacion(rango.desde, rango.hasta);
    default:
      return null;
  }
}

function llamadas(comando: string): Array<Record<string, unknown> | undefined> {
  return invocar.mock.calls.filter(c => c[0] === comando).map(c => c[1] as Record<string, unknown> | undefined);
}

beforeEach(() => {
  invocar.mockReset();
  reportePdf.mockReset();
  invocar.mockImplementation((comando: string, datos?: unknown) => Promise.resolve(respuesta(comando, datos)));
  reportePdf.mockResolvedValue({ guardado: true, ruta: 'C:\\reportes\\costos.pdf' });
});

afterEach(() => {
  cleanup();
});

describe('bloque 4B: pantalla de costos', () => {
  it('muestra proyecto, margen, sin proyecto, tipo comparativo y conciliación; filtra en fila compacta', async () => {
    render(<Costos />);
    expect(await screen.findByText('P-A')).toBeTruthy();

    const tablaProyecto = screen.getByRole('table', { name: 'Costos por proyecto' });
    const filaA = within(tablaProyecto).getByText('P-A').closest('tr')!;
    expect(filaA.textContent).toContain('$100.00');
    expect(filaA.textContent).toContain('$142.00');
    expect(filaA.textContent).toContain('$58.00');
    expect(filaA.textContent).toContain('29.00%');
    expect(within(tablaProyecto).getByText('Sin proyecto')).toBeTruthy();

    const tablaTipo = screen.getByRole('table', { name: 'Costos por tipo' });
    const filaMateriales = within(tablaTipo).getByText('Materiales').closest('tr')!;
    expect(filaMateriales.textContent).toContain('$148.00');
    expect(filaMateriales.textContent).toContain('$12.00');
    expect(filaMateriales.textContent).toContain('$136.00');

    expect(screen.getByText(/Comparativo: 2026-02-01 a 2026-02-28/)).toBeTruthy();
    expect(screen.getByText(/Los costos concilian con el estado de resultados/)).toBeTruthy();
    expect(llamadas('reporte:costosPorProyecto')).toHaveLength(1);
    expect(llamadas('reporte:costosPorTipo')).toHaveLength(1);

    fireEvent.change(screen.getByLabelText(/^Desde$/), { target: { value: '2026-03-01' } });
    await waitFor(() => {
      const ultima = llamadas('reporte:costosPorProyecto').at(-1);
      expect(ultima).toMatchObject({ desde: '2026-03-01', hasta: '2026-12-31' });
    });

    fireEvent.change(screen.getByLabelText(/^Comparativo$/), { target: { value: 'no' } });
    await waitFor(() => expect(llamadas('reporte:costosPorTipo').at(-1)).toMatchObject({ comparativo: false }));
    expect(await screen.findByText('Comparativo desactivado.')).toBeTruthy();
  });

  it('descarta una respuesta tardía al cambiar el rango', async () => {
    const pendientes: Array<{ comando: string; resolver: (valor: unknown) => void }> = [];
    invocar.mockImplementation((comando: string, datos?: unknown) => {
      const rango = datos as { desde: string };
      if (rango.desde === '2026-01-01') {
        return new Promise<unknown>(resolver => pendientes.push({ comando, resolver }));
      }
      return Promise.resolve(respuesta(comando, datos, 'P-NUEVO'));
    });

    render(<Costos />);
    await waitFor(() => expect(pendientes).toHaveLength(3));

    fireEvent.change(screen.getByLabelText(/^Desde$/), { target: { value: '2026-02-01' } });
    expect(await screen.findByText('P-NUEVO')).toBeTruthy();

    for (const pendiente of pendientes) {
      pendiente.resolver(respuesta(pendiente.comando, {
        desde: '2026-01-01', hasta: '2026-12-31', comparativo: true
      }, 'P-VIEJO'));
    }
    await new Promise(resolver => setTimeout(resolver, 20));

    expect(screen.queryByText('P-VIEJO')).toBeNull();
    expect(screen.getByText('P-NUEVO')).toBeTruthy();
  });

  it('guarda el PDF con las mismas tablas y cifras de la pantalla', async () => {
    render(<Costos />);
    await screen.findByText('P-A');

    fireEvent.click(screen.getByText('Guardar PDF…'));
    await waitFor(() => expect(reportePdf).toHaveBeenCalledTimes(1));

    const solicitud = reportePdf.mock.calls[0]![0] as {
      titulo: string;
      periodo: string;
      ambito: string;
      tablas: Array<{ titulo?: string; filas: string[][] }>;
    };
    expect(solicitud.titulo).toBe('Costos por proyecto y tipo');
    expect(solicitud.periodo).toBe('2026-01-01 a 2026-12-31');
    expect(solicitud.ambito).toBe('administrativo');
    expect(solicitud.tablas.map(t => t.titulo)).toEqual([
      'Por proyecto y margen', 'Por tipo y comparativo', 'Conciliación'
    ]);

    const tablaProyecto = solicitud.tablas.find(t => t.titulo === 'Por proyecto y margen')!;
    expect(tablaProyecto.filas).toHaveLength(3);
    expect(tablaProyecto.filas[0]).toEqual([
      'P-A', 'Proyecto A', '$100.00', '$20.00', '$10.00', '$5.00', '$7.00',
      '$142.00', '$200.00', '$58.00', '29.00%'
    ]);
    expect(tablaProyecto.filas[2]![0]).toBe('—');

    const tablaTipo = solicitud.tablas.find(t => t.titulo === 'Por tipo y comparativo')!;
    expect(tablaTipo.filas.find(f => f[0] === 'Materiales')).toEqual([
      'Materiales', '$148.00', '$12.00', '$136.00'
    ]);

    const tablaConciliacion = solicitud.tablas.find(t => t.titulo === 'Conciliación')!;
    expect(tablaConciliacion.filas[0]).toEqual(['Costos por proyecto', '$193.00']);

    expect(await screen.findByText(/PDF de costos guardado/)).toBeTruthy();
  });
});
