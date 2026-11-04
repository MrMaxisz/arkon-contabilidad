import { ipcMain, dialog, BrowserWindow } from 'electron';
import fs from 'fs';
import { despachar, type ContextoApp } from './comandos';

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
    const exportacion = despachar(ctx, 'fiscal:exportarCsv', { tipo, mes }) as {
      csv: string;
      version: string;
      advertencia: string;
    };
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
      return { guardado: false, version: exportacion.version, advertencia: exportacion.advertencia };
    }
    fs.writeFileSync(destino.filePath, `${exportacion.csv}\n`, 'utf8');
    registroEventoCsv(ctx, tipo, mes, destino.filePath);
    return {
      guardado: true,
      ruta: destino.filePath,
      version: exportacion.version,
      advertencia: exportacion.advertencia
    };
  });
}

function registroEventoCsv(ctx: ContextoApp, tipo: string, mes: string, ruta: string): void {
  try {
    const detalle = { tipo, mes, nota: 'Exportación interna de trabajo guardada como archivo' };
    ctx.db
      .prepare('INSERT INTO bitacora_evento (actor, tipo, entidad, entidad_id, detalle) VALUES (?, ?, ?, ?, ?)')
      .run('sistema', 'exportacion_guardada', 'archivo_csv', ruta, JSON.stringify(detalle));
  } catch {
    return;
  }
}
