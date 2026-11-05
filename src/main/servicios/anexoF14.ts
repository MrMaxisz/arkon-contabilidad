import type BetterSqlite3 from 'better-sqlite3';
type Database = BetterSqlite3.Database;
import { validarFechaCalendario } from '../../shared/fechas';
import { minorATexto } from '../../shared/dinero';
import { registroEvento } from './bitacora';

export class ErrorF14 extends Error {}

export const FUENTE_OFICIAL_F14 =
  'Manual de usuario para la carga de archivo del Anexo de Retenciones de Impuesto sobre la Renta a sujetos domiciliados y no domiciliados en la declaración de Pago a Cuenta e Impuesto Retenido Renta F-14 v16 (DGII, Ministerio de Hacienda, Octubre 2025), 23 columnas A-W';

// Matriz exacta del Anexo F-14 v16 (página 2 del manual oficial):
// A domiciliado(1); B país(4); C nombre(100); D NIT/NIF(14); E DUI(9); F código ingreso(2);
// G devengado(12); H bonificaciones(12); I retenido(12); J aguinaldo exento(6); K aguinaldo gravado(12);
// L AFP(6); M ISSS(5); N INPEP(5); O IPSFA(5); P CEFAFA(5); Q Bienestar Magisterial(5); R ISSS/IVM(5);
// S tipo operación(1); T clasificación(1); U sector(1); V tipo costo/gasto(1); W período(6, MMYYYY).
const LIMITES_F14: number[] = [1, 4, 100, 14, 9, 2, 12, 12, 12, 6, 12, 6, 5, 5, 5, 5, 5, 5, 1, 1, 1, 1, 6];

// Catálogos S/T verificados en el manual F-14 (páginas 4-5): S 1 Gravada / 2 No Gravada;
// T 1 Costo / 2 Gasto. Nota 9 (página 5): instituciones públicas, municipalidades, sujetos pasivos
// no inscritos en IVA y operaciones no deducibles completan S/T/U/V con 9.
const CATALOGO_S_F14 = new Set(['1', '2', '9']);
const CATALOGO_T_F14 = new Set(['1', '2', '9']);
// Los catálogos exactos de U (sector) y V (tipo de costo/gasto) del F-14 no pudieron extraerse del
// PDF de imágenes con la lista completa; se valida dígito simple y el 9 de la nota 9. Pendiente documentado.
const CATALOGO_UV_F14 = /^[0-9]$/;

export interface EntradaMetadatosRetencion {
  domiciliado: string;
  codigoPais: string;
  nitNif?: string;
  dui?: string;
  codigoIngreso: string;
  tipoOperacion: string;
  clasificacion: string;
  sector: string;
  tipoCostoGasto: string;
}

export function completarMetadatosRetencion(
  db: Database,
  retencionId: number,
  entrada: EntradaMetadatosRetencion,
  responsable: string,
  motivo: string
): void {
  if (!responsable?.trim()) {
    throw new ErrorF14('Completar metadatos de retención exige responsable');
  }
  if (!motivo?.trim()) {
    throw new ErrorF14('Completar metadatos de retención exige motivo');
  }
  if (!/^[0-9]$/.test(entrada.domiciliado)) {
    throw new ErrorF14('Domiciliado inválido: un dígito (columna A)');
  }
  if (!/^\d{4}$/.test(entrada.codigoPais)) {
    throw new ErrorF14('Código de país inválido: 4 dígitos (columna B)');
  }
  const nit = entrada.nitNif?.replace(/[-|]/g, '') ?? '';
  const dui = entrada.dui?.replace(/[-|]/g, '') ?? '';
  if (nit && !/^\d{14}$/.test(nit)) {
    throw new ErrorF14('NIT/NIF inválido: 14 dígitos sin guiones (columna D)');
  }
  if (dui && !/^\d{9}$/.test(dui)) {
    throw new ErrorF14('DUI inválido: 9 dígitos sin guiones (columna E)');
  }
  if (!nit && !dui) {
    throw new ErrorF14('La retención exige NIT/NIF (14) o DUI (9) del sujeto retenido');
  }
  if (!/^\d{2}$/.test(entrada.codigoIngreso)) {
    throw new ErrorF14('Código de ingreso inválido: 2 dígitos del apéndice del F-14 (columna F)');
  }
  if (!CATALOGO_S_F14.has(entrada.tipoOperacion)) {
    throw new ErrorF14('Tipo de operación inválido: catálogo 1-2 (o 9 por nota 9) (columna S)');
  }
  if (!CATALOGO_T_F14.has(entrada.clasificacion)) {
    throw new ErrorF14('Clasificación inválida: catálogo 1-2 (o 9 por nota 9) (columna T)');
  }
  if (!CATALOGO_UV_F14.test(entrada.sector)) {
    throw new ErrorF14('Sector inválido: un dígito (columna U)');
  }
  if (!CATALOGO_UV_F14.test(entrada.tipoCostoGasto)) {
    throw new ErrorF14('Tipo de costo/gasto inválido: un dígito (columna V)');
  }
  const ret = db.prepare('SELECT id, folio, estado FROM retencion WHERE id = ?').get(retencionId) as
    | { id: number; folio: string; estado: string }
    | undefined;
  if (!ret) {
    throw new ErrorF14(`Retención inexistente: ${retencionId}`);
  }
  if (ret.estado !== 'registrada') {
    throw new ErrorF14(`Solo se completan metadatos de retenciones registradas: ${ret.folio}`);
  }
  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE retencion SET domiciliado = ?, codigo_pais = ?, nit_nif = ?, dui = ?, codigo_ingreso = ?,
       tipo_operacion_f14 = ?, clasificacion_f14 = ?, sector_f14 = ?, tipo_costo_gasto_f14 = ?
       WHERE id = ?`
    ).run(
      entrada.domiciliado,
      entrada.codigoPais,
      nit || null,
      dui || null,
      entrada.codigoIngreso,
      entrada.tipoOperacion,
      entrada.clasificacion,
      entrada.sector,
      entrada.tipoCostoGasto,
      retencionId
    );
    registroEvento(db, responsable, 'metadatos_f14_completados', 'retencion', String(retencionId), {
      folio: ret.folio,
      motivo,
      nota: 'Metadatos documentales/tributarios explícitos según manual F-14 v16; no altera importes ni asiento'
    });
  });
  tx();
}

interface RetencionF14 {
  id: number;
  folio: string;
  fecha: string;
  base_minor: number;
  monto_minor: number;
  nombre: string;
  domiciliado: string | null;
  codigo_pais: string | null;
  nit_nif: string | null;
  dui: string | null;
  codigo_ingreso: string | null;
  tipo_operacion_f14: string | null;
  clasificacion_f14: string | null;
  sector_f14: string | null;
  tipo_costo_gasto_f14: string | null;
}

function retencionesDelMes(db: Database, mes: string): RetencionF14[] {
  validarFechaCalendario(`${mes}-01`);
  return db
    .prepare(
      `SELECT r.id, r.folio, r.fecha_operacion AS fecha, r.base_minor, r.monto_minor, c.nombre,
              r.domiciliado, r.codigo_pais, r.nit_nif, r.dui, r.codigo_ingreso,
              r.tipo_operacion_f14, r.clasificacion_f14, r.sector_f14, r.tipo_costo_gasto_f14
       FROM retencion r
       JOIN contraparte c ON c.id = r.contraparte_id
       WHERE r.estado = 'registrada' AND r.tipo = 'efectuada'
         AND r.fecha_operacion >= ? AND r.fecha_operacion <= ?
       ORDER BY r.fecha_operacion, r.id`
    )
    .all(`${mes}-01`, `${mes}-31`) as RetencionF14[];
}

function faltantesRetencion(db: Database, r: RetencionF14, mes: string): string[] {
  const faltantes: string[] = [];
  if (!/^[0-9]$/.test(r.domiciliado ?? '')) {
    faltantes.push('domiciliado de un dígito (columna A)');
  }
  if (!/^\d{4}$/.test(r.codigo_pais ?? '')) {
    faltantes.push('código de país de 4 dígitos (columna B)');
  }
  if (!/^\d{14}$/.test(r.nit_nif ?? '') && !/^\d{9}$/.test(r.dui ?? '')) {
    faltantes.push('NIT/NIF (14) o DUI (9) del sujeto retenido (columnas D/E)');
  }
  if (!/^\d{2}$/.test(r.codigo_ingreso ?? '')) {
    faltantes.push('código de ingreso de 2 dígitos del apéndice (columna F)');
  }
  if (mes >= '2024-02') {
    if (!CATALOGO_S_F14.has(r.tipo_operacion_f14 ?? '')) {
      faltantes.push('tipo de operación del catálogo 1-2 o 9 por nota 9 (columna S)');
    }
    if (!CATALOGO_T_F14.has(r.clasificacion_f14 ?? '')) {
      faltantes.push('clasificación del catálogo 1-2 o 9 por nota 9 (columna T)');
    }
    if (!CATALOGO_UV_F14.test(r.sector_f14 ?? '')) {
      faltantes.push('sector de un dígito (columna U)');
    }
    if (!CATALOGO_UV_F14.test(r.tipo_costo_gasto_f14 ?? '')) {
      faltantes.push('tipo de costo/gasto de un dígito (columna V)');
    }
  }
  const vigencia = db
    .prepare('SELECT id FROM vigencia_fiscal WHERE inscrito_iva = 1 AND desde <= ? AND (hasta IS NULL OR hasta >= ?)')
    .get(r.fecha, r.fecha) as { id: number } | undefined;
  if (!vigencia) {
    faltantes.push('cobertura de vigencia con IVA inscrito para la fecha de la retención (activación formal)');
  }
  return faltantes;
}

export function diagnosticarAnexoRetencionesF14(db: Database, mes: string) {
  if (!/^\d{4}-\d{2}$/.test(mes)) {
    throw new ErrorF14(`Mes inválido (AAAA-MM): ${mes}`);
  }
  const retenciones = retencionesDelMes(db, mes);
  const folios: Array<{ folio: string; documentoId: number; faltantes: string[] }> = [];
  const listos: string[] = [];
  for (const r of retenciones) {
    const f = faltantesRetencion(db, r, mes);
    if (f.length > 0) {
      folios.push({ folio: r.folio, documentoId: r.id, faltantes: f });
    } else {
      listos.push(r.folio);
    }
  }
  return {
    version: 'anexo-f14-v16-esquema1',
    mes,
    folios,
    listos,
    bloqueado: folios.length > 0,
    motivo: folios.length > 0
      ? 'Hay retenciones efectuadas con metadatos F-14 incompletos o sin cobertura de vigencia; el anexo de presentación permanece bloqueado hasta la activación formal'
      : '',
    fuente: FUENTE_OFICIAL_F14
  };
}

function escaparCampoF14(valor: string): string {
  if (/[";\n\r]/.test(valor)) {
    return `"${valor.replace(/"/g, '""')}"`;
  }
  return valor;
}

function fechaMmYyyy(iso: string): string {
  return `${iso.slice(5, 7)}${iso.slice(0, 4)}`;
}

export function exportarAnexoRetencionesF14Presentacion(db: Database, mes: string) {
  const diagnostico = diagnosticarAnexoRetencionesF14(db, mes);
  if (diagnostico.bloqueado) {
    const detalle = diagnostico.folios.map(f => `${f.folio}: ${f.faltantes.join(', ')}`).join('; ');
    throw new ErrorF14(`El anexo F-14 de presentación está bloqueado. ${diagnostico.motivo}. Faltantes: ${detalle}`);
  }
  const retenciones = retencionesDelMes(db, mes);
  const aplicaStuv = mes >= '2024-02';
  const lineas: string[] = [];
  for (const r of retenciones) {
    const revalidacion = faltantesRetencion(db, r, mes);
    if (revalidacion.length > 0) {
      throw new ErrorF14(`El folio ${r.folio} dejó de ser válido al exportar: ${revalidacion.join(', ')}`);
    }
    const fila = [
      r.domiciliado ?? '',
      r.codigo_pais ?? '',
      r.nombre.toUpperCase(),
      r.nit_nif ?? '',
      r.dui ?? '',
      r.codigo_ingreso ?? '',
      minorATexto(BigInt(r.base_minor)),
      '0.00',
      minorATexto(BigInt(r.monto_minor)),
      '0.00',
      '0.00',
      '0.00',
      '0.00',
      '0.00',
      '0.00',
      '0.00',
      '0.00',
      '0.00',
      aplicaStuv ? r.tipo_operacion_f14 ?? '' : '0',
      aplicaStuv ? r.clasificacion_f14 ?? '' : '0',
      aplicaStuv ? r.sector_f14 ?? '' : '0',
      aplicaStuv ? r.tipo_costo_gasto_f14 ?? '' : '0',
      fechaMmYyyy(r.fecha)
    ];
    if (fila.length !== 23) {
      throw new ErrorF14(`Fila con columnas incorrectas para ${r.folio}`);
    }
    for (let i = 0; i < fila.length; i++) {
      if (String(fila[i]).length > (LIMITES_F14[i] ?? Infinity)) {
        throw new ErrorF14(`Columna ${i + 1} excede el límite del manual F-14 para ${r.folio}`);
      }
    }
    lineas.push(fila.map(c => escaparCampoF14(String(c))).join(';'));
  }
  return {
    csv: lineas.join('\\n'),
    version: 'anexo-f14-v16-esquema1',
    mes,
    filas: lineas.length,
    fuente: FUENTE_OFICIAL_F14
  };
}
