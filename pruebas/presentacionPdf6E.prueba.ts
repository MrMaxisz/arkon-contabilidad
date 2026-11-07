import { describe, expect, it } from 'vitest';
import { construirHtmlReporte } from '../src/main/servicios/reportesPdf';

describe('6E: presentación de PDF', () => {
  it('alinea cabeceras numéricas y conserva anchos estables', () => {
    const html = construirHtmlReporte({
      titulo: 'Reporte sintético',
      tablas: [{
        encabezados: ['Código', 'Nombre', 'Importe', 'Variación'],
        filas: [['4101', 'Ingreso', '$1,000.00', '-$300.00']]
      }]
    }, '<svg></svg>', '');

    expect(html).toContain('<th>Nombre</th>');
    expect(html).toContain('<th class="numero">Importe</th>');
    expect(html).toContain('<th class="numero">Variación</th>');
    expect(html).toContain('<table><colgroup>');
    expect(html).toContain('table-layout: fixed');
    expect(html).toContain('>$1,000.00</td>');
    expect(html).toContain('>-$300.00</td>');
  });

  it('renderiza solo la línea del resultado cuando no hay sección adicional', () => {
    const html = construirHtmlReporte({
      titulo: 'Estado de resultados',
      tablas: [
        { titulo: 'Ingresos', encabezados: ['Código', 'Nombre', 'Importe'], filas: [['4101', 'Ventas', '$1,000.00']] },
        { encabezados: [], filas: [], linea: ['Resultado antes de impuestos', '$700.00'] }
      ]
    }, '<svg></svg>', '');

    expect(html).not.toContain('Otros ingresos y gastos financieros');
    expect(html).not.toMatch(/<table><colgroup><\/colgroup>/);
    expect(html).toContain('class="resultado-linea"');
    expect(html).toContain('<strong>Resultado antes de impuestos</strong><span>$700.00</span>');
  });
});
