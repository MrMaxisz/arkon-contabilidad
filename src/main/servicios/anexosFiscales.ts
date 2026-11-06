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
  tipoIngresoRenta?: string;
  clasificacionRenta?: string;
  sector?: string;
  tipoCostoGasto?: string;
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
  if (tipo === 'venta') {
    if (!TIPOS_OPERACION_RENTA.has(entrada.tipoOperacionRenta ?? '')) {
      throw new ErrorAnexo(`Tipo de operación (Renta) inválido: ${entrada.tipoOperacionRenta}`);
    }
    if (!TIPOS_INGRESO_RENTA.has(entrada.tipoIngresoRenta ?? '')) {
      throw new ErrorAnexo(`Tipo de ingreso (Renta) inválido: ${entrada.tipoIngresoRenta}`);
    }
    if (entrada.tratamientoVenta !== undefined && !TRATAMIENTOS_VENTA.has(entrada.tratamientoVenta)) {
      throw new ErrorAnexo(`Tratamiento de venta inválido (exenta o no_sujeta): ${entrada.tratamientoVenta}`);
    }
  } else {
    if (!CATALOGO_Q_COMPRA.has(entrada.tipoOperacionRenta)) {
      throw new ErrorAnexo(`Tipo de operación (columna Q) de compra inválido: catálogo 1-4`);
    }
    if (!CATALOGO_R_COMPRA.has(entrada.clasificacionRenta ?? '')) {
      throw new ErrorAnexo(`Clasificación (columna R) de compra inválida: catálogo 1-2`);
    }
    if (!CATALOGO_S_COMPRA.has(entrada.sector ?? '')) {
      throw new ErrorAnexo(`Sector (columna S) de compra inválido: catálogo 1-4`);
    }
    if (!CATALOGO_T_COMPRA.has(entrada.tipoCostoGasto ?? '')) {
      throw new ErrorAnexo(`Tipo de costo/gasto (columna T) de compra inválido: catálogo 1-7`);
    }
    const errorConjunto = errorCombinacionRentaCompra(
      entrada.clasificacionRenta ?? '',
      entrada.sector ?? '',
      entrada.tipoCostoGasto ?? ''
    );
    if (errorConjunto) {
      throw new ErrorAnexo(errorConjunto);
    }
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
        `UPDATE compra SET clase_documento_fiscal = ?, numero_resolucion = ?, serie_documento = ?, numero_documento_autorizado = ?,
         tipo_operacion_renta = ?, clasificacion_renta = ?, sector = ?, tipo_costo_gasto = ?
         WHERE id = ?`
      ).run(
        entrada.claseDocumentoFiscal,
        entrada.numeroResolucion.trim(),
        entrada.serieDocumento.trim(),
        entrada.numeroDocumentoAutorizado.trim(),
        entrada.tipoOperacionRenta,
        entrada.clasificacionRenta ?? null,
        entrada.sector ?? null,
        entrada.tipoCostoGasto ?? null,
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
    const limiteColumna: number[] = [10, 1, 2, 100, 100, 100, 100, 14, Infinity, 10, 10, 10, 10, 10, 10, 10, 9, 2, 2, 1];
    for (let i = 0; i < fila.length; i++) {
      if (String(fila[i]).length > (limiteColumna[i] ?? Infinity)) {
        throw new ErrorAnexo(`Columna ${i + 1} excede el límite del manual para ${v.folio}`);
      }
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

export const FUENTE_OFICIAL_ANEXO2 =
  'Manual F-07 v14 (DGII, Enero 2025), Anexo 2: Detalle de Ventas a Consumidor Final, columnas A-W';
export const FUENTE_OFICIAL_ANEXO3 =
  'Manual F-07 v14 (DGII, Enero 2025), Anexo 3: Detalle de Compras, columnas A-U';

interface VentaConsumidor {
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

function ventasConsumidorDelMes(db: Database, mes: string): VentaConsumidor[] {
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
         AND v.clasificacion_documento = 'consumidor_final'
         AND v.fecha_operacion >= ? AND v.fecha_operacion <= ?
       ORDER BY v.fecha_operacion, v.id`
    )
    .all(`${mes}-01`, `${mes}-31`) as VentaConsumidor[];
}

function faltantesConsumidor(db: Database, v: VentaConsumidor, mes: string): string[] {
  const faltantes: string[] = [];
  if (!v.clase_documento_fiscal || !CLASES_DOCUMENTO.has(v.clase_documento_fiscal)) {
    faltantes.push('clase de documento (columna B: 1, 2 o 4)');
  }
  if (v.tipo_documento !== 'factura') {
    faltantes.push('tipo de documento (factura de consumidor final)');
  }
  if (!v.numero_resolucion || v.numero_resolucion.length > 100) {
    faltantes.push('número de resolución (columna D)');
  }
  if (!v.serie_documento || v.serie_documento.length > 100) {
    faltantes.push('número de serie (columna E)');
  }
  if (!v.numero_documento_autorizado || v.numero_documento_autorizado.length > 100) {
    faltantes.push('número de documento autorizado (columnas H/I)');
  }
  if (v.iva_minor === 0 && !v.tratamiento_venta) {
    faltantes.push('tratamiento de la venta sin IVA (exenta o no sujeta)');
  }
  if (mes >= '2025-01') {
    if (!v.tipo_operacion_renta || !TIPOS_OPERACION_RENTA.has(v.tipo_operacion_renta)) {
      faltantes.push('tipo de operación Renta (columna U)');
    }
    if (!v.tipo_ingreso_renta || !TIPOS_INGRESO_RENTA.has(v.tipo_ingreso_renta)) {
      faltantes.push('tipo de ingreso Renta (columna V)');
    }
  }
  const vigencia = db
    .prepare('SELECT id FROM vigencia_fiscal WHERE inscrito_iva = 1 AND desde <= ? AND (hasta IS NULL OR hasta >= ?)')
    .get(v.fecha, v.fecha) as { id: number } | undefined;
  if (!vigencia) {
    faltantes.push('cobertura de vigencia con IVA inscrito para la fecha del documento');
  }
  return faltantes;
}

export function diagnosticarAnexo2VentasConsumidor(db: Database, mes: string) {
  if (!/^\d{4}-\d{2}$/.test(mes)) {
    throw new ErrorAnexo(`Mes inválido (AAAA-MM): ${mes}`);
  }
  const ventas = ventasConsumidorDelMes(db, mes);
  const folios: Array<{ folio: string; documentoId: number; faltantes: string[] }> = [];
  const listos: string[] = [];
  for (const v of ventas) {
    const f = faltantesConsumidor(db, v, mes);
    if (f.length > 0) {
      folios.push({ folio: v.folio, documentoId: v.id, faltantes: f });
    } else {
      listos.push(v.folio);
    }
  }
  return {
    version: 'anexo-f07-v14-anexo2-esquema1',
    mes,
    folios,
    listos,
    bloqueado: folios.length > 0,
    motivo: folios.length > 0
      ? 'Hay ventas a consumidor final con metadatos fiscales incompletos o sin cobertura de vigencia'
      : '',
    fuente: FUENTE_OFICIAL_ANEXO2
  };
}

export function exportarAnexo2VentasConsumidorPresentacion(db: Database, mes: string) {
  const diagnostico = diagnosticarAnexo2VentasConsumidor(db, mes);
  if (diagnostico.bloqueado) {
    const detalle = diagnostico.folios.map(f => `${f.folio}: ${f.faltantes.join(', ')}`).join('; ');
    throw new ErrorAnexo(`El anexo 2 de presentación está bloqueado. ${diagnostico.motivo}. Faltantes: ${detalle}`);
  }
  const ventas = ventasConsumidorDelMes(db, mes);
  const lineas: string[] = [];
  const montosDe = (v: VentaConsumidor) => {
    const gravada = v.iva_minor > 0;
    return {
      exentas: !gravada && v.tratamiento_venta === 'exenta' ? v.base_minor : 0,
      noSujetas: !gravada && v.tratamiento_venta === 'no_sujeta' ? v.base_minor : 0,
      gravadasConIva: gravada ? v.total_minor : 0,
      total: v.total_minor
    };
  };
  const filaDe = (
    fecha: string,
    clase: string,
    d: string,
    e: string,
    f: string,
    g: string,
    h: string,
    i: string,
    montos: { exentas: number; noSujetas: number; gravadasConIva: number; total: number },
    tipoOperacion: string | null,
    tipoIngreso: string | null
  ) => {
    const aplicaRenta = mes >= '2025-01';
    return [
      fecha,
      clase,
      '01',
      d,
      e,
      f,
      g,
      h,
      i,
      '',
      minorATexto(BigInt(montos.exentas)),
      '0.00',
      minorATexto(BigInt(montos.noSujetas)),
      minorATexto(BigInt(montos.gravadasConIva)),
      '0.00',
      '0.00',
      '0.00',
      '0.00',
      '0.00',
      minorATexto(BigInt(montos.total)),
      aplicaRenta ? tipoOperacion ?? '' : '0',
      aplicaRenta ? tipoIngreso ?? '' : '0',
      '2'
    ];
  };
  const dtePorDia = new Map<string, VentaConsumidor[]>();
  for (const v of ventas) {
    const revalidacion = faltantesConsumidor(db, v, mes);
    if (revalidacion.length > 0) {
      throw new ErrorAnexo(`El folio ${v.folio} dejó de ser válido al exportar: ${revalidacion.join(', ')}`);
    }
    if (v.clase_documento_fiscal === '4') {
      const grupo = dtePorDia.get(v.fecha) ?? [];
      grupo.push(v);
      dtePorDia.set(v.fecha, grupo);
    }
  }
  for (const v of ventas) {
    if (v.clase_documento_fiscal === '4') {
      continue;
    }
    const montos = montosDe(v);
    const numero = v.numero_documento_autorizado ?? '';
    const fila =
      v.clase_documento_fiscal === '2'
        ? filaDe(fechaDdMmAaaa(v.fecha), v.clase_documento_fiscal ?? '', v.numero_resolucion ?? '', v.serie_documento ?? '', v.folio, v.folio, numero, numero, montos, v.tipo_operacion_renta ?? '', v.tipo_ingreso_renta ?? '')
        : filaDe(fechaDdMmAaaa(v.fecha), v.clase_documento_fiscal ?? '', v.numero_resolucion ?? '', v.serie_documento ?? '', numero, numero, numero, numero, montos, v.tipo_operacion_renta ?? '', v.tipo_ingreso_renta ?? '');
    if (fila.length !== 23) {
      throw new ErrorAnexo(`Fila con columnas incorrectas para ${v.folio}`);
    }
    const limites: number[] = [10, 1, 2, 100, 100, 100, 100, 100, 100, 14, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 2, 2, 1];
    for (let i = 0; i < fila.length; i++) {
      if (String(fila[i]).length > (limites[i] ?? Infinity)) {
        throw new ErrorAnexo(`Columna ${i + 1} excede el límite del manual para ${v.folio}`);
      }
    }
    lineas.push(fila.map(c => escaparCampo(String(c))).join(';'));
  }
  for (const [fecha, grupo] of dtePorDia) {
    const montos = grupo.reduce(
      (acc, v) => {
        const m = montosDe(v);
        return {
          exentas: acc.exentas + m.exentas,
          noSujetas: acc.noSujetas + m.noSujetas,
          gravadasConIva: acc.gravadasConIva + m.gravadasConIva,
          total: acc.total + m.total
        };
      },
      { exentas: 0, noSujetas: 0, gravadasConIva: 0, total: 0 }
    );
    const primero = grupo[0]!;
    const ultimo = grupo[grupo.length - 1]!;
    const fila = filaDe(
      fechaDdMmAaaa(fecha),
      '4',
      'N/A',
      'N/A',
      'N/A',
      'N/A',
      primero.numero_documento_autorizado ?? '',
      ultimo.numero_documento_autorizado ?? '',
      montos,
      primero.tipo_operacion_renta ?? '',
      primero.tipo_ingreso_renta ?? ''
    );
    if (fila.length !== 23) {
      throw new ErrorAnexo('Fila DTE agrupada con columnas incorrectas');
    }
    lineas.push(fila.map(c => escaparCampo(String(c))).join(';'));
  }
  return { csv: lineas.join('\n'), version: 'anexo-f07-v14-anexo2-esquema1', mes, filas: lineas.length, fuente: FUENTE_OFICIAL_ANEXO2 };
}

interface CompraAnexo {
  id: number;
  folio: string;
  fecha: string;
  total_minor: number;
  nit: string;
  nrc: string;
  nombre: string;
  tipo_documento: string;
  clase_documento_fiscal: string | null;
  numero_documento_autorizado: string | null;
  tipo_operacion_renta: string | null;
  clasificacion_renta: string | null;
  sector: string | null;
  tipo_costo_gasto: string | null;
}

function comprasDelMes(db: Database, mes: string): CompraAnexo[] {
  validarFechaCalendario(`${mes}-01`);
  return db
    .prepare(
      `SELECT co.id, co.folio, co.fecha_operacion AS fecha, co.total_minor,
              COALESCE(c.nit, '') AS nit, COALESCE(c.nrc, '') AS nrc, c.nombre,
              COALESCE(co.tipo_documento, '') AS tipo_documento,
              co.clase_documento_fiscal, co.numero_documento_autorizado,
              co.tipo_operacion_renta, co.clasificacion_renta, co.sector, co.tipo_costo_gasto
       FROM compra co
       JOIN contraparte c ON c.id = co.contraparte_id
       WHERE co.estado = 'registrada'
         AND co.fecha_operacion >= ? AND co.fecha_operacion <= ?
       ORDER BY co.fecha_operacion, co.id`
    )
    .all(`${mes}-01`, `${mes}-31`) as CompraAnexo[];
}

function montosCompra(db: Database, compraId: number): { exentasNoSujetas: bigint; gravadas: bigint; credito: bigint } {
  const f = db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN l.tratamiento IN ('exento','no_sujeto') THEN l.base_minor ELSE 0 END), 0) AS exentas,
              COALESCE(SUM(CASE WHEN l.tratamiento = 'gravado' THEN l.base_minor ELSE 0 END), 0) AS gravadas,
              COALESCE(SUM(l.iva_minor), 0) AS iva
       FROM compra_linea l WHERE l.compra_id = ?`
    )
    .get(compraId) as { exentas: number; gravadas: number; iva: number };
  return { exentasNoSujetas: BigInt(f.exentas), gravadas: BigInt(f.gravadas), credito: BigInt(f.iva) };
}

const CLASES_DOCUMENTO_COMPRA = new Set(['1', '2', '3', '4']);
// Catálogos ordinarios del Anexo 3 (manual F-07 v14, página impresa 20): Q 1-4, R 1-2, S 1-4, T 1-7.
// Los códigos 8/9 excepcionales no se aceptan hasta verificar el texto exacto de sus reglas en la fuente.
const CATALOGO_Q_COMPRA = new Set(['1', '2', '3', '4']);
const CATALOGO_R_COMPRA = new Set(['1', '2']);
const CATALOGO_S_COMPRA = new Set(['1', '2', '3', '4']);
const CATALOGO_T_COMPRA = new Set(['1', '2', '3', '4', '5', '6', '7']);

// Reglas conjuntas del Anexo 3 (manual F-07 v14, tabla página impresa 21):
// - R2 (gasto) permite T 1-3 con cualquier S 1-4.
// - R1 (costo) + S1 (industria) permite T 4-7.
// - R1 (costo) + S2/S3/S4 permite T 4-5.
function combinacionRentaCompraValida(r: string, sector: string, t: string): boolean {
  if (r === '2') {
    return ['1', '2', '3'].includes(t);
  }
  if (r === '1') {
    if (sector === '1') {
      return ['4', '5', '6', '7'].includes(t);
    }
    return ['4', '5'].includes(t);
  }
  return false;
}

function errorCombinacionRentaCompra(r: string, sector: string, t: string): string | null {
  if (!combinacionRentaCompraValida(r, sector, t)) {
    return `combinación R=${r}/S=${sector}/T=${t} no permitida por la tabla del manual F-07 v14 (página impresa 21)`;
  }
  return null;
}

function faltantesCompra(db: Database, co: CompraAnexo, mes: string): string[] {
  const faltantes: string[] = [];
  const nit = (co.nit || '').replace(/[-|]/g, '');
  const nrc = (co.nrc || '').replace(/[-|]/g, '');
  if (!/^\d{14}$/.test(nit) && !/^\d{1,14}$/.test(nrc)) {
    faltantes.push('NIT (14 dígitos) o NRC válido del proveedor');
  }
  if (!co.clase_documento_fiscal || !CLASES_DOCUMENTO_COMPRA.has(co.clase_documento_fiscal)) {
    faltantes.push('clase de documento (columna B: 1, 2, 3 o 4)');
  }
  if (co.tipo_documento !== 'ccf') {
    faltantes.push('tipo de documento (comprobante de crédito fiscal)');
  }
  if (!co.numero_documento_autorizado || co.numero_documento_autorizado.length > 100) {
    faltantes.push('número de documento del proveedor (columna D)');
  }
  if (mes >= '2024-02') {
    if (!CATALOGO_Q_COMPRA.has(co.tipo_operacion_renta ?? '')) {
      faltantes.push('tipo de operación del catálogo 1-4 (columna Q)');
    }
    if (!CATALOGO_R_COMPRA.has(co.clasificacion_renta ?? '')) {
      faltantes.push('clasificación del catálogo 1-2 (columna R)');
    }
    if (!CATALOGO_S_COMPRA.has(co.sector ?? '')) {
      faltantes.push('sector del catálogo 1-4 (columna S)');
    }
    if (!CATALOGO_T_COMPRA.has(co.tipo_costo_gasto ?? '')) {
      faltantes.push('tipo de costo/gasto del catálogo 1-7 (columna T)');
    }
    const errorConjunto = errorCombinacionRentaCompra(
      co.clasificacion_renta ?? '',
      co.sector ?? '',
      co.tipo_costo_gasto ?? ''
    );
    if (errorConjunto) {
      faltantes.push(errorConjunto);
    }
  }
  const vigencia = db
    .prepare('SELECT id FROM vigencia_fiscal WHERE inscrito_iva = 1 AND desde <= ? AND (hasta IS NULL OR hasta >= ?)')
    .get(co.fecha, co.fecha) as { id: number } | undefined;
  if (!vigencia) {
    faltantes.push('cobertura de vigencia con IVA inscrito para la fecha del documento');
  }
  return faltantes;
}

export function diagnosticarAnexo3Compras(db: Database, mes: string) {
  if (!/^\d{4}-\d{2}$/.test(mes)) {
    throw new ErrorAnexo(`Mes inválido (AAAA-MM): ${mes}`);
  }
  const compras = comprasDelMes(db, mes);
  const folios: Array<{ folio: string; documentoId: number; faltantes: string[] }> = [];
  const listos: string[] = [];
  for (const co of compras) {
    const f = faltantesCompra(db, co, mes);
    if (f.length > 0) {
      folios.push({ folio: co.folio, documentoId: co.id, faltantes: f });
    } else {
      listos.push(co.folio);
    }
  }
  return {
    version: 'anexo-f07-v14-anexo3-esquema1',
    mes,
    folios,
    listos,
    bloqueado: folios.length > 0,
    motivo: folios.length > 0
      ? 'Hay compras con metadatos fiscales incompletos o sin cobertura de vigencia'
      : '',
    fuente: FUENTE_OFICIAL_ANEXO3
  };
}

export function exportarAnexo3ComprasPresentacion(db: Database, mes: string) {
  const diagnostico = diagnosticarAnexo3Compras(db, mes);
  if (diagnostico.bloqueado) {
    const detalle = diagnostico.folios.map(f => `${f.folio}: ${f.faltantes.join(', ')}`).join('; ');
    throw new ErrorAnexo(`El anexo 3 de presentación está bloqueado. ${diagnostico.motivo}. Faltantes: ${detalle}`);
  }
  const compras = comprasDelMes(db, mes);
  const lineas: string[] = [];
  for (const co of compras) {
    const revalidacion = faltantesCompra(db, co, mes);
    if (revalidacion.length > 0) {
      throw new ErrorAnexo(`El folio ${co.folio} dejó de ser válido al exportar: ${revalidacion.join(', ')}`);
    }
    const montos = montosCompra(db, co.id);
    const aplicaRentas = mes >= '2024-02';
    const fila = [
      fechaDdMmAaaa(co.fecha),
      co.clase_documento_fiscal ?? '',
      '03',
      co.numero_documento_autorizado ?? '',
      /^\d{14}$/.test((co.nit || '').replace(/[-|]/g, ''))
        ? (co.nit || '').replace(/[-|]/g, '')
        : (co.nrc || '').replace(/[-|]/g, ''),
      co.nombre,
      minorATexto(montos.exentasNoSujetas),
      '0.00',
      '0.00',
      minorATexto(montos.gravadas),
      '0.00',
      '0.00',
      '0.00',
      minorATexto(montos.credito),
      minorATexto(montos.exentasNoSujetas + montos.gravadas),
      '',
      aplicaRentas ? co.tipo_operacion_renta ?? '' : '0',
      aplicaRentas ? co.clasificacion_renta ?? '' : '0',
      aplicaRentas ? co.sector ?? '' : '0',
      aplicaRentas ? co.tipo_costo_gasto ?? '' : '0',
      '3'
    ];
    if (fila.length !== 21) {
      throw new ErrorAnexo(`Fila con columnas incorrectas para ${co.folio}`);
    }
    const limites: number[] = [10, 1, 2, 100, 14, Infinity, 10, 10, 10, 10, 10, 10, 10, 10, 10, 9, 1, 1, 1, 1, 1];
    for (let i = 0; i < fila.length; i++) {
      if (String(fila[i]).length > (limites[i] ?? Infinity)) {
        throw new ErrorAnexo(`Columna ${i + 1} excede el límite del manual para ${co.folio}`);
      }
    }
    lineas.push(fila.map(c => escaparCampo(String(c))).join(';'));
  }
  return { csv: lineas.join('\n'), version: 'anexo-f07-v14-anexo3-esquema1', mes, filas: lineas.length, fuente: FUENTE_OFICIAL_ANEXO3 };
}
