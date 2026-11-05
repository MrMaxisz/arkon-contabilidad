import { contextBridge, ipcRenderer } from 'electron';

import { COMANDOS_PERMITIDOS } from './comandosPermitidos';



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
  },
  registrarAdjunto(entidad: string, entidadId: string, responsable: string): Promise<unknown> {
    if (!entidad || !entidadId || !responsable) {
      return Promise.reject(new Error('El adjunto requiere entidad, identificador y responsable'));
    }
    return ipcRenderer.invoke('arkon:registrarAdjunto', { entidad, entidadId, responsable });
  },
  guardarCsvAuxiliar(solicitud: {
    tipo: 'cliente' | 'proveedor' | 'efectivo';
    alcance?: 'resumen' | 'detalle';
    contraparteId?: number;
    hastaFecha?: string;
  }): Promise<unknown> {
    const s = typeof solicitud === 'object' && solicitud !== null ? solicitud : {} as Record<string, unknown>;
    const tipo = String((s as Record<string, unknown>).tipo);
    if (!['cliente', 'proveedor', 'efectivo'].includes(tipo)) {
      return Promise.reject(new Error('Tipo de auxiliar inválido'));
    }
    const alcance = (s as Record<string, unknown>).alcance;
    if (alcance !== undefined && !['resumen', 'detalle'].includes(String(alcance))) {
      return Promise.reject(new Error('Alcance inválido'));
    }
    if (alcance === 'detalle') {
      const contraparteId = Number((s as Record<string, unknown>).contraparteId);
      if (!Number.isInteger(contraparteId) || contraparteId <= 0) {
        return Promise.reject(new Error('El detalle requiere contraparte válida'));
      }
    }
    return ipcRenderer.invoke('arkon:guardarCsvAuxiliar', s);
  }
});
