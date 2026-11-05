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
  abrirAdjunto(id: number): Promise<unknown>;
  guardarPaqueteContador(desde: string, hasta: string): Promise<unknown>;
  guardarAnexoF07(anexo: 1 | 2 | 3, mes: string): Promise<unknown>;
  guardarAnexoF14(mes: string): Promise<unknown>;
  guardarEjercicioAnual(anio: number): Promise<unknown>;
}

export function api(): ArkonApi {
  return (window as unknown as { arkon: ArkonApi }).arkon;
}
