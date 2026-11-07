import type { ArkonApi } from '../renderer/api';

export function crearPuenteAndroid(worker: Worker): ArkonApi {
  let secuencia = 0;
  let fallo: Error | undefined;
  const pendientes = new Map<number, { resolve: (valor: unknown) => void; reject: (error: Error) => void }>();
  worker.onmessage = ({ data }) => {
    const solicitud = pendientes.get(data.id);
    if (!solicitud) return;
    pendientes.delete(data.id);
    if (data.error) solicitud.reject(new Error(data.error));
    else solicitud.resolve(data.resultado);
  };
  const fallar = () => {
    fallo = new Error('No se pudo iniciar el motor Android. Cierre y vuelva a abrir la app; no se usará una base temporal.');
    for (const solicitud of pendientes.values()) solicitud.reject(fallo);
    pendientes.clear();
  };
  worker.onerror = fallar;
  worker.onmessageerror = fallar;
  const noDisponible = async (): Promise<never> => {
    throw new Error('PDF, archivos y diálogos de Electron no disponibles aún en Android');
  };
  return {
    plataforma: 'android',
    invocar(comando, datos) {
      if (fallo) return Promise.reject(fallo);
      return new Promise((resolve, reject) => {
        const id = ++secuencia;
        pendientes.set(id, { resolve, reject });
        try { worker.postMessage({ id, comando, datos }); }
        catch (error) { pendientes.delete(id); reject(error); }
      });
    },
    guardarCsv: noDisponible, pdfCotizacion: noDisponible, reportePdf: noDisponible,
    registrarAdjunto: noDisponible, guardarCsvAuxiliar: noDisponible, abrirAdjunto: noDisponible,
    guardarPaqueteContador: noDisponible, guardarAnexoF07: noDisponible,
    guardarAnexoF14: noDisponible, guardarEjercicioAnual: noDisponible
  };
}
