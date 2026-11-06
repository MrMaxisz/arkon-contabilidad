import { ipcMain, dialog, BrowserWindow, shell } from 'electron';
import fs from 'fs';
import path from 'path';
import { despachar, type ContextoApp } from './comandos';
import { guardarExportacionArchivo } from './servicios/fiscal';
import { generarHtmlCotizacion } from './servicios/cotizaciones';
import { registrarAdjunto, validarVinculoDocumento, verificarAdjunto } from './servicios/adjuntos';
import { generarPaqueteContador } from './servicios/paqueteContador';
import { consultarEjercicio, csvEjercicio } from './servicios/ejercicioAnual';
import { exportarAnexoRetencionesF14Presentacion } from './servicios/anexoF14';
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

  ipcMain.handle('arkon:guardarAnexoF14', async (evento, solicitud) => {
    if (evento.sender.id !== ventanaWebContentsId) {
      throw new Error('Remitente no autorizado');
    }
    const p = objetoSolicitud(solicitud);
    const mes = typeof p.mes === 'string' ? p.mes : '';
    if (!mes) {
      throw new Error('El anexo F-14 requiere mes (AAAA-MM)');
    }
    const anexo = exportarAnexoRetencionesF14Presentacion(ctx.db, mes);
    const ventanaPrincipal = BrowserWindow.fromWebContents(evento.sender);
    const opciones = {
      title: 'Guardar Anexo de Retenciones F-14 v16',
      defaultPath: `anexo-retenciones-${mes}.csv`,
      filters: [{ name: 'CSV', extensions: ['csv'] }]
    };
    const destino = ventanaPrincipal
      ? await dialog.showSaveDialog(ventanaPrincipal, opciones)
      : await dialog.showSaveDialog(opciones);
    if (destino.canceled || !destino.filePath) {
      return { guardado: false };
    }
    fs.writeFileSync(destino.filePath, `${anexo.csv}\n`, 'utf8');
    registroEvento(ctx.db, 'sistema', 'anexo_f14_retenciones', 'archivo_csv', destino.filePath, {
      mes,
      filas: anexo.filas,
      version: anexo.version,
      fuente: anexo.fuente
    });
    return { guardado: true, ruta: destino.filePath, version: anexo.version, filas: anexo.filas, fuente: anexo.fuente };
  });

  ipcMain.handle('arkon:guardarEjercicioAnual', async (evento, solicitud) => {
    if (evento.sender.id !== ventanaWebContentsId) {
      throw new Error('Remitente no autorizado');
    }
    const p = objetoSolicitud(solicitud);
    const anio = Number(p.anio);
    if (!Number.isInteger(anio) || anio < 1900 || anio > 2999) {
      throw new Error('El ejercicio requiere un año válido');
    }
    const informe = consultarEjercicio(ctx.db, anio);
    const archivos = csvEjercicio(informe);
    const ventanaPrincipal = BrowserWindow.fromWebContents(evento.sender);
    const opciones = {
      title: 'Guardar soporte interno del ejercicio',
      properties: ['openDirectory', 'createDirectory'] as Array<'openDirectory' | 'createDirectory'>,
      buttonLabel: 'Guardar ejercicio aquí'
    };
    const destino = ventanaPrincipal
      ? await dialog.showOpenDialog(ventanaPrincipal, opciones)
      : await dialog.showOpenDialog(opciones);
    const carpetaBase = destino.canceled ? undefined : destino.filePaths?.[0];
    if (!carpetaBase) {
      return { guardado: false };
    }
    const carpeta = path.join(carpetaBase, `ejercicio-interno-${anio}`);
    fs.mkdirSync(carpeta, { recursive: true });
    for (const archivo of archivos) {
      fs.writeFileSync(path.join(carpeta, archivo.nombre), `${archivo.contenido}\n`, 'utf8');
    }
    registroEvento(ctx.db, 'sistema', 'ejercicio_anual_interno', 'archivo_csv', carpeta, {
      anio,
      archivos: archivos.length,
      version: informe.version
    });
    return {
      guardado: true,
      ruta: carpeta,
      version: informe.version,
      archivos: archivos.map(a => a.nombre),
      informe: {
        resultadoOrdinarioMinor: informe.resultadoOrdinarioMinor,
        resultadoConCierreMinor: informe.resultadoConCierreMinor,
        concilia: informe.conciliacionMayor.concilia
      }
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

  // PDF de reportes del bloque 2 (auditoría 71): encabezado con logo, título, período,
  // moneda USD, ámbito administrativo, leyenda de control interno, firmas y numeración de página.
  ipcMain.handle('arkon:reportePdf', async (evento, solicitud) => {
    if (evento.sender.id !== ventanaWebContentsId) {
      throw new Error('Remitente no autorizado');
    }
    const p = objetoSolicitud(solicitud);
    const titulo = String(p.titulo ?? 'Reporte');
    const periodo = String(p.periodo ?? '');
    const cuerpo = String(p.cuerpo ?? '');
    const logoSvg = fs.readFileSync(path.join(__dirname, '../renderer/assets/arkon-logo-azul.svg'), 'utf8');
    const html = `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"><title>${titulo}</title>
<style>
  body { font-family: 'IBM Plex Sans', Arial, sans-serif; color: #0B1B33; margin: 16mm 14mm 20mm; font-size: 11px; }
  h1 { font-size: 18px; text-transform: uppercase; margin: 0; }
  .logo svg { width: 110px; height: auto; }
  .encabezado { border-bottom: 2px solid #0A4DB3; padding-bottom: 8px; margin-bottom: 12px; }
  .meta { font-size: 10px; color: #4A5B75; margin: 4px 0 0; }
  table { width: 100%; border-collapse: collapse; font-size: 10px; }
  th, td { border-bottom: 1px solid #C9D8F2; padding: 4px 6px; text-align: left; }
  th { background: #E4EDFB; color: #0B1B33; }
  td.numero { text-align: right; font-variant-numeric: tabular-nums; }
  tr.total td { font-weight: bold; border-top: 2px solid #0B1B33; }
  .firmas { margin-top: 28px; width: 100%; font-size: 10px; }
  .firmas td { border: none; border-top: 1px solid #0B1B33; text-align: center; padding-top: 4px; width: 33%; }
</style></head><body>
<div class="encabezado">
  <div class="logo">${logoSvg}</div>
  <h1>${titulo}</h1>
  <p class="meta">${periodo ? `Período: ${periodo}. ` : ''}Moneda: USD. Ámbito administrativo.</p>
  <p class="meta">Registro de control interno, no estado financiero legal. ARKON sin constituir ni inscrita en IVA.</p>
</div>
${cuerpo}
<table class="firmas"><tr><td>Elaboró</td><td>Revisó</td><td>Autorizó</td></tr></table>
</body></html>`;
    const ventanaPrincipal = BrowserWindow.fromWebContents(evento.sender);
    const ventanaPdf = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
    try {
      await ventanaPdf.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
      const pdf = await ventanaPdf.webContents.printToPDF({
        printBackground: true,
        displayHeaderFooter: true,
        headerTemplate: '<div></div>',
        footerTemplate: '<div style="font-size:9px; width:100%; text-align:center;"><span class="pageNumber"></span> de <span class="totalPages"></span></div>'
      });
      const nombreArchivo = titulo.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-');
      const opcionesPdf = {
        title: 'Guardar reporte',
        defaultPath: `${nombreArchivo || 'reporte'}.pdf`,
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
