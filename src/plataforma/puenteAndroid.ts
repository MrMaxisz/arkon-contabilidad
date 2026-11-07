import type { ArkonApi } from '../renderer/api';
import { abrirArchivo, guardarArchivo, pluginArchivos, type ArkonArchivos } from './archivosAndroid';
import { formatearFechaHoraElSalvador } from '../shared/fechas';
import { construirHtmlReporte, vestirHtmlCotizacion } from '../main/servicios/reportesPdf';
import { recursosPdfAndroid } from './recursosPdfAndroid';

export function crearPuenteAndroid(worker: Worker, opciones: {
  plugin?: () => ArkonArchivos;
  recursosPdf?: typeof recursosPdfAndroid;
  confirmar?: (mensaje: string) => boolean;
} = {}): ArkonApi {
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
    throw new Error('Esta función de escritorio no está disponible aún en Android');
  };
  const plugin = opciones.plugin ?? pluginArchivos;
  const recursos = opciones.recursosPdf ?? recursosPdfAndroid;
  const invocar = (comando: string, datos?: unknown): Promise<unknown> => {
    if (fallo) return Promise.reject(fallo);
    return new Promise((resolve, reject) => {
      const id = ++secuencia;
      pendientes.set(id, { resolve, reject });
      try { worker.postMessage({ id, comando, datos }); }
      catch (error) { pendientes.delete(id); reject(error); }
    });
  };
  let ocupado = false;
  const exclusivo = async <T>(tarea: () => Promise<T>): Promise<T> => {
    if (ocupado) throw new Error('Hay otra operación de archivos en curso');
    ocupado = true;
    try { return await tarea(); } finally { ocupado = false; }
  };
  return {
    plataforma: 'android',
    async invocar(comando, datos) {
      if (comando === 'traspaso:exportar') return exclusivo(async () => {
        const nativo = plugin();
        const paquete = await invocar(comando) as { bytes: Uint8Array; nombre: string };
        const r = await guardarArchivo(nativo, paquete.nombre, 'application/octet-stream', paquete.bytes);
        if (r.guardado) await invocar('traspaso:registrarExportacion', { nombre: paquete.nombre });
        return r;
      });
      if (comando === 'traspaso:importar') return exclusivo(async () => {
        const bytes = await abrirArchivo(plugin());
        if (!bytes) return { estado: 'cancelado', detalle: 'Importación cancelada.' };
        const info = await invocar('traspaso:inspeccionar', { bytes }) as { fecha: string; saldos: string };
        const aceptar = opciones.confirmar ?? (mensaje => window.confirm(mensaje));
        if (!aceptar(`La base del teléfono será reemplazada por la del paquete. Se conservará una copia previa.\nFecha: ${formatearFechaHoraElSalvador(info.fecha)}\n${info.saldos}\n¿Reemplazar la base del teléfono?`)) return { estado: 'cancelado', detalle: 'Importación cancelada.' };
        return invocar(comando, { bytes });
      });
      return invocar(comando, datos);
    },
    guardarCsv: (tipo, mes) => exclusivo(async () => {
      const nativo = plugin();
      const r = await invocar('android:csvLibro', { tipo, mes }) as { csv: string; version: string };
      return { ...await guardarArchivo(nativo, `arkon-${tipo}-${mes}.csv`, 'text/csv', new TextEncoder().encode(`${r.csv}\n`)), version: r.version };
    }),
    pdfCotizacion: cotizacionId => exclusivo(async () => {
      const nativo = plugin();
      const { html } = await invocar('cotizacion:html', { cotizacionId }) as { html: string };
      const { logoSvg, fuentesCss } = await recursos();
      return nativo.imprimir({ nombre: `cotizacion-${cotizacionId}`, html: vestirHtmlCotizacion(html, logoSvg, fuentesCss) });
    }),
    reportePdf: solicitud => exclusivo(async () => {
      const nativo = plugin();
      const { logoSvg, fuentesCss } = await recursos();
      return nativo.imprimir({ nombre: solicitud.titulo, html: construirHtmlReporte(solicitud, logoSvg, fuentesCss) });
    }),
    registrarAdjunto: noDisponible,
    guardarCsvAuxiliar: solicitud => exclusivo(async () => {
      const nativo = plugin();
      const r = await invocar('android:csvAuxiliar', solicitud) as { csv: string; version: string };
      return { ...await guardarArchivo(nativo, `auxiliar-${solicitud.tipo}${solicitud.alcance === 'detalle' ? '-detalle' : ''}.csv`, 'text/csv', new TextEncoder().encode(`${r.csv}\n`)), version: r.version };
    }), abrirAdjunto: noDisponible,
    guardarPaqueteContador: noDisponible, guardarAnexoF07: noDisponible,
    guardarAnexoF14: noDisponible, guardarEjercicioAnual: noDisponible
  };
}
