import { ipcMain, dialog, BrowserWindow } from 'electron';
import { despachar, type ContextoApp } from './comandos';
import { guardarExportacionArchivo } from './servicios/fiscal';

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
}
