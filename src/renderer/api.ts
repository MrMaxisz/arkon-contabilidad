export interface ArkonApi {
  invocar(comando: string, datos?: unknown): Promise<unknown>;
  guardarCsv(tipo: 'venta' | 'compra', mes: string): Promise<unknown>;
  pdfCotizacion(cotizacionId: number): Promise<unknown>;
}

export function api(): ArkonApi {
  return (window as unknown as { arkon: ArkonApi }).arkon;
}
