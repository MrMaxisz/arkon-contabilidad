// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';

// Auditoría 69, bloque 1: sistema visual ARKON y navegación.
// Sin comparación de hashes del logo (corrección del auditor): existencia, render y colores oficiales.

const invocar = vi.hoisted(() => vi.fn());

vi.mock('../src/renderer/api', () => ({
  api: () => ({
    invocar: (comando: string, datos?: unknown) => invocar(comando, datos)
  })
}));

import App from '../src/renderer/App';

const estilos = fs.readFileSync(path.resolve(__dirname, '../src/renderer/estilos.css'), 'utf8');
const indexTsx = fs.readFileSync(path.resolve(__dirname, '../src/renderer/index.tsx'), 'utf8');
const appTsx = fs.readFileSync(path.resolve(__dirname, '../src/renderer/App.tsx'), 'utf8');
const indexHtml = fs.readFileSync(path.resolve(__dirname, '../src/renderer/index.html'), 'utf8');

function luminancia(hex: string): number {
  const c = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map(i => parseInt(c.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contraste(a: string, b: string): number {
  const [l1, l2] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

beforeEach(() => {
  invocar.mockReset();
  invocar.mockImplementation((comando: string) => {
    if (comando === 'balance:resumen') {
      return Promise.resolve({
        totalActivoMinor: '100.00', totalPasivoMinor: '40.00',
        totalPatrimonioMinor: '60.00', totalResultadoMinor: '60.00', cuadra: true
      });
    }
    return Promise.resolve([]);
  });
});

afterEach(() => {
  cleanup();
});

describe('auditoría 69: tokens de color', () => {
  it('los tokens oficiales están presentes y los colores antiguos desaparecieron', () => {
    for (const token of ['#0A4DB3', '#0B1B33', '#E4EDFB', '#19A7E0', '#B45309']) {
      expect(estilos, `falta el token ${token}`).toContain(token);
    }
    for (const viejo of ['#1a5fa8', '#0d2c54', '#f4f7fb', '#d7e0ec', '#1c2733', '#cfe0f5', '#eaf1f9', '#9db4cf', '#c0392b', '#8c2d20', '#1e8449', '#5a6b7d']) {
      expect(estilos, `el color antiguo ${viejo} sigue presente`).not.toContain(viejo);
    }
  });

  it('rojo y verde funcionales solo para error y éxito como tokens separados', () => {
    expect(estilos).toContain('--funcional-error: #B3261E');
    expect(estilos).toContain('--funcional-exito: #1E6B34');
    expect(estilos.match(/--funcional-error:/g)?.length).toBe(1);
    expect(estilos.match(/--funcional-exito:/g)?.length).toBe(1);
  });

  it('contraste AA (≥ 4.5) de los pares de texto y fondo', () => {
    const pares: Array<[string, string]> = [
      ['#0B1B33', '#FFFFFF'],
      ['#FFFFFF', '#0B1B33'],
      ['#FFFFFF', '#0A4DB3'],
      ['#0B1B33', '#E4EDFB'],
      ['#4A5B75', '#FFFFFF'],
      ['#B3261E', '#FBEAE9'],
      ['#1E6B34', '#EAF5EE'],
      ['#C9D8F2', '#0B1B33'],
      ['#B45309', '#FFFFFF']
    ];
    for (const [texto, fondo] of pares) {
      expect(contraste(texto, fondo), `contraste insuficiente ${texto} sobre ${fondo}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('auditoría 69: tipografía local sin red', () => {
  it('Barlow Condensed 700, Barlow 400/600, IBM Plex Sans 400/600 e IBM Plex Mono 400 importadas', () => {
    expect(indexTsx).toContain("@fontsource/barlow-condensed/700.css");
    expect(indexTsx).toContain("@fontsource/barlow/400.css");
    expect(indexTsx).toContain("@fontsource/barlow/600.css");
    expect(indexTsx).toContain("@fontsource/ibm-plex-sans/400.css");
    expect(indexTsx).toContain("@fontsource/ibm-plex-sans/600.css");
    expect(indexTsx).toContain("@fontsource/ibm-plex-mono/400.css");
  });

  it('sin URL externas de fuentes ni CDN', () => {
    for (const [nombre, contenido] of [['index.tsx', indexTsx], ['index.html', indexHtml], ['estilos.css', estilos]]) {
      expect(contenido, `${nombre} no debe referir fuentes externas`).not.toMatch(/fonts\.googleapis|fonts\.gstatic|https?:\/\/[^ ]*\.(woff2?|ttf)/i);
    }
  });

  it('escala tipográfica y tablas densas documentadas', () => {
    expect(estilos).toContain('h1 { font-size: 32px; }');
    expect(estilos).toContain('h2 { font-size: 22px; }');
    expect(estilos).toContain('font-size: 16px');
    expect(estilos).toContain('font-size: 12px');
    expect(estilos).toMatch(/table \{ width: 100%; border-collapse: collapse; background: var\(--arkon-blanco\); font-size: 14px; \}/);
  });
});

describe('auditoría 69: logo oficial', () => {
  const dirRecursos = path.resolve(__dirname, '../src/renderer/recursos');

  it('azul y blanca existen con los colores oficiales', () => {
    const azul = fs.readFileSync(path.join(dirRecursos, 'arkon-logo-azul.svg'), 'utf8');
    expect(azul).toContain('#0A4DB3');
    expect(azul).toContain('#0B1B33');
    expect(azul).toContain('#4A5B75');
    const blanca = fs.readFileSync(path.join(dirRecursos, 'arkon-logo-blanco.svg'), 'utf8');
    expect(blanca).toContain('#FFFFFF');
    expect(blanca).toContain('#C9D8F2');
    expect(blanca).not.toContain('#0A4DB3');
    expect(blanca).not.toContain('#0B1B33');
    expect(blanca).not.toContain('#4A5B75');
  });

  it('renderiza: el lateral usa la blanca y la impresión la azul', () => {
    expect(appTsx).toContain("./recursos/arkon-logo-blanco.svg");
    const componentes = fs.readFileSync(path.resolve(__dirname, '../src/renderer/componentes.tsx'), 'utf8');
    expect(componentes).toContain("./recursos/arkon-logo-azul.svg");
    expect(appTsx).toContain('Potencia con precisión');
    expect(appTsx.match(/Potencia con precisión/g)?.length).toBe(1);
  });
});

describe('auditoría 69: navegación agrupada y barra de contexto', () => {
  it('grupos y destinos completos con aria-current al navegar', async () => {
    render(<App />);
    for (const grupo of ['Comercial', 'Compras y tesorería', 'Contabilidad', 'Fiscal', 'Sistema']) {
      expect(screen.getByText(grupo, { selector: '.grupo' })).toBeTruthy();
    }
    const ventas = screen.getByRole('button', { name: 'Ventas' });
    expect(ventas.getAttribute('aria-current')).toBeNull();
    fireEvent.click(ventas);
    await waitFor(() => expect(screen.getByText('Ventas reconocidas')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Ventas' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('button', { name: 'Inicio' }).getAttribute('aria-current')).toBeNull();
  });

  it('la barra de contexto muestra la sección y el aviso administrativo', async () => {
    render(<App />);
    const barra = screen.getByText('Ámbito administrativo · ARKON sin constituir · registros de control administrativo, no estados financieros legales');
    expect(barra).toBeTruthy();
    expect(screen.getByText('Inicio', { selector: '.seccion-actual' })).toBeTruthy();
  });

  it('Inicio muestra el resumen sobrio sin tabla de balance', async () => {
    render(<App />);
    await waitFor(() => screen.getByText('Total activos'));
    expect(screen.getByText('$100.00')).toBeTruthy();
    expect(screen.getByText(/Partida doble/).textContent).toContain('cuadra');
  });
});

describe('auditoría 69: impresión y foco', () => {
  it('@media print oculta navegación y controles, con logo azul y filas sin cortar', () => {
    expect(estilos).toContain('@media print');
    expect(estilos).toMatch(/\.lateral, \.barra-contexto form, form, button, \.no-imprimir \{ display: none !important; \}/);
    expect(estilos).toContain('page-break-inside: avoid');
    expect(estilos).toContain('.logo-impresion { display: block;');
  });

  it(':focus-visible claro definido', () => {
    expect(estilos).toContain(':focus-visible');
    expect(estilos).toContain('outline: 3px solid var(--arkon-chispa)');
  });
});
