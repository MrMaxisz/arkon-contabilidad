// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';

// Bloque 6C: ajustes de interfaz sin tocar reglas ni canales.
// Bitácora: el detalle largo salta a la línea siguiente, sin desplazar la página en horizontal.
// Contabilidad: la cuadrícula deja solo la cabecera visible con etiquetas ocultas accesibles,
// y los totales van bajo sus columnas con la diferencia aparte.
// Cifras a mano: debe 50.00 y haber 30.00 → totales 50.00 / 30.00 y diferencia 20.00.

const invocar = vi.hoisted(() => vi.fn());

vi.mock('../src/renderer/api', () => ({
  api: () => ({
    invocar: (comando: string, datos?: unknown) => invocar(comando, datos)
  })
}));

import Bitacora from '../src/renderer/vistas/Bitacora';
import Contabilidad from '../src/renderer/vistas/Contabilidad';

const estilos = fs.readFileSync(path.resolve(__dirname, '../src/renderer/estilos.css'), 'utf8');

beforeEach(() => {
  invocar.mockReset();
  invocar.mockImplementation(() => Promise.resolve([]));
});

afterEach(() => {
  cleanup();
});

describe('bloque 6C: detalle de la bitácora sin desborde horizontal', () => {
  it('las celdas de detalle rompen líneas largas y la regla está en estilos.css', async () => {
    const detalleLargo = 'H'.repeat(200); // cadena sin espacios: desbordaba la ventana (3938 px en 1366)
    invocar.mockImplementation((comando: string) => {
      if (comando === 'bitacora:listar') {
        return Promise.resolve([
          { id: 1, fecha: '2026-01-01 03:00:00', actor: 'qa', tipo: 'operacion', entidad: 'asiento', entidadId: '1', detalle: 'Detalle corto sintético' },
          { id: 2, fecha: '2026-01-02 03:00:00', actor: 'qa', tipo: 'operacion', entidad: 'asiento', entidadId: '2', detalle: detalleLargo }
        ]);
      }
      return Promise.resolve([]);
    });
    render(<Bitacora />);
    await screen.findByText('Detalle corto sintético');

    // La celda de detalle lleva la clase de salto de línea, incluso con el texto largo.
    const celdas = Array.from(document.querySelectorAll('table tbody td.menor')) as HTMLElement[];
    expect(celdas.length).toBeGreaterThanOrEqual(2);
    for (const celda of celdas) {
      expect(celda.className).toContain('romper-texto');
      expect(celda.textContent).toBeTruthy();
    }
    expect(screen.getByText(detalleLargo).className).toContain('romper-texto');

    // La regla exista de verdad: quitarla del CSS hace fallar la prueba.
    expect(estilos).toMatch(/\.romper-texto\s*\{[^}]*overflow-wrap:\s*anywhere/);
  });
});

describe('bloque 6C: cuadrícula de líneas de Contabilidad con cabecera única', () => {
  it('etiquetas de fila ocultas, totales alineados y diferencia aparte con cifras a mano', async () => {
    invocar.mockImplementation((comando: string) => {
      if (comando === 'cuenta:listar') {
        return Promise.resolve([
          { id: 1, codigo: '1101', nombre: 'Efectivo', tipo: 'activo', esGrupo: false, activa: true }
        ]);
      }
      return Promise.resolve([]);
    });
    render(<Contabilidad alCambiar={() => undefined} />);

    // Cabecera visible una sola vez; en las filas, Cuenta/Debe/Haber quedan solo como
    // etiquetas accesibles ocultas (.solo-lector).
    const cabecera = document.querySelector('.fila-linea.cabecera-lineas') as HTMLElement;
    expect(cabecera).toBeTruthy();
    const filas = Array.from(document.querySelectorAll('.fila-linea:not(.cabecera-lineas):not(.totales-lineas)'));
    expect(filas.length).toBe(2);
    for (const fila of filas) {
      const textos = Array.from((fila as HTMLElement).querySelectorAll('label span'));
      expect(textos.length).toBe(3);
      for (const texto of textos) {
        expect(texto.className).toBe('solo-lector');
        expect(['Cuenta', 'Debe', 'Haber']).toContain(texto.textContent);
      }
    }

    // Las etiquetas ocultas siguen siendo accesibles para lectores e icono de campo.
    expect(screen.getAllByLabelText('Cuenta').length).toBeGreaterThanOrEqual(2); // 2 de la cuadrícula + el mayor de cuenta
    expect(screen.getAllByLabelText('Debe').length).toBe(2);
    expect(screen.getAllByLabelText('Haber').length).toBe(2);

    // Cifras a mano: debe 50.00 en la fila 1 y haber 30.00 en la fila 2.
    fireEvent.change(screen.getAllByLabelText('Debe')[0]!, { target: { value: '50.00' } });
    fireEvent.change(screen.getAllByLabelText('Haber')[1]!, { target: { value: '30.00' } });

    // Totales alineados bajo Debe y Haber (columnas 2 y 3), sin la diferencia dentro.
    const totales = document.querySelector('.fila-linea.totales-lineas') as HTMLElement;
    expect(Array.from(totales.querySelectorAll('span')).map((s: Element) => s.textContent)).toEqual(['Totales', '$50.00', '$30.00', '']);
    expect(Array.from(totales.querySelectorAll('span.numero')).map((s: Element) => s.textContent)).toEqual(['$50.00', '$30.00']);

    // La diferencia va aparte, en su propia línea: 50.00 − 30.00 = 20.00.
    const diferencia = document.querySelector('.totales-diferencia') as HTMLElement;
    expect(diferencia).toBeTruthy();
    expect(totales.contains(diferencia)).toBe(false);
    expect(diferencia.textContent).toBe('Diferencia: $20.00');

    // Las reglas de ocultado existen de verdad: borrarlas del CSS hace fallar la prueba.
    expect(estilos).toMatch(/\.solo-lector\s*\{[^}]*clip:\s*rect\(0 0 0 0\)/);
  });
});
