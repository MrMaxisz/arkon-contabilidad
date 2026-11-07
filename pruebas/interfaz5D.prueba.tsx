// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';

// Bloque 5D: cuadrícula de partidas, búsqueda y paginación visibles, y prueba de
// ausencia de botones sin estilo. Cifras a mano: debe 50.00 y haber 30.00 →
// totales debe 50.00, haber 30.00 y diferencia 20.00.

const invocar = vi.hoisted(() => vi.fn());
const reportePdf = vi.hoisted(() => vi.fn());

vi.mock('../src/renderer/api', () => ({
  api: () => ({
    invocar: (comando: string, datos?: unknown) => invocar(comando, datos),
    reportePdf: (solicitud: unknown) => reportePdf(solicitud)
  })
}));

import Contabilidad from '../src/renderer/vistas/Contabilidad';
import Cierre from '../src/renderer/vistas/Cierre';
import Bitacora from '../src/renderer/vistas/Bitacora';
import Respaldo from '../src/renderer/vistas/Respaldo';
import Impuestos from '../src/renderer/vistas/Impuestos';
import ActivosFijos from '../src/renderer/vistas/ActivosFijos';

const VISTAS = ['Contabilidad', 'Cierre', 'Ajustes', 'Respaldo', 'Bitacora', 'Impuestos', 'ActivosFijos'];

function evento(n: number) {
  return {
    id: n,
    fecha: '2026-01-01 03:00:00',
    actor: 'qa',
    tipo: 'operacion',
    entidad: 'asiento',
    entidadId: String(n),
    detalle: `Evento sintético ${n}`
  };
}

function respaldo(n: number) {
  return {
    id: n,
    creadoEn: `2026-01-01 03:00:00`,
    nombre: `respaldo-manual-${String(n).padStart(2, '0')}.db`,
    hashSha256: 'a'.repeat(64),
    versionApp: 'qa',
    versionEsquema: 9,
    estado: 'válido'
  };
}

function adjunto(n: number) {
  return {
    id: n,
    entidad: 'venta',
    entidadId: `V-${String(n).padStart(6, '0')}`,
    nombreOriginal: `soporte-${n}.pdf`,
    hashSha256: 'b'.repeat(64),
    creadoEn: '2026-01-01 03:00:00'
  };
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  invocar.mockReset();
  reportePdf.mockReset();
  invocar.mockImplementation(() => Promise.resolve([]));
});

afterEach(() => {
  cleanup();
});

describe('bloque 5D: ausencia de botones sin estilo', () => {
  it('ninguna vista crea <button> sin clase del sistema', () => {
    for (const vista of VISTAS) {
      const contenido = fs.readFileSync(path.resolve(__dirname, `../src/renderer/vistas/${vista}.tsx`), 'utf8');
      const sueltos = contenido.match(/<button(?![^>]*className)[^>]*>/g);
      expect(sueltos, `${vista} tiene botones sin estilo: ${JSON.stringify(sueltos)}`).toBeNull();
    }
  });

  it('los botones del sistema anidan la ventana y todas las vistas usan tokens propios', () => {
    const activos = fs.readFileSync(path.resolve(__dirname, '../src/renderer/vistas/ActivosFijos.tsx'), 'utf8');
    expect(activos).toContain('SeccionPlegable');
    const impuestos = fs.readFileSync(path.resolve(__dirname, '../src/renderer/vistas/Impuestos.tsx'), 'utf8');
    expect(impuestos).toContain('role="tablist"');
    expect(impuestos).toContain('activo-pestana');
  });
});

describe('bloque 5D: cuadrícula de partidas con totales en Contabilidad', () => {
  it('suma debe, haber y diferencia en la cuadrícula con cifras a mano', async () => {
    invocar.mockImplementation((comando: string) => {
      if (comando === 'cuenta:listar') {
        return Promise.resolve([
          { id: 1, codigo: '1101', nombre: 'Efectivo', tipo: 'activo', esGrupo: false, activa: true }
        ]);
      }
      return Promise.resolve([]);
    });
    render(<Contabilidad alCambiar={() => undefined} />);

    fireEvent.change(screen.getAllByLabelText('Debe')[0]!, { target: { value: '50.00' } });
    fireEvent.change(screen.getAllByLabelText('Haber')[1]!, { target: { value: '30.00' } });

    expect(screen.getByText('$50.00')).toBeTruthy();
    expect(screen.getByText('$30.00')).toBeTruthy();
    expect(screen.getByText('Diferencia: $20.00')).toBeTruthy();
    expect(document.querySelector('.fila-linea')).toBeTruthy();
  });
});

describe('bloque 5D: búsqueda y paginación en Cierre', () => {
  it('cuentas de resultado paginadas: 12 cuentas en 2 páginas y filtro', async () => {
    invocar.mockImplementation((comando: string) => {
      if (comando === 'cierre:estado') {
        return Promise.resolve({
          anio: 2026,
          periodos: [{ id: 1, inicio: '2026-12-01', fin: '2026-12-31', estado: 'abierto' }],
          cuentasResultado: Array.from({ length: 12 }, (_, i) => ({
            codigo: `41${String(i + 1).padStart(2, '0')}`,
            nombre: `Resultado ${i + 1}`,
            tipo: 'ingreso',
            saldoMinor: '10.00'
          })),
          resultadoNetoMinor: '120.00',
          cierreExistente: null,
          periodoDiciembreAbierto: true
        });
      }
      return Promise.resolve([]);
    });
    render(<Cierre />);

    fireEvent.change(screen.getByLabelText(/Año del ejercicio\n?/), { target: { value: '2026' } });
    await waitFor(() => screen.getByText('Resultado neto del ejercicio: $120.00'));

    fireEvent.change(screen.getByLabelText(/Buscar cuenta/), { target: { value: '4112' } });
    await waitFor(() => expect(screen.getByText('1 cuenta(s) · Página 1 de 1')).toBeTruthy());
    fireEvent.change(screen.getByLabelText(/Buscar cuenta/), { target: { value: '' } });
    await waitFor(() => expect(screen.getByText('12 cuenta(s) · Página 1 de 2')).toBeTruthy());

    fireEvent.click(screen.getByText('Siguientes'));
    expect(screen.getByText('12 cuenta(s) · Página 2 de 2')).toBeTruthy();
    expect(screen.getByText(/Resultado 11/)).toBeTruthy();
  });
});

describe('bloque 5D: búsqueda y paginación en Bitacora y Respaldo', () => {
  it('bitácora: 55 eventos en 2 páginas con filtro por texto', async () => {
    invocar.mockImplementation((comando: string) => {
      if (comando === 'bitacora:listar') {
        return Promise.resolve(Array.from({ length: 55 }, (_, i) => evento(i + 1)));
      }
      return Promise.resolve([]);
    });
    render(<Bitacora />);

    const linea = await screen.findByText('55 evento(s) · Página 1 de 2');
    expect(linea).toBeTruthy();
    expect(screen.getByText('Evento sintético 1')).toBeTruthy();
    fireEvent.click(screen.getByText('Siguientes'));
    expect(screen.getByText('55 evento(s) · Página 2 de 2')).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/Buscar evento/), { target: { value: 'Evento sintético 7' } });
    expect(screen.getByText('1 evento(s) · Página 1 de 1')).toBeTruthy();
  });

  it('respaldos y adjuntos con paginación visible', async () => {
    invocar.mockImplementation((comando: string) => {
      if (comando === 'respaldo:listar') {
        return Promise.resolve(Array.from({ length: 12 }, (_, i) => respaldo(i + 1)));
      }
      if (comando === 'adjunto:listar') {
        return Promise.resolve(Array.from({ length: 12 }, (_, i) => adjunto(i + 1)));
      }
      if (comando === 'config:respaldoPeriodicoLeer') {
        return Promise.resolve({ intervaloMinutos: 0, retencion: 5 });
      }
      if (comando === 'respaldo:estadoPeriodico') {
        return Promise.resolve({ intervaloMinutos: 0, ultimoRespaldo: null, ultimoFallo: null, proximaEjecucion: null });
      }
      if (comando === 'documento:listarVinculos') {
        return Promise.resolve({ venta: [], compra: [], cotizacion: [], proyecto: [] });
      }
      return Promise.resolve([]);
    });
    render(<Respaldo />);

    expect(await screen.findByText('12 respaldo(s) · Página 1 de 2')).toBeTruthy();
    expect(screen.getByText('respaldo-manual-01.db')).toBeTruthy();
    expect(screen.getByText('12 adjunto(s) · Página 1 de 2')).toBeTruthy();
  });
});

describe('bloque 5D: pestañas del sistema en Impuestos y secciones plegables en ActivosFijos', () => {
  it('pestañas de impuestos con rol, secundario y estado activo', async () => {
    render(<Impuestos />);
    const activa = screen.getByRole('tab', { name: 'Configuración' }) as HTMLButtonElement;
    expect(activa.className).toContain('secundario');
    expect(activa.className).toContain('activo-pestana');
    fireEvent.click(screen.getByRole('tab', { name: 'Anexos' }));
    const anexos = screen.getByRole('tab', { name: 'Anexos' }) as HTMLButtonElement;
    expect(anexos.className).toContain('activo-pestana');
    expect((screen.getByRole('button', { name: 'Diagnosticar' }) as HTMLButtonElement).className).toContain('secundario');
    await screen.findByText(/Estructura oficial F-07 v14/);
  });

  it('activos fijos: Ficha es secundario y la vista está dividida en secciones plegables', async () => {
    invocar.mockImplementation((comando: string) => {
      if (comando === 'activo:listar') {
        return Promise.resolve([{
          id: 1, codigo: 'AF-000001', descripcion: 'Activo sintético 5D', categoria: 'Herramientas',
          ubicacion: 'Bodega', responsable: 'qa', fechaAdquisicion: '2026-01-10', fechaInicioUso: '2026-01-15',
          costoMinor: '1200.00', residualMinor: '0.00', vidaUtilMeses: 12, estado: 'activo',
          cuentaActivoId: 1, cuentaDepreciacionId: 2, cuentaGastoId: 3, compraId: null, proyectoId: null,
          acumuladaMinor: '500.00', valorLibrosMinor: '700.00'
        }]);
      }
      if (comando === 'cuenta:listar') {
        return Promise.resolve([{ id: 1, codigo: '1501', nombre: 'Activos fijos', tipo: 'activo', esGrupo: false, activa: true }]);
      }
      if (comando === 'activo:ficha') {
        return Promise.resolve({
          activo: {
            id: 1, codigo: 'AF-000001', descripcion: 'Activo sintético 5D', categoria: 'Herramientas',
            ubicacion: 'Bodega', responsable: 'qa', fechaAdquisicion: '2026-01-10', fechaInicioUso: '2026-01-15',
            costoMinor: '1200.00', residualMinor: '0.00', vidaUtilMeses: 12, estado: 'activo',
            cuentaActivoId: 1, cuentaDepreciacionId: 2, cuentaGastoId: 3, compraId: null, proyectoId: null,
            acumuladaMinor: '500.00', valorLibrosMinor: '700.00'
          },
          mesInicio: '2026-02',
          cuotas: [{
            mes: '2026-02', numero: 1, cuotaMinor: '100.00', acumuladoMinor: '100.00',
            aplicada: true, loteId: 1, asientoFolio: 'A-000010', fechaAplicacion: '2026-02-28'
          }],
          acumuladaMinor: '500.00',
          valorLibrosMinor: '700.00',
          baja: null
        });
      }
      return Promise.resolve(null);
    });
    render(<ActivosFijos />);
    await screen.findByText('AF-000001');

    const ficha = screen.getByRole('button', { name: 'Ficha' }) as HTMLButtonElement;
    expect(ficha.className).toContain('secundario');

    const plegables = document.querySelectorAll('.seccion-plegable');
    expect(plegables.length).toBeGreaterThanOrEqual(4);
    fireEvent.click(ficha);
    expect(await screen.findByText('Cuadro de depreciación')).toBeTruthy();
  });
});
