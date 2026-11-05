import { ipcMain, dialog, BrowserWindow } from 'electron';
import fs from 'fs';
import path from 'path';
import { despachar, type ContextoApp } from './comandos';
import { guardarExportacionArchivo } from './servicios/fiscal';
import { generarHtmlCotizacion } from './servicios/cotizaciones';
import { registrarAdjunto, validarVinculoDocumento } from './servicios/adjuntos';
import { exportarCsvAuxiliar } from './servicios/fiscal';

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

  ipcMain.handle('arkon:registrarAdjunto', async (evento, solicitud) => {
    if (evento.sender.id !== ventanaWebContentsId) {
      throw new Error('Remitente no autorizado');
    }
    const p = objetoSolicitud(solicitud);
    const entidad = typeof p.entidad === 'string' ? p.entidad : '';
    const entidadId = typeof p.entidadId === 'string' ? p.entidadId : '';
    const responsable = typeof p.responsable === 'string' ? p.responsable : '';
    if (!entidad || !entidadId || !responsable) {
      throw new Error('El adjunto requiere entidad, identificador y responsable');
    }
    validarVinculoDocumento(ctx.db, entidad, entidadId);
    const ventanaPrincipal = BrowserWindow.fromWebContents(evento.sender);
    const opcionesDialogo = {
      title: 'Seleccionar documento de respaldo',
      properties: ['openFile'] as ('openFile')[]
    };
    const seleccion = ventanaPrincipal
      ? await dialog.showOpenDialog(ventanaPrincipal, opcionesDialogo)
      : await dialog.showOpenDialog(opcionesDialogo);
    if (seleccion.canceled || seleccion.filePaths.length === 0 || !seleccion.filePaths[0]) {
      return { registrado: false };
    }
    const rutaOrigen = seleccion.filePaths[0] as string;
    const adjunto = registrarAdjunto(ctx.db, ctx.rutas.adjuntos, {
      entidad,
      entidadId,
      nombreOriginal: path.basename(rutaOrigen),
      rutaOrigen,
      responsable
    });
    return { registrado: true, adjunto };
  });

  ipcMain.handle('arkon:guardarCsvAuxiliar', async (evento, solicitud) => {
    if (evento.sender.id !== ventanaWebContentsId) {
      throw new Error('Remitente no autorizado');
    }
    const p = objetoSolicitud(solicitud);
    const tipo = p.tipo;
    if (!['cliente', 'proveedor', 'efectivo'].includes(String(tipo))) {
      throw new Error('Tipo de auxiliar inválido');
    }
    const exportacion = exportarCsvAuxiliar(ctx.db, tipo as 'cliente' | 'proveedor' | 'efectivo');
    const ventanaPrincipal = BrowserWindow.fromWebContents(evento.sender);
    const opciones = {
      title: 'Guardar auxiliar',
      defaultPath: `auxiliar-${tipo}.csv`,
      filters: [{ name: 'CSV', extensions: ['csv'] }]
    };
    const destino = ventanaPrincipal
      ? await dialog.showSaveDialog(ventanaPrincipal, opciones)
      : await dialog.showSaveDialog(opciones);
    if (destino.canceled || !destino.filePath) {
      return { guardado: false };
    }
    const rutaFinal = destino.filePath.toLowerCase().endsWith('.csv') ? destino.filePath : `${destino.filePath}.csv`;
    fs.writeFileSync(rutaFinal, `${exportacion.csv}\n`, 'utf8');
    return { guardado: true, ruta: rutaFinal, version: exportacion.version };
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
