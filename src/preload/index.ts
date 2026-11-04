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
  'bitacora:listar',
  'contraparte:crear',
  'contraparte:listar',
  'cotizacion:crear',
  'cotizacion:guardar',
  'cotizacion:revision',
  'cotizacion:aprobar',
  'cotizacion:anular',
  'cotizacion:listar',
  'cotizacion:lineas',
  'proyecto:crear',
  'proyecto:listar',
  'compra:registrar',
  'compra:listar',
  'venta:registrar',
  'venta:listar',
  'documento:anular',
  'cobro:registrar',
  'pago:registrar',
  'transferencia:registrar',
  'tesoreria:listar',
  'tesoreria:anular',
  'vigencia:crear',
  'vigencia:cerrar',
  'vigencia:listar',
  'fiscal:libroVentas',
  'fiscal:libroCompras',
  'fiscal:conciliar',
  'retencion:registrar',
  'retencion:listar',
  'anticipo:saldo',
  'anticipo:aplicar',
  'anticipo:anular'
]);

contextBridge.exposeInMainWorld('arkon', {
  invocar(comando: string, datos?: unknown): Promise<unknown> {
    if (!COMANDOS_PERMITIDOS.has(comando)) {
      return Promise.reject(new Error(`Comando no permitido: ${comando}`));
    }
    return ipcRenderer.invoke('arkon', { comando, datos });
  }
});
