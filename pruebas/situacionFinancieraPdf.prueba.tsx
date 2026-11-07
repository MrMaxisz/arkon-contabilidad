// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

// Bloque 6D: PDF del estado de situación financiera.
// Cifras calculadas a mano:
// activo = 1234.56 + 900.00 - 100.00 = 2034.56
// pasivo = 500.00 + 700.00 + 50.00 = 1250.00
// patrimonio = 1000.00 - 215.44 = 784.56 => 1250.00 + 784.56 = 2034.56 (cuadra).

const invocar = vi.hoisted(() => vi.fn());
const reportePdf = vi.hoisted(() => vi.fn());

vi.mock('../src/renderer/api', () => ({
  api: () => ({
    invocar: (comando: string, datos?: unknown) => invocar(comando, datos),
    reportePdf: (solicitud: unknown) => reportePdf(solicitud)
  })
}));

import EstadosFinancieros from '../src/renderer/vistas/EstadosFinancieros';

interface SolicitudReporte {
  titulo: string;
  periodo?: string;
  ambito?: string;
  tablas: Array<{ titulo?: string; encabezados: string[]; filas: string[][]; total?: string[] }>;
}

function fila(codigo: string, nombre: string, corriente: boolean, sinClasificar: boolean, saldoMinor: string) {
  return { codigo, nombre, corriente, sinClasificar, saldoMinor };
}

function situacion(comparativo: boolean, conContrarios = true) {
  const estado = {
    corte: '2026-12-31',
    activo: {
      corriente: [fila('1101', 'Caja', true, false, '1234.56')],
      noCorriente: [fila('1501', 'Equipo', false, false, '900.00')],
      sinClasificar: [fila('1199', 'Cuenta por clasificar', false, true, '-100.00')],
      totalMinor: '2034.56'
    },
    pasivo: {
      corriente: [fila('2101', 'Proveedores', true, false, '500.00')],
      noCorriente: [fila('2201', 'Préstamo', false, false, '700.00')],
      sinClasificar: [fila('2999', 'Pasivo por clasificar', false, true, '50.00')],
      totalMinor: '1250.00'
    },
    patrimonio: {
      filas: [
        fila('3101', 'Capital', false, false, '1000.00'),
        fila('3201', 'Resultado acumulado', false, false, '-215.44')
      ],
      resultadoEjercicioMinor: '0.00',
      totalMinor: '784.56'
    },
    cuadra: true,
    saldosContrarios: conContrarios
      ? [
          { codigo: '1199', nombre: 'Cuenta por clasificar', saldoMinor: '-100.00' },
          { codigo: '3201', nombre: 'Resultado acumulado', saldoMinor: '-215.44' }
        ]
      : [],
    comparativo: comparativo
      ? {
          corte: '2025-12-31',
          activo: { corriente: [], noCorriente: [], sinClasificar: [], totalMinor: '1900.00' },
          pasivo: { corriente: [], noCorriente: [], sinClasificar: [], totalMinor: '1200.00' },
          patrimonio: { filas: [], resultadoEjercicioMinor: '0.00', totalMinor: '700.00' },
          cuadra: true,
          saldosContrarios: [],
          comparativo: null
        }
      : null
  };
  return estado;
}

beforeEach(() => {
  invocar.mockReset();
  reportePdf.mockReset();
  invocar.mockImplementation((comando: string) => {
    if (comando === 'situacion:consultar') {
      return Promise.resolve(situacion(true));
    }
    return Promise.resolve(null);
  });
  reportePdf.mockResolvedValue({ guardado: true, ruta: 'C:\\reportes\\situacion.pdf' });
});

afterEach(() => {
  cleanup();
});

async function abrirEImprimir(comparativo: boolean, conContrarios = true) {
  invocar.mockImplementation((comando: string) => {
    if (comando === 'situacion:consultar') {
      return Promise.resolve(situacion(comparativo, conContrarios));
    }
    return Promise.resolve(null);
  });
  let capturada: SolicitudReporte | null = null;
  reportePdf.mockImplementation((solicitud: SolicitudReporte) => {
    capturada = solicitud;
    return Promise.resolve({ guardado: true, ruta: 'C:\\reportes\\situacion.pdf' });
  });
  render(<EstadosFinancieros />);
  fireEvent.click(screen.getByText('Estado de situación financiera'));
  await screen.findByText('Total activo');
  fireEvent.click(screen.getByText('Imprimir…'));
  expect(await screen.findByText(/Reporte guardado en C:\\reportes\\situacion\.pdf/)).toBeTruthy();
  return capturada as SolicitudReporte;
}

describe('6D: PDF del estado de situación financiera', () => {
  it('incluye secciones, sin clasificar, totales, saldos contrarios y comparativo con separador de miles', async () => {
    const capturada = await abrirEImprimir(true);

    expect(capturada.titulo).toBe('Estado de situación financiera');
    expect(capturada.periodo).toBe('Al 2026-12-31');
    expect(capturada.ambito).toBe('administrativo');

    expect(capturada.tablas.map(t => t.titulo)).toEqual([
      'Activo corriente',
      'Activo no corriente',
      'Activo sin clasificar',
      'Pasivo corriente',
      'Pasivo no corriente',
      'Pasivo sin clasificar',
      'Patrimonio',
      'Totales',
      'Saldos contrarios',
      'Comparativo al 2025-12-31'
    ]);

    // Separador de miles en todas las cifras.
    expect(capturada.tablas[0]!.filas).toEqual([['1101', 'Caja', '$1,234.56']]);
    expect(capturada.tablas[1]!.filas).toEqual([['1501', 'Equipo', '$900.00']]);
    // El saldo contrario de activo conserva su signo.
    expect(capturada.tablas[2]!.filas).toEqual([['1199', 'Cuenta por clasificar', '-$100.00']]);

    expect(capturada.tablas[3]!.filas).toEqual([['2101', 'Proveedores', '$500.00']]);
    expect(capturada.tablas[4]!.filas).toEqual([['2201', 'Préstamo', '$700.00']]);
    expect(capturada.tablas[5]!.filas).toEqual([['2999', 'Pasivo por clasificar', '$50.00']]);
    // El saldo contrario de patrimonio conserva su signo.
    expect(capturada.tablas[6]!.filas).toEqual([
      ['3101', 'Capital', '$1,000.00'],
      ['3201', 'Resultado acumulado', '-$215.44']
    ]);

    expect(capturada.tablas[7]!.filas).toEqual([
      ['Total activo', '', '$2,034.56'],
      ['Total pasivo', '', '$1,250.00'],
      ['Total patrimonio', '', '$784.56']
    ]);

    expect(capturada.tablas[8]!.filas).toEqual([
      ['1199', 'Cuenta por clasificar', '-$100.00'],
      ['3201', 'Resultado acumulado', '-$215.44']
    ]);

    expect(capturada.tablas[9]!.filas).toEqual([
      ['Total activo', '$1,900.00'],
      ['Total pasivo', '$1,200.00'],
      ['Total patrimonio', '$700.00']
    ]);
  });

  it('omite el comparativo y los saldos contrarios cuando no existen', async () => {
    const capturada = await abrirEImprimir(false, false);
    const titulos = capturada.tablas.map(t => t.titulo);
    expect(titulos).not.toContain('Comparativo al 2025-12-31');
    expect(titulos).not.toContain('Saldos contrarios');
    expect(titulos).toContain('Totales');
  });
});
