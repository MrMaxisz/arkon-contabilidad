import type BetterSqlite3 from 'better-sqlite3';
type Database = BetterSqlite3.Database;
import { validarFechaCalendario } from '../../shared/fechas';
import { minorATexto } from '../../shared/dinero';
import { escaparCsv } from './fiscal';
import { SQL_FAMILIA_CIERRE_EXCLUIDA } from './familiaCierre';

export class ErrorEjercicio extends Error {}

export const FUENTE_EJERCICIO_ANUAL =
  'Soporte INTERNO de ejercicio anual para el contador (guía oficial F-11 700-DGII-GA-2018-20288 como referencia de renta en línea; NO es esquema CSV oficial ni confirma tasas). ARKON administrativa: sin deducibilidad ni impuesto determinado.';

export interface InformeEjercicio {
  version: string;
  anio: number;
  generadoEn: string;
  resultadoOrdinarioMinor: string;
  resultadoConCierreMinor: string;
  ingresosMinor: string;
  costosGastosMinor: string;
  retencionesEfectuadasMinor: string;
  retencionesRecibidasMinor: string;
  conciliacionMayor: { diferenciaMinor: string; concilia: boolean };
  cuentas: Array<{ codigo: string; nombre: string; tipo: string; movimientoMinor: string; saldoAcumuladoMinor: string }>;
  asientos: Array<{ folio: string; fecha: string; concepto: string; estado: string; origen: string; totalMinor: string; familiaCierre: boolean }>;
  retenciones: Array<{ folio: string; fecha: string; contraparte: string; baseMinor: string; montoMinor: string; tipo: string }>;
  limitaciones: string[];
}

export function consultarEjercicio(db: Database, anio: number): InformeEjercicio {
  if (!Number.isInteger(anio) || anio < 1900 || anio > 2999) {
    throw new ErrorEjercicio(`Año fuera de rango: ${anio}`);
  }
  validarFechaCalendario(`${anio}-01-01`);
  const desde = `${anio}-01-01`;
  const hasta = `${anio}-12-31`;

  // Movimientos del ejercicio por cuenta, EXCLUYENDO el asiento de cierre de los ordinararios
  // (el cierre traslada resultados a 3201; contarlo como ingreso/gasto duplicaría el resultado).
  // Anulados y sus reversos se incluyen ambos: el original anulado con estado 'anulado' y su
  // reverso contabilizado se cancelan mutuamente en el neto, sin duplicar.
  const filasCuentas = db
    .prepare(
      `SELECT c.codigo, c.nombre, c.tipo,
              COALESCE(SUM(CASE WHEN a.fecha_operacion >= ? AND a.fecha_operacion <= ?
                AND ${SQL_FAMILIA_CIERRE_EXCLUIDA} THEN l.haber_minor - l.debe_minor ELSE 0 END), 0) AS movimiento,
              COALESCE(SUM(CASE WHEN a.fecha_operacion >= ? AND a.fecha_operacion <= ? THEN l.haber_minor - l.debe_minor ELSE 0 END), 0) AS movimientoConCierre,
              COALESCE(SUM(CASE WHEN a.fecha_operacion <= ? THEN l.debe_minor - l.haber_minor ELSE 0 END), 0) AS saldoAcumulado
       FROM cuenta c
       LEFT JOIN asiento_linea l ON l.cuenta_id = c.id
       LEFT JOIN asiento a ON a.id = l.asiento_id AND a.estado IN ('contabilizado','anulado')
       WHERE c.es_grupo = 0
       GROUP BY c.id, c.codigo, c.nombre, c.tipo
       ORDER BY c.codigo`
    )
    .all(desde, hasta, desde, hasta, hasta) as Array<{ codigo: string; nombre: string; tipo: string; movimiento: number; movimientoConCierre: number; saldoAcumulado: number }>;

  let ingresos = 0n;
  let costosGastos = 0n;
  let resultadoConCierre = 0n;
  for (const f of filasCuentas) {
    const mov = BigInt(f.movimiento);
    const movConCierre = BigInt(f.movimientoConCierre);
    if (f.tipo === 'ingreso') {
      ingresos += mov;
      resultadoConCierre += movConCierre;
    } else if (f.tipo === 'costo' || f.tipo === 'gasto') {
      costosGastos += mov;
      resultadoConCierre += movConCierre;
    }
  }
  const resultadoOrdinario = ingresos + costosGastos;

  // Conciliación INDEPENDIENTE: resultado anual calculado directamente del mayor con otra consulta
  // (asientos del año sin cierre, estados contabilizado/anulado, signo haber-debe por tipo de cuenta).
  const mayorIndependiente = db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN c.tipo = 'ingreso' THEN l.haber_minor - l.debe_minor
                                 WHEN c.tipo IN ('costo','gasto') THEN l.haber_minor - l.debe_minor
                                 ELSE 0 END), 0) AS resultado
       FROM asiento_linea l
       JOIN asiento a ON a.id = l.asiento_id AND a.estado IN ('contabilizado','anulado')
         AND a.fecha_operacion >= ? AND a.fecha_operacion <= ?
         AND ${SQL_FAMILIA_CIERRE_EXCLUIDA}
       JOIN cuenta c ON c.id = l.cuenta_id AND c.tipo IN ('ingreso','costo','gasto')`
    )
    .get(desde, hasta) as { resultado: number };
  const diferencia = resultadoOrdinario - BigInt(mayorIndependiente.resultado);

  const asientos = db
    .prepare(
      `SELECT a.folio, a.fecha_operacion AS fecha, a.concepto, a.estado, COALESCE(a.origen_tipo, '') AS origen,
              COALESCE((SELECT SUM(l.debe_minor) FROM asiento_linea l WHERE l.asiento_id = a.id), 0) AS total,
              CASE WHEN a.origen_tipo = 'cierre' OR EXISTS (
                SELECT 1 FROM asiento o WHERE o.id = a.reverso_de_id AND o.origen_tipo = 'cierre'
              ) THEN 1 ELSE 0 END AS familia_cierre
       FROM asiento a
       WHERE a.fecha_operacion >= ? AND a.fecha_operacion <= ?
       ORDER BY a.fecha_operacion, a.id`
    )
    .all(desde, hasta) as Array<{ folio: string; fecha: string; concepto: string; estado: string; origen: string; total: number; familia_cierre: number }>;

  const retenciones = db
    .prepare(
      `SELECT r.folio, r.fecha_operacion AS fecha, c.nombre AS contraparte, r.base_minor, r.monto_minor, r.tipo
       FROM retencion r JOIN contraparte c ON c.id = r.contraparte_id
       WHERE r.estado = 'registrada' AND r.fecha_operacion >= ? AND r.fecha_operacion <= ?
       ORDER BY r.fecha_operacion, r.id`
    )
    .all(desde, hasta) as Array<{ folio: string; fecha: string; contraparte: string; base_minor: number; monto_minor: number; tipo: string }>;

  let retEfectuadas = 0n;
  let retRecibidas = 0n;
  for (const r of retenciones) {
    if (r.tipo === 'efectuada') {
      retEfectuadas += BigInt(r.monto_minor);
    } else {
      retRecibidas += BigInt(r.monto_minor);
    }
  }

  const limitaciones = [
    'Soporte INTERNO de trabajo para el contador; NO es declaración F-11 ni anexo oficial.',
    'ARKON Ingeniería Eléctrica no está constituida ni inscrita: sin determinación de deducibilidad ni impuesto.',
    'La clasificación fiscal de cada operación y las tasas vigentes quedan como decisiones del contador; ningún valor desconocido se convirtió en 0 ni se inventó tasa.',
    'El asiento de cierre del ejercicio se excluye del resultado ordinario para no duplicar; su efecto está en el resultado con cierre y en los saldos acumulados.',
    'Anulaciones y reversos se presentan por su efecto neto (original anulado + reverso contabilizado).'
  ];

  return {
    version: 'ejercicio-anual-interno-v1',
    anio,
    generadoEn: new Date().toISOString(),
    resultadoOrdinarioMinor: minorATexto(resultadoOrdinario),
    resultadoConCierreMinor: minorATexto(resultadoConCierre),
    ingresosMinor: minorATexto(ingresos),
    costosGastosMinor: minorATexto(costosGastos),
    retencionesEfectuadasMinor: minorATexto(retEfectuadas),
    retencionesRecibidasMinor: minorATexto(retRecibidas),
    conciliacionMayor: { diferenciaMinor: minorATexto(diferencia), concilia: diferencia === 0n },
    cuentas: filasCuentas.map(f => ({
      codigo: f.codigo,
      nombre: f.nombre,
      tipo: f.tipo,
      movimientoMinor: minorATexto(BigInt(f.movimiento)),
      saldoAcumuladoMinor: minorATexto(BigInt(f.saldoAcumulado))
    })),
    asientos: asientos.map(a => ({
      folio: a.folio,
      fecha: a.fecha,
      concepto: a.concepto,
      estado: a.estado,
      origen: a.origen,
      totalMinor: minorATexto(BigInt(a.total)),
      familiaCierre: a.familia_cierre === 1
    })),
    retenciones: retenciones.map(r => ({
      folio: r.folio,
      fecha: r.fecha,
      contraparte: r.contraparte,
      baseMinor: minorATexto(BigInt(r.base_minor)),
      montoMinor: minorATexto(BigInt(r.monto_minor)),
      tipo: r.tipo
    })),
    limitaciones
  };
}

export function csvEjercicio(informe: InformeEjercicio): Array<{ nombre: string; contenido: string }> {
  const archivos: Array<{ nombre: string; contenido: string }> = [];
  const leeme = [
    `SOPORTE INTERNO DE EJERCICIO ${informe.anio} — ARKON CONTABILIDAD`,
    `Versión: ${informe.version}`,
    `Generado: ${informe.generadoEn}`,
    `Resultado ordinario: ${informe.resultadoOrdinarioMinor} (con cierre: ${informe.resultadoConCierreMinor})`,
    `Ingresos: ${informe.ingresosMinor} · Costos y gastos: ${informe.costosGastosMinor}`,
    `Retenciones efectuadas: ${informe.retencionesEfectuadasMinor} · recibidas: ${informe.retencionesRecibidasMinor}`,
    `Conciliación con mayor: ${informe.conciliacionMayor.concilia ? 'OK' : `DESCUADRE ${informe.conciliacionMayor.diferenciaMinor}`}`,
    '',
    'Límites:',
    ...informe.limitaciones.map(l => `- ${l}`),
    '',
    `Fuente: ${FUENTE_EJERCICIO_ANUAL}`
  ].join('\n');
  archivos.push({ nombre: 'LEEME.txt', contenido: leeme });

  const lineasCuentas = ['codigo,nombre,tipo,movimiento_ejercicio,saldo_acumulado'];
  for (const c of informe.cuentas) {
    lineasCuentas.push(`${escaparCsv(c.codigo)},${escaparCsv(c.nombre)},${c.tipo},${c.movimientoMinor},${c.saldoAcumuladoMinor}`);
  }
  archivos.push({ nombre: 'cuentas-ejercicio.csv', contenido: lineasCuentas.join('\n') });

  const lineasAsientos = ['folio,fecha,concepto,estado,origen,total'];
  for (const a of informe.asientos) {
    lineasAsientos.push(`${escaparCsv(a.folio)},${a.fecha},${escaparCsv(a.concepto)},${a.estado},${escaparCsv(a.origen)},${a.totalMinor}`);
  }
  archivos.push({ nombre: 'asientos-ejercicio.csv', contenido: lineasAsientos.join('\n') });

  const lineasRet = ['folio,fecha,contraparte,base,retencion,tipo'];
  for (const r of informe.retenciones) {
    lineasRet.push(`${escaparCsv(r.folio)},${r.fecha},${escaparCsv(r.contraparte)},${r.baseMinor},${r.montoMinor},${r.tipo}`);
  }
  archivos.push({ nombre: 'retenciones-ejercicio.csv', contenido: lineasRet.join('\n') });
  return archivos;
}
