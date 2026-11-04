import { ipcMain, dialog, BrowserWindow } from 'electron';
import fs from 'fs';
import { despachar, type ContextoApp } from './comandos';
import { guardarExportacionArchivo } from './servicios/fiscal';
import { generarHtmlCotizacion } from './servicios/cotizaciones';

function objetoSolicitud(payload: unknown): Record<string, unknown> {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new Error('Solicitud inválida');
  }
  return payload as Record<string, unknown>;
}

export function registrarIpc(ctx: ContextoApp, ventanaWebContentsId: number): void {
  ipcMain.handle('arkon', (evento, solicitud) => {
    if (evento.sender.id !== ventanaWebContentsId) {
      throw new Error('Remitente no autorizado');
    }
    const p = objetoSolicitud(solicitud);
    const nombre = typeof p.comando === 'string' ? p.comando : '';
    return despachar(ctx, nombre, p.datos);
  });

  ipcMain.handle('arkon:guardarCsv', async (evento, solicitud) => {
    if (evento.sender.id !== ventanaWebContentsId) {
      throw new Error('Remitente no autorizado');
    }
    const p = objetoSolicitud(solicitud);
    const tipo = p.tipo === 'compra' ? 'compra' : 'venta';
    const mes = typeof p.mes === 'string' ? p.mes : '';
    const ventana = BrowserWindow.fromWebContents(evento.sender);
    const opciones = {
      title: 'Guardar exportación interna de trabajo',
      defaultPath: `arkon-${tipo}-${mes}.csv`,
      filters: [{ name: 'CSV', extensions: ['csv'] }]
    };
    const destino = ventana
      ? await dialog.showSaveDialog(ventana, opciones)
      : await dialog.showSaveDialog(opciones);
    if (destino.canceled || !destino.filePath) {
      return { guardado: false };
    }
    return guardarExportacionArchivo(ctx.db, tipo, mes, destino.filePath);
  });

  ipcMain.handle('arkon:pdfCotizacion', async (evento, solicitud) => {
    if (evento.sender.id !== ventanaWebContentsId) {
      throw new Error('Remitente no autorizado');
    }
    const p = objetoSolicitud(solicitud);
    const cotizacionId = Number(p.cotizacionId);
    if (!Number.isInteger(cotizacionId) || cotizacionId <= 0) {
      throw new Error('Cotización inválida');
    }
    const html = generarHtmlCotizacion(ctx.db, cotizacionId);
    const numero = (ctx.db.prepare('SELECT numero FROM cotizacion WHERE id = ?').get(cotizacionId) as { numero: string }).numero;
    const ventanaPrincipal = BrowserWindow.fromWebContents(evento.sender);
    const ventanaPdf = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
    try {
      await ventanaPdf.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
      const pdf = await ventanaPdf.webContents.printToPDF({ printBackground: true });
      const opcionesPdf = {
        title: 'Guardar documento de cotización',
        defaultPath: `cotizacion-${numero}.pdf`,
        filters: [{ name: 'PDF', extensions: ['pdf'] }]
      };
      const destino = ventanaPrincipal
        ? await dialog.showSaveDialog(ventanaPrincipal, opcionesPdf)
        : await dialog.showSaveDialog(opcionesPdf);
      if (destino.canceled || !destino.filePath) {
        return { guardado: false };
      }
      const rutaFinal = destino.filePath.toLowerCase().endsWith('.pdf') ? destino.filePath : `${destino.filePath}.pdf`;
      fs.writeFileSync(rutaFinal, pdf);
      return { guardado: true, ruta: rutaFinal };
    } finally {
      ventanaPdf.destroy();
    }
  });
}
