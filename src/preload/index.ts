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
  'contraparte:editar',
  'contraparte:cambiarEstado',
  'cuenta:desactivar',
  'item:crear',
  'item:editar',
  'item:desactivar',
  'item:activar',
  'item:listar',
  'cotizacion:html',
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
  'documento:clasificar',
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
  'anticipo:anular',
  'fiscal:exportarCsv',
  'fiscal:politicas',
  'reporte:estadoResultados',
  'reporte:rentabilidadProyectos'
]);

contextBridge.exposeInMainWorld('arkon', {
  invocar(comando: string, datos?: unknown): Promise<unknown> {
    if (!COMANDOS_PERMITIDOS.has(comando)) {
      return Promise.reject(new Error(`Comando no permitido: ${comando}`));
    }
    return ipcRenderer.invoke('arkon', { comando, datos });
  },
  guardarCsv(tipo: 'venta' | 'compra', mes: string): Promise<unknown> {
    if (tipo !== 'venta' && tipo !== 'compra') {
      return Promise.reject(new Error('Tipo de libro inválido'));
    }
    return ipcRenderer.invoke('arkon:guardarCsv', { tipo, mes });
  },
  pdfCotizacion(cotizacionId: number): Promise<unknown> {
    if (!Number.isInteger(cotizacionId) || cotizacionId <= 0) {
      return Promise.reject(new Error('Cotización inválida'));
    }
    return ipcRenderer.invoke('arkon:pdfCotizacion', { cotizacionId });
  }
});
