// Constructor PURO del HTML de reportes en PDF (auditoría 72): recibe datos ESTRUCTURADOS,
// nunca HTML del renderer; todo dato se escapa (título, período, celdas). Sin red: las fuentes
// de la marca se incrustan como data URI y el logo se pasa ya leído.

export interface TablaReporte {
  titulo?: string;
  encabezados: string[];
  filas: string[][];
  total?: string[];
  totalNegrita?: boolean;
  linea?: string[];
}

export interface DatosReporte {
  titulo: string;
  periodo?: string;
  ambito?: string;
  tablas: TablaReporte[];
}

export function vestirHtmlCotizacion(html: string, logoSvg: string, fuentesCss: string): string {
  return html.replace('<style>', `<style>\n${fuentesCss}\n.logo svg { width: 110px; height: auto; }`)
    .replace('<body>', `<body>\n<div class="logo">${logoSvg}</div>`);
}

export function escaparHtml(texto: string): string {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function construirHtmlReporte(datos: DatosReporte, logoSvg: string, fuentesCss: string): string {
  const esNumero = (encabezado: string): boolean =>
    /debe|haber|saldo|total|importe|cargo|abono|costo|acumulada|valor|gasto|actual|anterior|variaci[oó]n|margen|ingreso|diferencia/i.test(encabezado);
  const celdaNumero = (encabezados: string[], i: number): string =>
    esNumero(encabezados[i] ?? '') ? ' class="numero"' : '';
  const grupoColumnas = (encabezados: string[]): string => {
    const numericas = encabezados.filter(esNumero).length;
    const anchoNumerico = numericas > 0 ? Math.min(20, 84 / numericas) : 0;
    const noNumericas = encabezados.length - numericas;
    const anchoTexto = noNumericas > 0 ? (100 - numericas * anchoNumerico) / noNumericas : 0;
    return encabezados
      .map(encabezado => `<col style="width:${(esNumero(encabezado) ? anchoNumerico : anchoTexto).toFixed(2)}%">`)
      .join('');
  };
  const tablas = datos.tablas
    .map(tabla => {
      if (tabla.linea) {
        return `<p class="resultado-linea"><strong>${escaparHtml(tabla.linea[0] ?? '')}</strong><span>${escaparHtml(tabla.linea[1] ?? '')}</span></p>`;
      }
      const filas = tabla.filas
        .map(fila => `<tr>${fila.map((celda, i) => `<td${celdaNumero(tabla.encabezados, i)}>${escaparHtml(celda)}</td>`).join('')}</tr>`)
        .join('');
      // Filas de total: las cifras alineadas a la derecha igual que las filas (cierre bloque 2).
      const total = tabla.total
        ? `<tr class="total">${tabla.total.map((celda, i) => `<td${celdaNumero(tabla.encabezados, i)}>${escaparHtml(celda)}</td>`).join('')}</tr>`
        : '';
      return `${tabla.titulo ? `<h2>${escaparHtml(tabla.titulo)}</h2>` : ''}
<table><colgroup>${grupoColumnas(tabla.encabezados)}</colgroup><thead><tr>${tabla.encabezados.map((e, i) => `<th${celdaNumero(tabla.encabezados, i)}>${escaparHtml(e)}</th>`).join('')}</tr></thead><tbody>${filas}</tbody>${total ? `<tfoot>${total}</tfoot>` : ''}</table>`;
    })
    .join('\n');
  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"><title>${escaparHtml(datos.titulo)}</title>
<style>
${fuentesCss}
  body { font-family: 'IBM Plex Sans', Arial, sans-serif; color: #0B1B33; margin: 16mm 14mm 20mm; font-size: 11px; }
  h1 { font-family: 'Barlow Condensed', Arial, sans-serif; font-size: 18px; text-transform: uppercase; margin: 0; }
  h2 { font-family: 'Barlow Condensed', Arial, sans-serif; font-size: 13px; text-transform: uppercase; margin: 12px 0 4px; }
  .logo svg { width: 110px; height: auto; }
  .encabezado { border-bottom: 2px solid #0A4DB3; padding-bottom: 8px; margin-bottom: 12px; }
  .meta { font-size: 10px; color: #4A5B75; margin: 4px 0 0; }
  table { width: 100%; border-collapse: collapse; font-size: 10px; }
  table { table-layout: fixed; }
  th, td { border-bottom: 1px solid #C9D8F2; padding: 4px 6px; text-align: left; overflow-wrap: anywhere; }
  th { background: #E4EDFB; color: #0B1B33; }
  th.numero { text-align: right; }
  td.numero { text-align: right; font-variant-numeric: tabular-nums; font-family: 'IBM Plex Mono', monospace; }
  tr.total td { font-weight: bold; border-top: 2px solid #0B1B33; }
  .resultado-linea { display: flex; justify-content: space-between; gap: 12px; margin: 8px 0; padding: 5px 6px; border-top: 2px solid #0B1B33; border-bottom: 1px solid #C9D8F2; font-family: 'IBM Plex Mono', monospace; }
  .resultado-linea strong { font-family: 'IBM Plex Sans', Arial, sans-serif; }
  .firmas { margin-top: 28px; width: 100%; font-size: 10px; }
  .firmas td { border: none; border-top: 1px solid #0B1B33; text-align: center; padding-top: 4px; width: 33%; }
</style></head><body>
<div class="encabezado">
  <div class="logo">${logoSvg}</div>
  <h1>${escaparHtml(datos.titulo)}</h1>
  <p class="meta">${datos.periodo ? `Período: ${escaparHtml(datos.periodo)}. ` : ''}Moneda: USD. Ámbito ${escaparHtml(datos.ambito ?? 'administrativo')}.</p>
  <p class="meta">Registro de control interno, no estado financiero legal. ARKON sin constituir ni inscrita en IVA.</p>
</div>
${tablas}
<table class="firmas"><tr><td>Elaboró</td><td>Revisó</td><td>Autorizó</td></tr></table>
</body></html>`;
}
