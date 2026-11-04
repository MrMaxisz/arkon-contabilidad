import { contextBridge, ipcRenderer } from 'electron';

const COMANDOS_PERMITIDOS = new Set([
  'asiento:contabilizar',
  'asiento:anular',
  'asiento:listar',
  'cuenta:listar',
  'cuenta:crear',
  'mayor:consultar',
  'periodo:cerrar',
  'periodo:reabrir',
  'balance:resumen',
  'balance:saldos',
  'respaldo:crear',
  'respaldo:listar',
  'respaldo:restaurar',
  'bitacora:listar'
]);

contextBridge.exposeInMainWorld('arkon', {
  invocar(comando: string, datos?: unknown): Promise<unknown> {
    if (!COMANDOS_PERMITIDOS.has(comando)) {
      return Promise.reject(new Error(`Comando no permitido: ${comando}`));
    }
    return ipcRenderer.invoke('arkon', { comando, datos });
  }
});
