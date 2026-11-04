import { ipcMain } from 'electron';
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
}
