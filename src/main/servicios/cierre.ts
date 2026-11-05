import type BetterSqlite3 from 'better-sqlite3';
type Database = BetterSqlite3.Database;
import { validarFechaCalendario } from '../../shared/fechas';
import { minorATexto } from '../../shared/dinero';
import {
  contabilizarAsiento,
  periodoDeFecha,
  cerrarPeriodo,
  reabrirPeriodo,
  ErrorContable
} from './motorAsientos';
import { registroEvento } from './bitacora';

export class ErrorCierre extends Error {}

export interface EntradaApertura {
  fechaOperacion: string;
  concepto: string;
  referencia: string;
  lineas: Array<{ cuentaCodigo: string; debeMinor: string; haberMinor: string }>;
  claveIdempotencia: string;
  responsable: string;
}

export function registrarApertura(
  db: BetterSqlite3.Database,
  entrada: EntradaApertura
): { id: number; folio: string; duplicado: boolean; estado: string } {
  if (!entrada.referencia?.trim()) {
    throw new ErrorCierre('La apertura exige referencia de soporte');
  }
  const previo = db
    .prepare('SELECT id, folio FROM asiento WHERE clave_idempotencia = ?')
    .get(`${entrada.claveIdempotencia}:apertura`) as { id: number; folio: string } | undefined;
  if (previo) {
    return { id: previo.id, folio: previo.folio, duplicado: true, estado: 'contabilizado' };
  }
  const lineasAsiento = entrada.lineas.map(l => {
    const cuenta = db
      .prepare('SELECT id FROM cuenta WHERE codigo = ? AND es_grupo = 0 AND activa = 1')
      .get(l.cuentaCodigo) as { id: number } | undefined;
    if (!cuenta) {
      throw new ErrorCierre(`Cuenta inválida o inactiva para apertura: ${l.cuentaCodigo}`);
    }
    return { cuentaId: cuenta.id, debeMinor: l.debeMinor || '', haberMinor: l.haberMinor || '' };
  });
  const asiento = contabilizarAsiento(db, {
    fechaOperacion: entrada.fechaOperacion,
    concepto: entrada.concepto,
    lineas: lineasAsiento,
    origenTipo: 'apertura',
    origenId: entrada.claveIdempotencia,
    claveIdempotencia: `${entrada.claveIdempotencia}:apertura`,
    responsable: entrada.responsable,
    ambitoId: 'administrativo'
  });
  db.prepare('UPDATE asiento SET motivo = ? WHERE id = ?').run(entrada.referencia.trim(), asiento.asientoId);
  registroEvento(db, entrada.responsable, 'apertura_registrada', 'asiento', String(asiento.asientoId), {
    folio: asiento.folio,
    concepto: entrada.concepto,
    referencia: entrada.referencia
  });
  return { id: asiento.asientoId, folio: asiento.folio, duplicado: false, estado: 'contabilizado' };
}

interface SaldoCuentaResultado {
  codigo: string;
  nombre: string;
  tipo: string;
  saldoMinor: string;
}

function saldosResultado(db: BetterSqlite3.Database, desde: string, hasta: string): Array<{ codigo: string; nombre: string; tipo: string; saldo: number }> {
  return db
    .prepare(
      `SELECT c.codigo, c.nombre, c.tipo,
              COALESCE(SUM(l.haber_minor - l.debe_minor), 0) AS saldo
       FROM asiento_linea l
       JOIN asiento a ON a.id = l.asiento_id AND a.estado = 'contabilizado'
       JOIN cuenta c ON c.id = l.cuenta_id
       WHERE c.tipo IN ('ingreso','costo','gasto')
         AND a.fecha_operacion >= ? AND a.fecha_operacion <= ?
       GROUP BY c.id
       HAVING saldo <> 0
       ORDER BY c.codigo`
    )
    .all(desde, hasta) as Array<{ codigo: string; nombre: string; tipo: string; saldo: number }>;
}

export interface EstadoEjercicio {
  anio: number;
  periodos: Array<{ id: number; inicio: string; fin: string; estado: string }>;
  cuentasResultado: SaldoCuentaResultado[];
  resultadoNetoMinor: string;
  cierreExistente: { id: number; folio: string; fecha: string } | null;
  periodoDiciembreAbierto: boolean;
}

export function estadoEjercicio(db: BetterSqlite3.Database, anio: number): EstadoEjercicio {
  if (!Number.isInteger(anio) || anio < 1900 || anio > 2999) {
    throw new ErrorCierre(`Año fuera de rango: ${anio}`);
  }
  const desde = `${anio}-01-01`;
  const hasta = `${anio}-12-31`;
  const periodos = db
    .prepare('SELECT id, inicio, fin, estado FROM periodo WHERE inicio >= ? AND fin <= ? ORDER BY inicio')
    .all(desde, hasta) as Array<{ id: number; inicio: string; fin: string; estado: string }>;
  const filas = saldosResultado(db, desde, hasta);
  let neto = 0n;
  const cuentasResultado = filas.map(f => {
    neto += BigInt(f.saldo);
    return { codigo: f.codigo, nombre: f.nombre, tipo: f.tipo, saldoMinor: minorATexto(BigInt(f.saldo)) };
  });
  const cierre = db
    .prepare(
      `SELECT id, folio, fecha_operacion AS fecha FROM asiento
       WHERE origen_tipo = 'cierre' AND fecha_operacion >= ? AND fecha_operacion <= ? AND estado = 'contabilizado'
       ORDER BY id LIMIT 1`
    )
    .get(desde, hasta) as { id: number; folio: string; fecha: string } | undefined;
  const diciembre = periodos.find(p => p.inicio.slice(0, 4) === String(anio) && p.inicio.slice(5, 7) === '12');
  return {
    anio,
    periodos,
    cuentasResultado,
    resultadoNetoMinor: minorATexto(neto),
    cierreExistente: cierre ?? null,
    periodoDiciembreAbierto: diciembre?.estado === 'abierto'
  };
}

export interface EntradaCierre {
  anio: number;
  responsable: string;
  motivo: string;
  referencia: string;
  claveIdempotencia: string;
  cuentaResultadoCodigo?: string;
}

export function cerrarEjercicio(
  db: BetterSqlite3.Database,
  entrada: EntradaCierre
): { id: number; folio: string; duplicado: boolean; periodoId: number; netoMinor: string } {
  if (!entrada.responsable?.trim()) {
    throw new ErrorCierre('El cierre exige responsable');
  }
  if (!entrada.motivo?.trim()) {
    throw new ErrorCierre('El cierre exige motivo');
  }
  if (!entrada.referencia?.trim()) {
    throw new ErrorCierre('El cierre exige referencia de soporte');
  }
  const anio = entrada.anio;
  if (!Number.isInteger(anio) || anio < 1900 || anio > 2999) {
    throw new ErrorCierre(`Año fuera de rango: ${anio}`);
  }
  const fechaCierre = `${anio}-12-31`;
  validarFechaCalendario(fechaCierre);
  const previo = db
    .prepare('SELECT id, folio FROM asiento WHERE clave_idempotencia = ?')
    .get(`${entrada.claveIdempotencia}:cierre`) as { id: number; folio: string } | undefined;
  if (previo) {
    return { id: previo.id, folio: previo.folio, duplicado: true, periodoId: 0, netoMinor: '0.00' };
  }
  const yaCerrado = db
    .prepare(
      `SELECT id FROM asiento
       WHERE origen_tipo = 'cierre' AND fecha_operacion >= ? AND fecha_operacion <= ? AND estado = 'contabilizado'`
    )
    .get(`${anio}-01-01`, fechaCierre) as { id: number } | undefined;
  if (yaCerrado) {
    throw new ErrorCierre(`El ejercicio ${anio} ya tiene asiento de cierre`);
  }
  const saldos = saldosResultado(db, `${anio}-01-01`, fechaCierre);
  if (saldos.length === 0) {
    throw new ErrorCierre(`El ejercicio ${anio} no tiene movimientos en cuentas de resultados`);
  }
  const periodo = periodoDeFecha(db, fechaCierre);
  if (periodo.estado !== 'abierto') {
    throw new ErrorCierre(`El período de diciembre ${anio} está cerrado; reábrelo antes de cerrar el ejercicio`);
  }
  const codigoResultado = entrada.cuentaResultadoCodigo?.trim() || '3201';
  const cuentaResultado = db
    .prepare('SELECT id, nombre FROM cuenta WHERE codigo = ? AND es_grupo = 0 AND activa = 1')
    .get(codigoResultado) as { id: number; nombre: string } | undefined;
  if (!cuentaResultado) {
    throw new ErrorCierre(`Cuenta de resultados inválida o inactiva: ${codigoResultado}`);
  }
  const lineas: Array<{ cuentaId: number; debeMinor: string; haberMinor: string }> = [];
  let neto = 0n;
  for (const f of saldos) {
    const cuenta = db
      .prepare('SELECT id FROM cuenta WHERE codigo = ? AND es_grupo = 0 AND activa = 1')
      .get(f.codigo) as { id: number } | undefined;
    if (!cuenta) {
      throw new ErrorCierre(`Cuenta de resultados inválida o inactiva: ${f.codigo}`);
    }
    const saldo = BigInt(f.saldo);
    neto += saldo;
    if (saldo > 0n) {
      lineas.push({ cuentaId: cuenta.id, debeMinor: minorATexto(saldo), haberMinor: '' });
    } else if (saldo < 0n) {
      lineas.push({ cuentaId: cuenta.id, debeMinor: '', haberMinor: minorATexto(-saldo) });
    }
  }
  if (neto > 0n) {
    lineas.push({ cuentaId: cuentaResultado.id, debeMinor: '', haberMinor: minorATexto(neto) });
  } else if (neto < 0n) {
    lineas.push({ cuentaId: cuentaResultado.id, debeMinor: minorATexto(-neto), haberMinor: '' });
  }
  const asiento = contabilizarAsiento(db, {
    fechaOperacion: fechaCierre,
    concepto: `Cierre del ejercicio ${anio}`,
    lineas,
    origenTipo: 'cierre',
    origenId: entrada.claveIdempotencia,
    claveIdempotencia: `${entrada.claveIdempotencia}:cierre`,
    responsable: entrada.responsable,
    ambitoId: 'administrativo'
  });
  db.prepare('UPDATE asiento SET motivo = ? WHERE id = ?').run(entrada.referencia.trim(), asiento.asientoId);
  cerrarPeriodo(db, periodo.id, entrada.responsable, `Cierre del ejercicio ${anio}: ${entrada.motivo}`);
  registroEvento(db, entrada.responsable, 'cierre_ejercicio', 'ejercicio', String(anio), {
    folio: asiento.folio,
    neto: minorATexto(neto),
    referencia: entrada.referencia,
    motivo: entrada.motivo
  });
  return {
    id: asiento.asientoId,
    folio: asiento.folio,
    duplicado: false,
    periodoId: periodo.id,
    netoMinor: minorATexto(neto)
  };
}

export function reabrirEjercicio(
  db: BetterSqlite3.Database,
  entrada: { anio: number; responsable: string; motivo: string }
): { periodoId: number } {
  if (!entrada.responsable?.trim()) {
    throw new ErrorCierre('La reapertura exige responsable');
  }
  if (!entrada.motivo?.trim()) {
    throw new ErrorCierre('La reapertura exige motivo');
  }
  const anio = entrada.anio;
  if (!Number.isInteger(anio) || anio < 1900 || anio > 2999) {
    throw new ErrorCierre(`Año fuera de rango: ${anio}`);
  }
  const fechaDiciembre = `${anio}-12-31`;
  validarFechaCalendario(fechaDiciembre);
  const periodo = periodoDeFecha(db, fechaDiciembre);
  reabrirPeriodo(db, periodo.id, entrada.responsable, `Reapertura del ejercicio ${anio}: ${entrada.motivo}`);
  registroEvento(db, entrada.responsable, 'reapertura_ejercicio', 'ejercicio', String(anio), {
    periodoId: periodo.id,
    motivo: entrada.motivo
  });
  return { periodoId: periodo.id };
}

export { ErrorContable };
