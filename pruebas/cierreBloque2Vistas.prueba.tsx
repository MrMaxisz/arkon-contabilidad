// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { abrirBase, prepararRutasDatos } from '../src/main/db/conexion';
import { aplicarMigraciones } from '../src/main/db/aplicarMigraciones';
import { sembrarCatalogoBase } from '../src/main/servicios/cuentas';
import { contabilizarAsiento } from '../src/main/servicios/motorAsientos';
import { despachar, type ContextoApp } from '../src/main/comandos';
import type BetterSqlite3 from 'better-sqlite3';

// Cierre del bloque 2, vistas: integración componente → despachar real → SQLite temporal.
// El mock de api().invocar delega al despachar real; api().reportePdf captura la solicitud
// estructurada que la vista manda imprimir. Importes calculados A MANO.

interface SolicitudReporte {
  titulo: string;
  periodo?: string;
  ambito?: string;
  tablas: Array<{ titulo?: string; encabezados: string[]; filas: string[][]; total?: string[]; linea?: string[] }>;
}

let dir: string;
let rutaDb: string;
let rutas: ReturnType<typeof prepararRutasDatos>;
let db: BetterSqlite3.Database;
let ctx: ContextoApp;
const abiertas: Array<BetterSqlite3.Database> = [];
let forzarError: ((comando: string) => Error | null) | null = null;
let alReportePdf: ((solicitud: SolicitudReporte) => void) | null = null;

vi.mock('../src/renderer/api', () => ({
  api: () => ({
    invocar: (comando: string, datos?: unknown) => {
      const forzado = forzarError?.(comando);
      if (forzado) {
        return Promise.reject(forzado);
      }
      return Promise.resolve(despachar(ctx, comando, datos));
    },
    reportePdf: (solicitud: SolicitudReporte) => {
      alReportePdf?.(solicitud);
      return Promise.resolve({ guardado: true, ruta: 'reporte-sintetico.pdf' });
    }
  })
}));

import LibroDiario from '../src/renderer/vistas/LibroDiario';
import EstadosFinancieros from '../src/renderer/vistas/EstadosFinancieros';

function idCuenta(codigo: string): number {
  return (db.prepare('SELECT id FROM cuenta WHERE codigo = ?').get(codigo) as { id: number }).id;
}

function partida(
  fecha: string,
  concepto: string,
  lineas: Array<{ codigo: string; debe: string; haber: string }>,
  clave: string
): number {
  const resultado = contabilizarAsiento(db, {
    fechaOperacion: fecha,
    concepto,
    responsable: 'qa',
    ambitoId: 'administrativo',
    lineas: lineas.map(l => ({
      cuentaId: idCuenta(l.codigo),
      debeMinor: l.debe,
      haberMinor: l.haber
    })),
    claveIdempotencia: clave
  });
  return (db.prepare('SELECT id FROM asiento WHERE folio = ?').get(resultado.folio) as { id: number }).id;
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  forzarError = null;
  alReportePdf = null;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arkon-cb2v-'));
  rutas = prepararRutasDatos(path.join(dir, 'datos'));
  rutaDb = path.join(rutas.datos, 'op.db');
  db = abrirBase(rutaDb);
  aplicarMigraciones(db);
  abiertas.push(db);
  sembrarCatalogoBase(db);
  db.prepare("INSERT INTO ambito (id, nombre, tipo) VALUES ('administrativo', 'Prueba cierre bloque 2 vistas', 'administrativo')").run();
  ctx = {
    db,
    rutas,
    versionApp: 'prueba',
    rutaDb,
    reabrirBase() {
      return;
    }
  };
});

afterEach(() => {
  for (const base of abiertas.splice(0)) {
    if (base.open) {
      base.close();
    }
  }
  fs.rmSync(dir, { recursive: true, force: true });
  cleanup();
});

describe('cierre bloque 2, vistas: Libro diario', () => {
  it('P1: Ver abre el detalle de la partida con el id de ida y vuelta por el puente', async () => {
    partida(
      '2026-01-10',
      'Partida sintética de ver',
      [
        { codigo: '1101', debe: '60.00', haber: '' },
        { codigo: '1201', debe: '40.00', haber: '' },
        { codigo: '4101', debe: '', haber: '100.00' }
      ],
      'v-p1-cb2'
    );
    render(<LibroDiario />);
    expect(await screen.findByText('A-000001')).toBeTruthy();
    // El botón Ver reenvía el id recibido del listado; si viajara bigint, el canal lo rechazaría.
    fireEvent.click(screen.getByText('Ver'));
    const dialogo = await screen.findByRole('dialog', { name: 'Partida A-000001' });
    // A mano: líneas 60.00 y 40.00 de debe; la línea de ingreso abona 100.00;
    // totales del pie 60 + 40 = 100.00 de debe y 100.00 de haber.
    expect(within(dialogo).getAllByText('$60.00').length).toBe(1);
    expect(within(dialogo).getAllByText('$40.00').length).toBe(1);
    expect(within(dialogo).getAllByText('$100.00').length).toBe(3);
  });

  it('P7: un fallo al recorrer páginas para imprimir muestra el error', async () => {
    partida(
      '2026-02-10',
      'Partida sintética para imprimir',
      [
        { codigo: '1101', debe: '10.00', haber: '' },
        { codigo: '4101', debe: '', haber: '10.00' }
      ],
      'v-p7-cb2'
    );
    // La primera consulta (carga inicial) funciona; el recorrido del bucle de impresión falla.
    let llamadas = 0;
    forzarError = (comando: string) => {
      if (comando === 'libro:partidas') {
        llamadas += 1;
        if (llamadas > 1) {
          return new Error('fallo sintético recorriendo las páginas del libro');
        }
      }
      return null;
    };
    render(<LibroDiario />);
    expect(await screen.findByText('A-000001')).toBeTruthy();
    fireEvent.click(screen.getByText('Imprimir libro…'));
    // El fallo del recorrido se muestra (antes quedaba como rechazo sin manejar y nada aparecía).
    expect(await screen.findByText('fallo sintético recorriendo las páginas del libro')).toBeTruthy();
    expect(llamadas).toBeGreaterThan(1);
  });
});

describe('cierre bloque 2, vistas: PDF de resultados', () => {
  it('P6: el PDF incluye títulos, subtotales y costos y gastos en positivo', async () => {
    // Cuenta de costo fuera del grupo 51 para la línea de otros costos.
    db.prepare(
      "INSERT INTO cuenta (codigo, nombre, tipo, es_grupo, padre_id) VALUES ('5901', 'Devolución sobre costo sintética', 'costo', 0, NULL)"
    ).run();
    // Semilla sintética (todo contra 1101):
    // ingreso 100 (4101), costo 40 (5101), devolución sobre costo -5 (5901, saldo abonador),
    // administración 10 (6101), comercialización 5 (6201), otros ingresos 3 (4201), financiero 2 (6301).
    partida('2026-03-01', 'Venta sintética', [{ codigo: '1101', debe: '100.00', haber: '' }, { codigo: '4101', debe: '', haber: '100.00' }], 'v-r1-cb2');
    partida('2026-03-02', 'Costo sintético', [{ codigo: '5101', debe: '40.00', haber: '' }, { codigo: '1101', debe: '', haber: '40.00' }], 'v-r2-cb2');
    partida('2026-03-03', 'Devolución sintética', [{ codigo: '1101', debe: '5.00', haber: '' }, { codigo: '5901', debe: '', haber: '5.00' }], 'v-r3-cb2');
    partida('2026-03-04', 'Administración sintética', [{ codigo: '6101', debe: '10.00', haber: '' }, { codigo: '1101', debe: '', haber: '10.00' }], 'v-r4-cb2');
    partida('2026-03-05', 'Comercial sintético', [{ codigo: '6201', debe: '5.00', haber: '' }, { codigo: '1101', debe: '', haber: '5.00' }], 'v-r5-cb2');
    partida('2026-03-06', 'Otro ingreso sintético', [{ codigo: '1101', debe: '3.00', haber: '' }, { codigo: '4201', debe: '', haber: '3.00' }], 'v-r6-cb2');
    partida('2026-03-07', 'Financiero sintético', [{ codigo: '6301', debe: '2.00', haber: '' }, { codigo: '1101', debe: '', haber: '2.00' }], 'v-r7-cb2');

    let capturada: SolicitudReporte | null = null;
    alReportePdf = s => {
      capturada = s;
    };

    render(<EstadosFinancieros />);
    fireEvent.click(screen.getByText('Estado de resultados'));
    await screen.findByText('Utilidad bruta');
    fireEvent.click(screen.getByText('Imprimir…'));
    expect(await screen.findByText(/Reporte guardado en reporte-sintetico\.pdf/)).toBeTruthy();

    // El reporte rotula el ámbito real con el que se calcularon los datos.
    expect(capturada!.ambito).toBe('administrativo');
    // Títulos de sección (antes era una sola tabla aplanada sin títulos).
    expect(capturada!.tablas.map(t => t.titulo)).toEqual([
      'Ingresos',
      'Costos',
      'Gastos de administración y comercialización',
      'Otros ingresos y gastos financieros'
    ]);
    expect(capturada!.tablas[0]!.filas).toEqual([['4101', 'Ingresos por instalaciones', '$100.00']]);
    // El título indica la deducción: los importes se presentan en positivo, sin recalcularlos.
    const costos = capturada!.tablas[1]!;
    expect(costos.filas).toContainEqual(['5101', 'Costo de materiales', '$40.00']);
    expect(costos.filas).toContainEqual(['5901', 'Devolución sobre costo sintética', '$5.00']);
    expect(JSON.stringify(costos.filas)).not.toContain('--');
    // Subtotales calculados a mano: bruta = 100 - 40 + 5 = 65; operación = 65 - 10 - 5 = 50;
    // antes de impuestos = 50 + 3 - 2 = 51.
    expect(costos.total).toEqual(['Utilidad bruta', '', '$65.00']);
    const gastos = capturada!.tablas[2]!;
    expect(gastos.filas).toContainEqual(['6101', 'Gastos de administración', '$10.00']);
    expect(gastos.filas).toContainEqual(['6201', 'Gastos de comercialización', '$5.00']);
    expect(gastos.total).toEqual(['Utilidad de operación', '', '$50.00']);
    const otros = capturada!.tablas[3]!;
    expect(otros.filas).toEqual([['4201', 'Otros ingresos', '$3.00'], ['6301', 'Gastos financieros', '$2.00']]);
    expect(otros.total).toEqual(['Resultado antes de impuestos', '', '$51.00']);
  });

  it('6E: separa miles, conserva resultados negativos y omite la tabla adicional vacía', async () => {
    // A mano: ingreso 1,000 - costo 2,000 = pérdida de 1,000; sin otros ingresos ni financieros.
    partida('2026-03-01', 'Ingreso sintético', [{ codigo: '1101', debe: '1000.00', haber: '' }, { codigo: '4101', debe: '', haber: '1000.00' }], '6e-ingreso');
    partida('2026-03-02', 'Costo sintético', [{ codigo: '5101', debe: '2000.00', haber: '' }, { codigo: '1101', debe: '', haber: '2000.00' }], '6e-costo');
    let capturada: SolicitudReporte | null = null;
    alReportePdf = s => { capturada = s; };
    render(<EstadosFinancieros />);
    fireEvent.click(screen.getByText('Estado de resultados'));
    await screen.findByText('Utilidad bruta');
    fireEvent.click(screen.getByText('Imprimir…'));
    await screen.findByText(/Reporte guardado en reporte-sintetico\.pdf/);
    expect(capturada!.tablas[0]!.filas).toEqual([['4101', 'Ingresos por instalaciones', '$1,000.00']]);
    expect(capturada!.tablas[1]!.filas).toEqual([['5101', 'Costo de materiales', '$2,000.00']]);
    expect(capturada!.tablas[1]!.total).toEqual(['Utilidad bruta', '', '-$1,000.00']);
    expect(capturada!.tablas[2]!.total).toEqual(['Utilidad de operación', '', '-$1,000.00']);
    expect(capturada!.tablas).toHaveLength(4);
    expect(capturada!.tablas[3]).toEqual({ encabezados: [], filas: [], linea: ['Resultado antes de impuestos', '-$1,000.00'] });
  });
});
