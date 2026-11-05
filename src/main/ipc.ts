import { ipcMain, dialog, BrowserWindow, shell } from 'electron';
import fs from 'fs';
import path from 'path';
import { despachar, type ContextoApp } from './comandos';
import { guardarExportacionArchivo } from './servicios/fiscal';
import { generarHtmlCotizacion } from './servicios/cotizaciones';
import { registrarAdjunto, validarVinculoDocumento, verificarAdjunto } from './servicios/adjuntos';
import { generarPaqueteContador } from './servicios/paqueteContador';
import {
  exportarAnexo1VentasPresentacion,
  exportarAnexo2VentasConsumidorPresentacion,
  exportarAnexo3ComprasPresentacion
} from './servicios/anexosFiscales';
import { registroEvento } from './servicios/bitacora';
import { exportarCsvAuxiliar, exportarCsvAuxiliarDetalle } from './servicios/fiscal';

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
    const tipo = String(p.tipo);
    if (!['cliente', 'proveedor', 'efectivo'].includes(tipo)) {
      throw new Error('Tipo de auxiliar inválido');
    }
    const alcance = p.alcance === undefined ? 'resumen' : String(p.alcance);
    let exportacion: { csv: string; version: string };
    let nombreArchivo: string;
    if (alcance === 'detalle') {
      if (tipo === 'efectivo') {
        throw new Error('El detalle requiere cliente o proveedor');
      }
      const contraparteId = Number(p.contraparteId);
      if (!Number.isInteger(contraparteId) || contraparteId <= 0) {
        throw new Error('El detalle requiere contraparte válida');
      }
      const hastaFecha = typeof p.hastaFecha === 'string' && p.hastaFecha ? p.hastaFecha : undefined;
      exportacion = exportarCsvAuxiliarDetalle(ctx.db, tipo as 'cliente' | 'proveedor', contraparteId, hastaFecha);
      nombreArchivo = `auxiliar-${tipo}-detalle${hastaFecha ? `-corte-${hastaFecha}` : ''}.csv`;
    } else if (alcance === 'resumen') {
      exportacion = exportarCsvAuxiliar(ctx.db, tipo as 'cliente' | 'proveedor' | 'efectivo');
      nombreArchivo = `auxiliar-${tipo}.csv`;
    } else {
      throw new Error('Alcance inválido');
    }
    const ventanaPrincipal = BrowserWindow.fromWebContents(evento.sender);
    const opciones = {
      title: 'Guardar auxiliar',
      defaultPath: nombreArchivo,
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

  ipcMain.handle('arkon:guardarAnexoF07', async (evento, solicitud) => {
    if (evento.sender.id !== ventanaWebContentsId) {
      throw new Error('Remitente no autorizado');
    }
    const p = objetoSolicitud(solicitud);
    const mes = typeof p.mes === 'string' ? p.mes : '';
    const anexo = Number(p.anexo);
    if (!mes || ![1, 2, 3].includes(anexo)) {
      throw new Error('El anexo requiere número (1-3) y mes (AAAA-MM)');
    }
    const exportacion =
      anexo === 1
        ? exportarAnexo1VentasPresentacion(ctx.db, mes)
        : anexo === 2
          ? exportarAnexo2VentasConsumidorPresentacion(ctx.db, mes)
          : exportarAnexo3ComprasPresentacion(ctx.db, mes);
    const ventanaPrincipal = BrowserWindow.fromWebContents(evento.sender);
    const opciones = {
      title: `Guardar Anexo ${anexo} F-07 v14`,
      defaultPath: `anexo${anexo}-${anexo === 3 ? 'compras' : 'ventas'}-${mes}.csv`,
      filters: [{ name: 'CSV', extensions: ['csv'] }]
    };
    const destino = ventanaPrincipal
      ? await dialog.showSaveDialog(ventanaPrincipal, opciones)
      : await dialog.showSaveDialog(opciones);
    if (destino.canceled || !destino.filePath) {
      return { guardado: false };
    }
    fs.writeFileSync(destino.filePath, `${exportacion.csv}\n`, 'utf8');
    registroEvento(ctx.db, 'sistema', `anexo_f07_anexo${anexo}`, 'archivo_csv', destino.filePath, {
      mes,
      filas: exportacion.filas,
      version: exportacion.version,
      fuente: exportacion.fuente
    });
    return {
      guardado: true,
      ruta: destino.filePath,
      version: exportacion.version,
      filas: exportacion.filas,
      fuente: exportacion.fuente
    };
  });

  ipcMain.handle('arkon:guardarPaqueteContador', async (evento, solicitud) => {
    if (evento.sender.id !== ventanaWebContentsId) {
      throw new Error('Remitente no autorizado');
    }
    const p = objetoSolicitud(solicitud);
    const desde = typeof p.desde === 'string' ? p.desde : '';
    const hasta = typeof p.hasta === 'string' ? p.hasta : '';
    if (!desde || !hasta) {
      throw new Error('El paquete requiere rango de fechas');
    }
    const paquete = generarPaqueteContador(ctx.db, desde, hasta);
    const ventanaPrincipal = BrowserWindow.fromWebContents(evento.sender);
    const opciones = {
      title: 'Guardar paquete para el contador',
      properties: ['openDirectory', 'createDirectory'] as Array<'openDirectory' | 'createDirectory'>,
      buttonLabel: 'Guardar paquete aquí'
    };
    const destino = ventanaPrincipal
      ? await dialog.showOpenDialog(ventanaPrincipal, opciones)
      : await dialog.showOpenDialog(opciones);
    const carpetaBase = destino.canceled ? undefined : destino.filePaths?.[0];
    if (!carpetaBase) {
      return { guardado: false };
    }
    const carpeta = path.join(carpetaBase, `paquete-contador-${desde}_${hasta}`);
    fs.mkdirSync(carpeta, { recursive: true });
    for (const archivo of paquete.archivos) {
      fs.writeFileSync(path.join(carpeta, archivo.nombre), `${archivo.contenido}\n`, 'utf8');
    }
    registroEvento(ctx.db, 'sistema', 'paquete_contador', 'archivo_csv', carpeta, {
      desde,
      hasta,
      archivos: paquete.archivos.length
    });
    return { guardado: true, ruta: carpeta, archivos: paquete.archivos.map(a => a.nombre), version: paquete.version };
  });

  ipcMain.handle('arkon:abrirAdjunto', async (evento, solicitud) => {
    if (evento.sender.id !== ventanaWebContentsId) {
      throw new Error('Remitente no autorizado');
    }
    const p = objetoSolicitud(solicitud);
    const id = Number(p.id);
    if (!Number.isInteger(id) || id <= 0) {
      throw new Error('Adjunto inválido');
    }
    const verificacion = verificarAdjunto(ctx.db, ctx.rutas.adjuntos, id);
    if (!verificacion.existe) {
      throw new Error(`El archivo del adjunto no está en disco: ${verificacion.nombreOriginal}`);
    }
    if (!verificacion.hashCoincide) {
      throw new Error(`El hash del adjunto ${verificacion.nombreOriginal} no coincide; restaure desde un respaldo verificado`);
    }
    const resultadoApertura = await shell.openPath(verificacion.ruta);
    if (typeof resultadoApertura === 'string' && resultadoApertura.length > 0) {
      throw new Error(`No se pudo abrir el adjunto ${verificacion.nombreOriginal}: ${resultadoApertura}`);
    }
    return { abierto: true, nombreOriginal: verificacion.nombreOriginal };
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
