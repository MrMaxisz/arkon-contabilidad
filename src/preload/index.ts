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
  reportePdf(solicitud: { titulo: string; periodo?: string; tablas: Array<{ titulo?: string; encabezados: string[]; filas: string[][]; total?: string[] }> }): Promise<unknown> {
    if (!solicitud?.titulo || !Array.isArray(solicitud.tablas) || solicitud.tablas.length === 0) {
      return Promise.reject(new Error('El reporte requiere título y tablas'));
    }
    return ipcRenderer.invoke('arkon:reportePdf', solicitud);
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
  },
  abrirAdjunto(id: number): Promise<unknown> {
    if (!Number.isInteger(id) || id <= 0) {
      return Promise.reject(new Error('Adjunto inválido'));
    }
    return ipcRenderer.invoke('arkon:abrirAdjunto', { id });
  },
  guardarPaqueteContador(desde: string, hasta: string): Promise<unknown> {
    if (typeof desde !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(desde)) {
      return Promise.reject(new Error('Fecha inicial inválida'));
    }
    if (typeof hasta !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(hasta)) {
      return Promise.reject(new Error('Fecha final inválida'));
    }
    return ipcRenderer.invoke('arkon:guardarPaqueteContador', { desde, hasta });
  },
  guardarEjercicioAnual(anio: number): Promise<unknown> {
    if (!Number.isInteger(anio) || anio < 1900 || anio > 2999) {
      return Promise.reject(new Error('Año inválido'));
    }
    return ipcRenderer.invoke('arkon:guardarEjercicioAnual', { anio });
  },
  guardarAnexoF14(mes: string): Promise<unknown> {
    if (typeof mes !== 'string' || !/^\d{4}-\d{2}$/.test(mes)) {
      return Promise.reject(new Error('Mes inválido (AAAA-MM)'));
    }
    return ipcRenderer.invoke('arkon:guardarAnexoF14', { mes });
  },
  guardarAnexoF07(anexo: 1 | 2 | 3, mes: string): Promise<unknown> {
    if (typeof mes !== 'string' || !/^\d{4}-\d{2}$/.test(mes)) {
      return Promise.reject(new Error('Mes inválido (AAAA-MM)'));
    }
    if (![1, 2, 3].includes(anexo)) {
      return Promise.reject(new Error('Anexo inválido (1-3)'));
    }
    return ipcRenderer.invoke('arkon:guardarAnexoF07', { anexo, mes });
  }
});
