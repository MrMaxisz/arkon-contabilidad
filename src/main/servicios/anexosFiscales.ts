import type BetterSqlite3 from 'better-sqlite3';
type Database = BetterSqlite3.Database;
import { validarFechaCalendario } from '../../shared/fechas';
import { minorATexto } from '../../shared/dinero';
import { registroEvento } from './bitacora';

export class ErrorAnexo extends Error {}

export const FUENTE_OFICIAL_ANEXO1 =
  'Manual de usuario para carga de archivo de los anexos de la declaración F-07 v14 (DGII, Ministerio de Hacienda El Salvador, Enero 2025), Anexo 1: Detalle de Ventas a Contribuyentes, columnas A-T';

const CLASES_DOCUMENTO = new Set(['1', '2', '4']);
const TIPOS_OPERACION_RENTA = new Set(['1', '2', '3', '4', '12', '13']);
const TIPOS_INGRESO_RENTA = new Set(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '12', '13']);
const TRATAMIENTOS_VENTA = new Set(['exenta', 'no_sujeta']);

export interface EntradaMetadatosFiscales {
  claseDocumentoFiscal: string;
  numeroResolucion: string;
  serieDocumento: string;
  numeroDocumentoAutorizado: string;
  tratamientoVenta?: 'exenta' | 'no_sujeta';
  tipoOperacionRenta: string;
  tipoIngresoRenta: string;
}

export function completarMetadatosFiscales(
  db: Database,
  tipo: 'venta' | 'compra',
  documentoId: number,
  entrada: EntradaMetadatosFiscales,
  responsable: string,
  motivo: string
): void {
  if (!responsable?.trim()) {
    throw new ErrorAnexo('Completar metadatos fiscales exige responsable');
  }
  if (!motivo?.trim()) {
    throw new ErrorAnexo('Completar metadatos fiscales exige motivo');
  }
  if (!CLASES_DOCUMENTO.has(entrada.claseDocumentoFiscal)) {
    throw new ErrorAnexo(`Clase de documento inválida (1, 2 o 4): ${entrada.claseDocumentoFiscal}`);
  }
  if (!entrada.numeroResolucion?.trim() || !entrada.serieDocumento?.trim() || !entrada.numeroDocumentoAutorizado?.trim()) {
    throw new ErrorAnexo('Los metadatos fiscales exigen resolución, serie y número autorizados');
  }
  if (entrada.tipoOperacionRenta !== undefined && !TIPOS_OPERACION_RENTA.has(entrada.tipoOperacionRenta)) {
    throw new ErrorAnexo(`Tipo de operación (Renta) inválido: ${entrada.tipoOperacionRenta}`);
  }
  if (!TIPOS_INGRESO_RENTA.has(entrada.tipoIngresoRenta)) {
    throw new ErrorAnexo(`Tipo de ingreso (Renta) inválido: ${entrada.tipoIngresoRenta}`);
  }
  if (entrada.tratamientoVenta !== undefined && !TRATAMIENTOS_VENTA.has(entrada.tratamientoVenta)) {
    throw new ErrorAnexo(`Tratamiento de venta inválido (exenta o no_sujeta): ${entrada.tratamientoVenta}`);
  }
  const tabla = tipo === 'venta' ? 'venta' : 'compra';
  const doc = db.prepare(`SELECT id, folio, estado FROM ${tabla} WHERE id = ?`).get(documentoId) as
    | { id: number; folio: string; estado: string }
    | undefined;
  if (!doc) {
    throw new ErrorAnexo(`Documento inexistente: ${documentoId}`);
  }
  if (doc.estado !== 'registrada') {
    throw new ErrorAnexo(`Solo se completan metadatos de documentos registrados: ${doc.folio}`);
  }
  const tx = db.transaction(() => {
    if (tipo === 'venta') {
      db.prepare(
        `UPDATE venta SET clase_documento_fiscal = ?, numero_resolucion = ?, serie_documento = ?,
         numero_documento_autorizado = ?, tratamiento_venta = ?, tipo_operacion_renta = ?, tipo_ingreso_renta = ?
         WHERE id = ?`
      ).run(
        entrada.claseDocumentoFiscal,
        entrada.numeroResolucion.trim(),
        entrada.serieDocumento.trim(),
        entrada.numeroDocumentoAutorizado.trim(),
        entrada.tratamientoVenta ?? null,
        entrada.tipoOperacionRenta,
        entrada.tipoIngresoRenta,
        documentoId
      );
    } else {
      db.prepare(
        `UPDATE compra SET clase_documento_fiscal = ?, numero_resolucion = ?, serie_documento = ?, numero_documento_autorizado = ?
         WHERE id = ?`
      ).run(
        entrada.claseDocumentoFiscal,
        entrada.numeroResolucion.trim(),
        entrada.serieDocumento.trim(),
        entrada.numeroDocumentoAutorizado.trim(),
        documentoId
      );
    }
    registroEvento(db, responsable, 'metadatos_fiscales_completados', tipo, String(documentoId), {
      folio: doc.folio,
      motivo,
      nota: 'Metadatos documentales/tributarios explícitos según manual F-07 v14; no altera importes ni asiento'
    });
  });
  tx();
}

interface VentaAnexo {
  id: number;
  folio: string;
  fecha: string;
  base_minor: number;
  iva_minor: number;
  total_minor: number;
  nit: string;
  nrc: string;
  nombre: string;
  tipo_documento: string;
  clase_documento_fiscal: string | null;
  numero_resolucion: string | null;
  serie_documento: string | null;
  numero_documento_autorizado: string | null;
  tratamiento_venta: string | null;
  tipo_operacion_renta: string | null;
  tipo_ingreso_renta: string | null;
}

function ventasDelMes(db: Database, mes: string): VentaAnexo[] {
  validarFechaCalendario(`${mes}-01`);
  return db
    .prepare(
      `SELECT v.id, v.folio, v.fecha_operacion AS fecha, v.base_minor, v.iva_minor, v.total_minor,
              COALESCE(c.nit, '') AS nit, COALESCE(c.nrc, '') AS nrc, c.nombre,
              COALESCE(v.tipo_documento, '') AS tipo_documento,
              v.clase_documento_fiscal, v.numero_resolucion, v.serie_documento,
              v.numero_documento_autorizado, v.tratamiento_venta,
              v.tipo_operacion_renta, v.tipo_ingreso_renta
       FROM venta v
       JOIN contraparte c ON c.id = v.contraparte_id
       WHERE v.estado = 'registrada'
         AND v.clasificacion_documento = 'contribuyente'
         AND v.fecha_operacion >= ? AND v.fecha_operacion <= ?
       ORDER BY v.fecha_operacion, v.id`
    )
    .all(`${mes}-01`, `${mes}-31`) as VentaAnexo[];
}

function faltantesDe(db: Database, v: VentaAnexo, mes: string): string[] {
  const faltantes: string[] = [];
  const nit = (v.nit || '').replace(/[-|]/g, '');
  const nrc = (v.nrc || '').replace(/[-|]/g, '');
  const nitValido = /^\d{14}$/.test(nit);
  const nrcValido = /^\d{1,14}$/.test(nrc);
  if (!nitValido && !nrcValido) {
    faltantes.push('NIT (14 dígitos) o NRC válido del cliente');
  }
  if (v.tipo_documento !== 'ccf') {
    faltantes.push('tipo de documento autorizado (CCF)');
  }
  if (!v.clase_documento_fiscal || !CLASES_DOCUMENTO.has(v.clase_documento_fiscal)) {
    faltantes.push('clase de documento (columna B: 1, 2 o 4)');
  }
  if (!v.numero_resolucion) {
    faltantes.push('número de resolución (columna D)');
  } else if (v.numero_resolucion.length > 100) {
    faltantes.push('número de resolución excede 100 caracteres (columna D)');
  }
  if (!v.serie_documento) {
    faltantes.push('número de serie (columna E)');
  } else if (v.serie_documento.length > 100) {
    faltantes.push('número de serie excede 100 caracteres (columna E)');
  }
  if (!v.numero_documento_autorizado) {
    faltantes.push('número de documento autorizado (columna F)');
  } else if (v.numero_documento_autorizado.length > 100) {
    faltantes.push('número de documento autorizado excede 100 caracteres (columna F)');
  }
  if (v.iva_minor === 0 && !v.tratamiento_venta) {
    faltantes.push('tratamiento de la venta sin IVA (exenta o no sujeta)');
  }
  if (mes >= '2025-01') {
    if (!v.tipo_operacion_renta || !TIPOS_OPERACION_RENTA.has(v.tipo_operacion_renta)) {
      faltantes.push('tipo de operación Renta (columna R)');
    }
    if (!v.tipo_ingreso_renta || !TIPOS_INGRESO_RENTA.has(v.tipo_ingreso_renta)) {
      faltantes.push('tipo de ingreso Renta (columna S)');
    }
  }
  const vigencia = db
    .prepare(
      `SELECT id FROM vigencia_fiscal
       WHERE inscrito_iva = 1 AND desde <= ? AND (hasta IS NULL OR hasta >= ?)`
    )
    .get(v.fecha, v.fecha) as { id: number } | undefined;
  if (!vigencia) {
    faltantes.push('cobertura de vigencia con IVA inscrito para la fecha del documento');
  }
  return faltantes;
}

function controlInterno(v: VentaAnexo): string {
  if (v.clase_documento_fiscal === '2') {
    return v.numero_documento_autorizado ?? '';
  }
  if (v.clase_documento_fiscal === '4') {
    return '';
  }
  return v.folio;
}

export interface DiagnosticoAnexo1 {
  version: string;
  mes: string;
  folios: Array<{ folio: string; documentoId: number; faltantes: string[] }>;
  listos: string[];
  bloqueado: boolean;
  motivo: string;
  fuente: string;
}

export function diagnosticarAnexo1Ventas(db: Database, mes: string): DiagnosticoAnexo1 {
  if (!/^\d{4}-\d{2}$/.test(mes)) {
    throw new ErrorAnexo(`Mes inválido (AAAA-MM): ${mes}`);
  }
  const ventas = ventasDelMes(db, mes);
  const folios: Array<{ folio: string; documentoId: number; faltantes: string[] }> = [];
  const listos: string[] = [];
  for (const v of ventas) {
    const f = faltantesDe(db, v, mes);
    if (f.length > 0) {
      folios.push({ folio: v.folio, documentoId: v.id, faltantes: f });
    } else {
      listos.push(v.folio);
    }
  }
  const bloqueado = folios.length > 0;
  const motivos: string[] = [];
  if (folios.length > 0) {
    motivos.push('Hay folios con metadatos fiscales incompletos o sin cobertura de vigencia; complételos por la vía auditada antes de generar el archivo de presentación');
  }
  const motivo = motivos.join(' ');
  return {
    version: 'anexo-f07-v14-anexo1-esquema2',
    mes,
    folios,
    listos,
    bloqueado,
    motivo,
    fuente: FUENTE_OFICIAL_ANEXO1
  };
}

function escaparCampo(valor: string): string {
  if (/[";\n\r]/.test(valor)) {
    return `"${valor.replace(/"/g, '""')}"`;
  }
  return valor;
}

function fechaDdMmAaaa(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

export interface ResultadoAnexo1Presentacion {
  csv: string;
  version: string;
  mes: string;
  filas: number;
  fuente: string;
}

export function exportarAnexo1VentasPresentacion(db: Database, mes: string): ResultadoAnexo1Presentacion {
  const diagnostico = diagnosticarAnexo1Ventas(db, mes);
  if (diagnostico.bloqueado) {
    const detalle = diagnostico.folios.map(f => `${f.folio}: ${f.faltantes.join(', ')}`).join('; ');
    throw new ErrorAnexo(
      `El anexo de presentación está bloqueado. ${diagnostico.motivo}${detalle ? ` Faltantes: ${detalle}` : ''}`
    );
  }
  const ventas = ventasDelMes(db, mes);
  const lineas: string[] = [];
  for (const v of ventas) {
    const revalidacion = faltantesDe(db, v, mes);
    if (revalidacion.length > 0) {
      throw new ErrorAnexo(`El folio ${v.folio} dejó de ser válido al exportar: ${revalidacion.join(', ')}`);
    }
    const nit = (v.nit || '').replace(/[-|]/g, '');
    const nrc = (v.nrc || '').replace(/[-|]/g, '');
    const identificacion = /^\d{14}$/.test(nit) ? nit : nrc;
    const gravada = v.iva_minor > 0;
    const exentas = !gravada && v.tratamiento_venta === 'exenta' ? v.base_minor : 0;
    const noSujetas = !gravada && v.tratamiento_venta === 'no_sujeta' ? v.base_minor : 0;
    const gravadas = gravada ? v.base_minor : 0;
    const aplicaRenta = mes >= '2025-01';
    const fila = [
      fechaDdMmAaaa(v.fecha),
      v.clase_documento_fiscal ?? '',
      '03',
      v.numero_resolucion ?? '',
      v.serie_documento ?? '',
      v.numero_documento_autorizado ?? '',
      controlInterno(v),
      identificacion,
      v.nombre,
      minorATexto(BigInt(exentas)),
      minorATexto(BigInt(noSujetas)),
      minorATexto(BigInt(gravadas)),
      minorATexto(BigInt(v.iva_minor)),
      '0.00',
      '0.00',
      minorATexto(BigInt(v.total_minor)),
      '',
      aplicaRenta ? v.tipo_operacion_renta ?? '' : '0',
      aplicaRenta ? v.tipo_ingreso_renta ?? '' : '0',
      '1'
    ];
    if (fila.length !== 20) {
      throw new ErrorAnexo(`Fila con columnas incorrectas para ${v.folio}`);
    }
    if (fila.some(c => c.length > 100)) {
      throw new ErrorAnexo(`Fila con contenido fuera de límites para ${v.folio}`);
    }
    lineas.push(fila.map(c => escaparCampo(String(c))).join(';'));
  }
  return {
    csv: lineas.join('\n'),
    version: 'anexo-f07-v14-anexo1-esquema2',
    mes,
    filas: lineas.length,
    fuente: FUENTE_OFICIAL_ANEXO1
  };
}
