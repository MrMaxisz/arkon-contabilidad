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

// Catálogos del manual F-14 v16 (páginas 5-6), verificados visualmente contra el PDF oficial:
// S: 1 Gravada, 2 No Gravada, 3 Excluido/No Constituye Renta, 4 Mixta.
// T: 1 Costo, 2 Gasto. U: 1 Industria, 2 Comercio, 3 Agro, 4 Servicios/Profesiones/Artes/Oficios.
// V: 1-7. Nota 9 (página 5): instituciones públicas, municipalidades, sujetos pasivos no inscritos
// en IVA y operaciones no deducibles completan S/T/U/V con 9 — los CUATRO campos en 9, sin mezclas.
const CATALOGO_S_F14 = new Set(['1', '2', '3', '4', '9']);
const CATALOGO_T_F14 = new Set(['1', '2', '9']);
const CATALOGO_U_F14 = new Set(['1', '2', '3', '4', '9']);
const CATALOGO_V_F14 = new Set(['1', '2', '3', '4', '5', '6', '7', '9']);
const DOMICILIADO_F14 = new Set(['1', '2']);

// Catálogo versionado de códigos de ingreso del F-14 v16 (APÉNDICE, páginas 17-18 del manual oficial).
// El apéndice es una tabla de imagen no extraíble como texto; este catálogo contiene los códigos
// verificados contra el manual y las reproducciones del auditor: 01 (servicios permanentes con
// subordinación — nota página 7), 42 (ordinario) y 47 (nota especial art. 123 inciso tercero, página 18).
// Cualquier código fuera del catálogo se rechaza como no verificado hasta ampliación documentada.
const CODIGOS_INGRESO_F14_V1 = new Set(['01', '42', '47']);
const CODIGOS_INGRESO_BLOQUEADOS_F14 = new Map<string, string>([
  ['01', 'servicios permanentes con subordinación o dependencia laboral: requiere captura de nómina (columnas J-R), sin soporte'],
  ['47', 'nota especial del art. 123 inciso tercero del Código Tributario (página 18): identidad particular no soportada']
]);

function errorCodigoIngresoF14(codigo: string): string | null {
  if (!CODIGOS_INGRESO_F14_V1.has(codigo)) {
    return `código de ingreso ${codigo} no verificado en el apéndice oficial del F-14 v16 (páginas 17-18); rechazado hasta ampliación documentada del catálogo`;
  }
  const bloqueado = CODIGOS_INGRESO_BLOQUEADOS_F14.get(codigo);
  if (bloqueado) {
    return `código de ingreso ${codigo}: ${bloqueado}`;
  }
  return null;
}

// Reglas de identidad del F-14 v16 (páginas 3-4): DUI solo para PERSONA NATURAL DOMICILIADA desde
// enero 2022; antes de 2022 el NIT/NIF es obligatorio y el DUI va vacío. NIF de no domiciliado:
// máximo 14 caracteres (formato extranjero), no se imponen 14 dígitos nacionales.
function errorIdentidadF14(fecha: string, domiciliado: string, personaNatural: boolean, nit: string, dui: string): string | null {
  const antesDe2022 = fecha < '2022-01-01';
  if (antesDe2022) {
    if (dui) {
      return 'para períodos anteriores a enero 2022 el DUI va vacío y el NIT/NIF es obligatorio';
    }
    if (!nit) {
      return 'para períodos anteriores a enero 2022 el NIT/NIF es obligatorio';
    }
    return null;
  }
  if (dui && (domiciliado !== '1' || !personaNatural)) {
    return 'el DUI solo corresponde a persona natural domiciliada a partir de enero 2022';
  }
  if (domiciliado === '1' && personaNatural) {
    if (dui && nit) {
      return 'identificación exclusiva: complete DUI (E) o NIT (D), no ambos';
    }
    if (!dui && !nit) {
      return 'persona natural domiciliada: complete DUI (9) o NIT (14)';
    }
    return null;
  }
  if (!nit) {
    return domiciliado === '1'
      ? 'persona jurídica domiciliada: el NIT (14 dígitos) es obligatorio y el DUI va vacío'
      : 'sujeto no domiciliado: el NIF (máximo 14 caracteres) es obligatorio y el DUI va vacío';
  }
  return null;
}

function nitDomiciliadoValido(nit: string): boolean {
  return /^\d{14}$/.test(nit);
}

function nifExtranjeroValido(nif: string): boolean {
  return nif.length > 0 && nif.length <= 14 && !/[-|]/.test(nif);
}

// Matriz conjunta F-14 v16 (página 6): T2 (gasto) → V 1-3 con cualquier U 1-4;
// T1 (costo) + U1 (industria) → V 4-7; T1 + U2/3/4 → V 4-5; para S 1-4.
function combinacionF14Valida(t: string, u: string, v: string): boolean {
  if (t === '2') {
    return ['1', '2', '3'].includes(v);
  }
  if (t === '1') {
    if (u === '1') {
      return ['4', '5', '6', '7'].includes(v);
    }
    return ['4', '5'].includes(v);
  }
  return false;
}

// Nota 9: los cuatro campos S/T/U/V van en 9 juntos, o ninguno.
function esNota9(s: string, t: string, u: string, v: string): boolean {
  return s === '9' && t === '9' && u === '9' && v === '9';
}

function errorSemanticoF14(s: string, t: string, u: string, v: string): string | null {
  const todosNueve = ['9', '9', '9', '9'];
  const valores = [s, t, u, v];
  const nueves = valores.filter(x => x === '9').length;
  if (nueves > 0 && nueves < 4) {
    return 'nota 9 del F-14: los cuatro campos S/T/U/V van en 9 juntos, sin mezclas';
  }
  if (esNota9(s, t, u, v)) {
    return null;
  }
  if (!combinacionF14Valida(t, u, v)) {
    return `combinación T=${t}/U=${u}/V=${v} no permitida por la matriz del manual F-14 v16 (página 6)`;
  }
  void todosNueve;
  return null;
}

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
  involucraNomina: boolean;
  personaNatural: boolean;
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
  if (!DOMICILIADO_F14.has(entrada.domiciliado)) {
    throw new ErrorF14('Domiciliado inválido: 1 (domiciliado) o 2 (no domiciliado) (columna A)');
  }
  if (!/^\d{4}$/.test(entrada.codigoPais)) {
    throw new ErrorF14('Código de país inválido: 4 dígitos (columna B)');
  }
  const nit = entrada.nitNif?.replace(/[-|]/g, '') ?? '';
  const dui = entrada.dui?.replace(/[-|]/g, '') ?? '';
  if (typeof entrada.personaNatural !== 'boolean') {
    throw new ErrorF14('Debe declararse si el sujeto retenido es persona natural (reglas DUI, páginas 3-4)');
  }
  if (nit && entrada.domiciliado === '1' && !nitDomiciliadoValido(nit)) {
    throw new ErrorF14('NIT de domiciliado inválido: 14 dígitos sin guiones (columna D)');
  }
  if (nit && entrada.domiciliado === '2' && !nifExtranjeroValido(nit)) {
    throw new ErrorF14('NIF de no domiciliado inválido: máximo 14 caracteres sin guiones ni pleca (columna D)');
  }
  if (dui && !/^\d{9}$/.test(dui)) {
    throw new ErrorF14('DUI inválido: 9 dígitos sin guiones (columna E)');
  }
  if (!/^\d{2}$/.test(entrada.codigoIngreso)) {
    throw new ErrorF14('Código de ingreso inválido: 2 dígitos del apéndice del F-14 (columna F)');
  }
  const errorCodigo = errorCodigoIngresoF14(entrada.codigoIngreso);
  if (errorCodigo) {
    throw new ErrorF14(errorCodigo);
  }
  if (!CATALOGO_S_F14.has(entrada.tipoOperacion)) {
    throw new ErrorF14('Tipo de operación inválido: catálogo 1-4 (o 9 por nota 9) (columna S)');
  }
  if (!CATALOGO_T_F14.has(entrada.clasificacion)) {
    throw new ErrorF14('Clasificación inválida: catálogo 1-2 (o 9 por nota 9) (columna T)');
  }
  if (!CATALOGO_U_F14.has(entrada.sector)) {
    throw new ErrorF14('Sector inválido: catálogo 1-4 (o 9 por nota 9) (columna U)');
  }
  if (!CATALOGO_V_F14.has(entrada.tipoCostoGasto)) {
    throw new ErrorF14('Tipo de costo/gasto inválido: catálogo 1-7 (o 9 por nota 9) (columna V)');
  }
  const errorSemantico = errorSemanticoF14(entrada.tipoOperacion, entrada.clasificacion, entrada.sector, entrada.tipoCostoGasto);
  if (errorSemantico) {
    throw new ErrorF14(errorSemantico);
  }
  if (typeof entrada.involucraNomina !== 'boolean') {
    throw new ErrorF14('Debe declararse si la retención involucra nómina (columnas J-R del F-14)');
  }
  const ret = db.prepare('SELECT id, folio, estado, fecha_operacion AS fecha FROM retencion WHERE id = ?').get(retencionId) as
    | { id: number; folio: string; estado: string; fecha: string }
    | undefined;
  if (!ret) {
    throw new ErrorF14(`Retención inexistente: ${retencionId}`);
  }
  if (ret.estado !== 'registrada') {
    throw new ErrorF14(`Solo se completan metadatos de retenciones registradas: ${ret.folio}`);
  }
  const errorIdentidad = errorIdentidadF14(ret.fecha, entrada.domiciliado, entrada.personaNatural, nit, dui);
  if (errorIdentidad) {
    throw new ErrorF14(errorIdentidad);
  }
  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE retencion SET domiciliado = ?, codigo_pais = ?, nit_nif = ?, dui = ?, codigo_ingreso = ?,
       tipo_operacion_f14 = ?, clasificacion_f14 = ?, sector_f14 = ?, tipo_costo_gasto_f14 = ?, involucra_nomina = ?,
       persona_natural = ?
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
      entrada.involucraNomina ? 1 : 0,
      entrada.personaNatural ? 1 : 0,
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
  involucra_nomina: number | null;
  persona_natural: number | null;
}

function retencionesDelMes(db: Database, mes: string): RetencionF14[] {
  validarFechaCalendario(`${mes}-01`);
  return db
    .prepare(
      `SELECT r.id, r.folio, r.fecha_operacion AS fecha, r.base_minor, r.monto_minor, c.nombre,
              r.domiciliado, r.codigo_pais, r.nit_nif, r.dui, r.codigo_ingreso,
              r.tipo_operacion_f14, r.clasificacion_f14, r.sector_f14, r.tipo_costo_gasto_f14, r.involucra_nomina, r.persona_natural
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
  if (!DOMICILIADO_F14.has(r.domiciliado ?? '')) {
    faltantes.push('domiciliado 1 (domiciliado) o 2 (no domiciliado) (columna A)');
  }
  if (!/^\d{4}$/.test(r.codigo_pais ?? '')) {
    faltantes.push('código de país de 4 dígitos (columna B)');
  }
  const errorIdentidad = errorIdentidadF14(r.fecha, r.domiciliado ?? '', r.persona_natural === 1, r.nit_nif ?? '', r.dui ?? '');
  if (errorIdentidad) {
    faltantes.push(errorIdentidad);
  }
  if ((r.nit_nif ?? '') && r.domiciliado === '1' && !nitDomiciliadoValido(r.nit_nif ?? '')) {
    faltantes.push('NIT de domiciliado: 14 dígitos sin guiones (columna D)');
  }
  if ((r.nit_nif ?? '') && r.domiciliado === '2' && !nifExtranjeroValido(r.nit_nif ?? '')) {
    faltantes.push('NIF de no domiciliado: máximo 14 caracteres (columna D)');
  }
  if (r.persona_natural === null) {
    faltantes.push('declaración de si el sujeto retenido es persona natural (reglas DUI, páginas 3-4)');
  }
  if (!/^\d{2}$/.test(r.codigo_ingreso ?? '')) {
    faltantes.push('código de ingreso de 2 dígitos del apéndice (columna F)');
  } else {
    const errorCodigo = errorCodigoIngresoF14(r.codigo_ingreso ?? '');
    if (errorCodigo) {
      faltantes.push(errorCodigo);
    }
  }
  if (mes >= '2024-02') {
    if (!CATALOGO_S_F14.has(r.tipo_operacion_f14 ?? '')) {
      faltantes.push('tipo de operación del catálogo 1-4 o 9 por nota 9 (columna S)');
    }
    if (!CATALOGO_T_F14.has(r.clasificacion_f14 ?? '')) {
      faltantes.push('clasificación del catálogo 1-2 o 9 por nota 9 (columna T)');
    }
    if (!CATALOGO_U_F14.has(r.sector_f14 ?? '')) {
      faltantes.push('sector del catálogo 1-4 o 9 por nota 9 (columna U)');
    }
    if (!CATALOGO_V_F14.has(r.tipo_costo_gasto_f14 ?? '')) {
      faltantes.push('tipo de costo/gasto del catálogo 1-7 o 9 por nota 9 (columna V)');
    }
    const semantico = errorSemanticoF14(
      r.tipo_operacion_f14 ?? '',
      r.clasificacion_f14 ?? '',
      r.sector_f14 ?? '',
      r.tipo_costo_gasto_f14 ?? ''
    );
    if (semantico) {
      faltantes.push(semantico);
    }
  }
  if (r.involucra_nomina === null) {
    faltantes.push('declaración de si la retención involucra nómina (columnas J-R del F-14)');
  } else if (r.involucra_nomina === 1) {
    faltantes.push('retención sobre nómina: el sistema no captura aguinaldos ni deducciones de seguridad social (columnas J-R); bloqueada hasta que exista soporte de nómina');
  }
  const vigencia = db
    .prepare('SELECT id FROM vigencia_fiscal WHERE obligacion_f14 = 1 AND desde <= ? AND (hasta IS NULL OR hasta >= ?)')
    .get(r.fecha, r.fecha) as { id: number } | undefined;
  if (!vigencia) {
    faltantes.push('autorización de obligación F-14 (vigencia con obligacion_f14) para la fecha de la retención; la presentación permanece bloqueada hasta la configuración profesional explícita');
  }
  return faltantes;
}

export function leerMetadatosRetencion(db: Database, retencionId: number) {
  const fila = db
    .prepare(
      `SELECT r.id, r.folio, r.fecha_operacion AS fecha, c.nombre AS contraparte,
              r.domiciliado, r.codigo_pais, r.nit_nif, r.dui, r.codigo_ingreso,
              r.tipo_operacion_f14, r.clasificacion_f14, r.sector_f14, r.tipo_costo_gasto_f14,
              r.involucra_nomina, r.persona_natural
       FROM retencion r JOIN contraparte c ON c.id = r.contraparte_id
       WHERE r.id = ?`
    )
    .get(retencionId) as Record<string, unknown> | undefined;
  if (!fila) {
    throw new ErrorF14(`Retención inexistente: ${retencionId}`);
  }
  return fila;
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
    if (r.involucra_nomina !== 0) {
      throw new ErrorF14(`El folio ${r.folio} involucra nómina sin captura; las columnas J-R no pueden exportarse en 0.00`);
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
    csv: lineas.join('\n'),
    version: 'anexo-f14-v16-esquema1',
    mes,
    filas: lineas.length,
    fuente: FUENTE_OFICIAL_F14
  };
}
