export interface ArkonApi {
  invocar(comando: string, datos?: unknown): Promise<unknown>;
  guardarCsv(tipo: 'venta' | 'compra', mes: string): Promise<unknown>;
  pdfCotizacion(cotizacionId: number): Promise<unknown>;
  registrarAdjunto(entidad: string, entidadId: string, responsable: string): Promise<unknown>;
  guardarCsvAuxiliar(solicitud: {
    tipo: 'cliente' | 'proveedor' | 'efectivo';
    alcance?: 'resumen' | 'detalle';
    contraparteId?: number;
    hastaFecha?: string;
  }): Promise<unknown>;
}

export function api(): ArkonApi {
  return (window as unknown as { arkon: ArkonApi }).arkon;
}
