import type Database from 'better-sqlite3';
import { parseMontoMinor, minorATexto } from '../../shared/dinero';
import { validarFechaCalendario, fechaDentroDePeriodo } from '../../shared/fechas';
import type {
  EntradaAsiento,
  ResultadoContabilizacion,
  AsientoResumen,
  EstadoPeriodo
} from '../../shared/tipos';
import { registroEvento } from './bitacora';

export class ErrorContable extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'ErrorContable';
  }
}

interface FilaCuenta {
  id: number;
  codigo: string;
  nombre: string;
  es_grupo: number;
  activa: number;
}

export interface PeriodoInfo {
  id: number;
  estado: EstadoPeriodo;
  inicio: string;
  fin: string;
}

function estadoCierreEjercicio(db: Database.Database, ambitoId: string, anio: number): string | undefined {
  const tabla = db
    .prepare("SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = 'cierre_ejercicio'")
    .get() as { x: number } | undefined;
  if (!tabla) {
    return undefined;
  }
  return (db
    .prepare('SELECT estado FROM cierre_ejercicio WHERE ambito_id = ? AND anio = ?')
    .get(ambitoId, anio) as { estado: string } | undefined)?.estado;
}

export function periodoDeFecha(db: Database.Database, fecha: string): PeriodoInfo {
  const mes = fecha.slice(0, 7);
  const inicio = `${mes}-01`;
  const fin = finDeMes(mes);
  const existente = db
    .prepare('SELECT id, estado, inicio, fin FROM periodo WHERE inicio = ? AND fin = ?')
    .get(inicio, fin) as PeriodoInfo | undefined;
  if (existente) {
    return existente;
  }
  const info = db.prepare('INSERT INTO periodo (inicio, fin) VALUES (?, ?)').run(inicio, fin);
  return { id: Number(info.lastInsertRowid), estado: 'abierto', inicio, fin };
}

function finDeMes(mes: string): string {
  const partes = mes.split('-').map(Number);
  const anio = partes[0];
  const mesNum = partes[1];
  if (!anio || !mesNum) {
    throw new ErrorContable(`Fecha fuera de rango: ${mes}`);
  }
  const fin = new Date(Date.UTC(anio, mesNum, 0));
  return fin.toISOString().slice(0, 10);
}

function validarFecha(fecha: string): void {
  validarFechaCalendario(fecha);
}

function validarLineas(db: Database.Database, lineas: EntradaAsiento['lineas']): Array<{ cuentaId: number; debe: bigint; haber: bigint }> {
  if (!Array.isArray(lineas) || lineas.length < 2) {
    throw new ErrorContable('Un asiento requiere al menos dos líneas');
  }
  let totalDebe = 0n;
  let totalHaber = 0n;
  const normalizadas = lineas.map(linea => {
    if (!Number.isInteger(linea.cuentaId) || linea.cuentaId <= 0) {
      throw new ErrorContable('Cuenta inválida en línea');
    }
    const debe = linea.debeMinor ? parseMontoMinor(linea.debeMinor) : 0n;
    const haber = linea.haberMinor ? parseMontoMinor(linea.haberMinor) : 0n;
    if (debe < 0n || haber < 0n) {
      throw new ErrorContable('Importes negativos no permitidos');
    }
    if (debe > 0n && haber > 0n) {
      throw new ErrorContable('Cada línea lleva importe en un solo lado');
    }
    if (debe === 0n && haber === 0n) {
      throw new ErrorContable('Línea sin importe');
    }
    totalDebe += debe;
    totalHaber += haber;
    return { cuentaId: linea.cuentaId, debe, haber };
  });
  if (totalDebe !== totalHaber) {
    throw new ErrorContable(
      `Asiento descuadrado: debe ${minorATexto(totalDebe)} != haber ${minorATexto(totalHaber)}`
    );
  }
  if (totalDebe === 0n) {
    throw new ErrorContable('Asiento sin importes');
  }
  for (const linea of normalizadas) {
    const cuenta = db
      .prepare('SELECT id, codigo, nombre, es_grupo, activa FROM cuenta WHERE id = ?')
      .get(linea.cuentaId) as FilaCuenta | undefined;
    if (!cuenta) {
      throw new ErrorContable(`No existe la cuenta ${linea.cuentaId}`);
    }
    if (!cuenta.activa) {
      throw new ErrorContable(`Cuenta inactiva: ${cuenta.codigo} ${cuenta.nombre}`);
    }
    if (cuenta.es_grupo) {
      throw new ErrorContable(`Cuenta de agrupación no admite movimiento: ${cuenta.codigo} ${cuenta.nombre}`);
    }
  }
  return normalizadas;
}

export function contabilizarAsiento(
  db: Database.Database,
  entrada: EntradaAsiento
): ResultadoContabilizacion {
  validarFecha(entrada.fechaOperacion);
  if (!entrada.concepto?.trim()) {
    throw new ErrorContable('El asiento requiere concepto');
  }
  if (!entrada.responsable?.trim()) {
    throw new ErrorContable('El asiento requiere responsable');
  }
  const ambito = db
    .prepare('SELECT id FROM ambito WHERE id = ? AND activo = 1')
    .get(entrada.ambitoId) as { id: string } | undefined;
  if (!ambito) {
    throw new ErrorContable(`Ámbito inexistente o inactivo: ${entrada.ambitoId}`);
  }
  const anioOperacion = Number(entrada.fechaOperacion.slice(0, 4));
  const cierreEjercicio = estadoCierreEjercicio(db, entrada.ambitoId, anioOperacion);
  if (cierreEjercicio === 'cerrado') {
    throw new ErrorContable(`El ejercicio ${anioOperacion} está cerrado; reábrelo con motivo auditado para operar`);
  }
  if (entrada.claveIdempotencia) {
    const previo = db
      .prepare('SELECT id, folio FROM asiento WHERE clave_idempotencia = ?')
      .get(entrada.claveIdempotencia) as { id: number; folio: string } | undefined;
    if (previo) {
      return { asientoId: previo.id, folio: previo.folio, duplicado: true };
    }
  }
  const lineas = validarLineas(db, entrada.lineas);
  const periodo = periodoDeFecha(db, entrada.fechaOperacion);
  if (periodo.estado !== 'abierto') {
    throw new ErrorContable(`Período cerrado: ${entrada.fechaOperacion.slice(0, 7)}`);
  }

  if (!fechaDentroDePeriodo(entrada.fechaOperacion, periodo.inicio, periodo.fin)) {
    throw new ErrorContable(`La fecha no pertenece al período derivado: ${entrada.fechaOperacion}`);
  }

  const ejecutar = db.transaction((): ResultadoContabilizacion => {
    const siguiente = db
      .prepare('SELECT COUNT(*) AS n FROM asiento WHERE ambito_id = ?')
      .get(entrada.ambitoId) as { n: number };
    const folio = `A-${String(siguiente.n + 1).padStart(6, '0')}`;
    const info = db
      .prepare(
        `INSERT INTO asiento
         (folio, fecha_operacion, periodo_id, ambito_id, concepto, origen_tipo, origen_id,
          clave_idempotencia, estado, responsable)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'borrador', ?)`
      )
      .run(
        folio,
        entrada.fechaOperacion,
        periodo.id,
        entrada.ambitoId,
        entrada.concepto.trim(),
        entrada.origenTipo ?? null,
        entrada.origenId ?? null,
        entrada.claveIdempotencia ?? null,
        entrada.responsable.trim()
      );
    const asientoId = Number(info.lastInsertRowid);
    const insertarLinea = db.prepare(
      'INSERT INTO asiento_linea (asiento_id, cuenta_id, debe_minor, haber_minor) VALUES (?, ?, ?, ?)'
    );
    for (const linea of lineas) {
      insertarLinea.run(asientoId, linea.cuentaId, linea.debe, linea.haber);
    }
    db.prepare(
      "UPDATE asiento SET estado = 'contabilizado', contabilizado_en = datetime('now') WHERE id = ?"
    ).run(asientoId);
    registroEvento(db, entrada.responsable, 'contabilizacion', 'asiento', String(asientoId), {
      folio,
      concepto: entrada.concepto,
      origen: entrada.origenTipo ? `${entrada.origenTipo}:${entrada.origenId}` : null
    });
    return { asientoId, folio, duplicado: false };
  });
  return ejecutar();
}

const ORIGENES_ADMINISTRADOS = new Set(['venta', 'compra', 'cobro', 'pago', 'transferencia', 'aplicacion_anticipo']);

export function anularAsiento(
  db: Database.Database,
  asientoId: number,
  responsable: string,
  motivo: string,
  rutaAutorizada = false
): ResultadoContabilizacion {
  if (!motivo?.trim()) {
    throw new ErrorContable('La anulación requiere motivo');
  }
  const original = db
    .prepare('SELECT * FROM asiento WHERE id = ?')
    .get(asientoId) as
    | {
        id: number;
        folio: string;
        fecha_operacion: string;
        periodo_id: number;
        ambito_id: string;
        concepto: string;
        estado: string;
        reverso_de_id: number | null;
        origen_tipo: string | null;
      }
    | undefined;
  if (!original) {
    throw new ErrorContable(`No existe el asiento ${asientoId}`);
  }
  if (!rutaAutorizada && original.origen_tipo && ORIGENES_ADMINISTRADOS.has(original.origen_tipo)) {
    throw new ErrorContable(
      `El asiento ${original.folio} pertenece a un documento de ${original.origen_tipo}; anúlelo desde su vista para conservar la conciliación`
    );
  }
  if (original.reverso_de_id) {
    throw new ErrorContable(`Un reverso no se anula: ${original.folio}`);
  }
  const yaAnulado = db
    .prepare('SELECT id FROM asiento WHERE reverso_de_id = ?')
    .get(asientoId) as { id: number } | undefined;
  if (yaAnulado) {
    throw new ErrorContable(`El asiento ${original.folio} ya tiene reverso`);
  }
  if (original.estado !== 'contabilizado') {
    throw new ErrorContable(`Solo se anulan asientos contabilizados: ${original.folio}`);
  }
  const cierreEjercicioAnulacion = estadoCierreEjercicio(db, original.ambito_id, Number(original.fecha_operacion.slice(0, 4)));
  if (cierreEjercicioAnulacion === 'cerrado') {
    throw new ErrorContable(
      `El ejercicio ${Number(original.fecha_operacion.slice(0, 4))} está cerrado; reábrelo con motivo auditado antes de anular`
    );
  }
  const periodo = db
    .prepare('SELECT estado FROM periodo WHERE id = ?')
    .get(original.periodo_id) as { estado: EstadoPeriodo };
  if (periodo.estado !== 'abierto') {
    throw new ErrorContable('El período del asiento está cerrado; reábrelo con respaldo y motivo');
  }
  const lineas = db
    .prepare('SELECT cuenta_id, debe_minor, haber_minor FROM asiento_linea WHERE asiento_id = ?')
    .all(asientoId) as Array<{ cuenta_id: number; debe_minor: number; haber_minor: number }>;

  const ejecutar = db.transaction((): ResultadoContabilizacion => {
    const siguiente = db
      .prepare('SELECT COUNT(*) AS n FROM asiento WHERE ambito_id = ?')
      .get(original.ambito_id) as { n: number };
    const folio = `A-${String(siguiente.n + 1).padStart(6, '0')}`;
    const info = db
      .prepare(
        `INSERT INTO asiento
         (folio, fecha_operacion, periodo_id, ambito_id, concepto, origen_tipo, origen_id,
          estado, reverso_de_id, responsable, motivo)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'borrador', ?, ?, ?)`
      )
      .run(
        folio,
        original.fecha_operacion,
        original.periodo_id,
        original.ambito_id,
        `Reverso de ${original.folio}: ${original.concepto}`,
        null,
        null,
        asientoId,
        responsable,
        motivo
      );
    const reversoId = Number(info.lastInsertRowid);
    const insertarLinea = db.prepare(
      'INSERT INTO asiento_linea (asiento_id, cuenta_id, debe_minor, haber_minor) VALUES (?, ?, ?, ?)'
    );
    for (const linea of lineas) {
      insertarLinea.run(reversoId, linea.cuenta_id, linea.haber_minor, linea.debe_minor);
    }
    db.prepare(
      "UPDATE asiento SET estado = 'contabilizado', contabilizado_en = datetime('now') WHERE id = ?"
    ).run(reversoId);
    db.prepare('UPDATE asiento SET estado = ? WHERE id = ?').run('anulado', asientoId);
    registroEvento(db, responsable, 'anulacion', 'asiento', String(asientoId), {
      reversoId,
      folioReverso: folio,
      motivo
    });
    return { asientoId: reversoId, folio, duplicado: false };
  });
  return ejecutar();
}

export function cerrarPeriodo(db: Database.Database, periodoId: number, responsable: string, motivo: string): void {
  const cambiado = db
    .prepare("UPDATE periodo SET estado = 'cerrado' WHERE id = ? AND estado = 'abierto'")
    .run(periodoId);
  if (cambiado.changes === 0) {
    throw new ErrorContable(`El período ${periodoId} no está abierto`);
  }
  registroEvento(db, responsable, 'cierre_periodo', 'periodo', String(periodoId), { motivo });
}

export function reabrirPeriodo(
  db: Database.Database,
  periodoId: number,
  responsable: string,
  motivo: string
): void {
  if (!motivo?.trim()) {
    throw new ErrorContable('La reapertura exige motivo');
  }
  const cambiado = db
    .prepare("UPDATE periodo SET estado = 'abierto' WHERE id = ? AND estado = 'cerrado'")
    .run(periodoId);
  if (cambiado.changes === 0) {
    throw new ErrorContable(`El período ${periodoId} no está cerrado`);
  }
  registroEvento(db, responsable, 'reapertura_periodo', 'periodo', String(periodoId), { motivo });
}

export function listarAsientos(db: Database.Database, limite = 100): AsientoResumen[] {
  const filas = db
    .prepare(
      `SELECT a.id, a.folio, a.fecha_operacion, a.concepto, a.estado, a.reverso_de_id,
              a.origen_tipo, a.origen_id,
              COALESCE(SUM(l.debe_minor), 0) AS total
       FROM asiento a JOIN asiento_linea l ON l.asiento_id = a.id
       GROUP BY a.id ORDER BY a.id DESC LIMIT ?`
    )
    .all(limite) as Array<{
    id: number;
    folio: string;
    fecha_operacion: string;
    concepto: string;
    estado: string;
    reverso_de_id: number | null;
    origen_tipo: string | null;
    origen_id: string | null;
    total: number;
  }>;
  return filas.map(f => ({
    id: f.id,
    folio: f.folio,
    fechaOperacion: f.fecha_operacion,
    concepto: f.concepto,
    estado: f.estado as AsientoResumen['estado'],
    totalMinor: minorATexto(BigInt(f.total)),
    reversoDeId: f.reverso_de_id,
    origenTipo: f.origen_tipo,
    origenId: f.origen_id
  }));
}

export interface MovimientoMayor {
  asientoId: number;
  folio: string;
  fecha: string;
  concepto: string;
  debeMinor: string;
  haberMinor: string;
  saldoMinor: string;
}

export function mayorDeCuenta(db: Database.Database, cuentaId: number): {
  movimientos: MovimientoMayor[];
  saldoMinor: string;
} {
  const filas = db
    .prepare(
      `SELECT l.asiento_id, a.folio, a.fecha_operacion, a.concepto, l.debe_minor, l.haber_minor
       FROM asiento_linea l
       JOIN asiento a ON a.id = l.asiento_id
       WHERE l.cuenta_id = ? AND a.estado IN ('contabilizado','anulado')
       ORDER BY a.fecha_operacion, a.id, l.id`
    )
    .all(cuentaId) as Array<{
    asiento_id: number;
    folio: string;
    fecha_operacion: string;
    concepto: string;
    debe_minor: number;
    haber_minor: number;
  }>;
  let saldo = 0n;
  const movimientos = filas.map(f => {
    const debe = BigInt(f.debe_minor);
    const haber = BigInt(f.haber_minor);
    saldo += debe - haber;
    return {
      asientoId: f.asiento_id,
      folio: f.folio,
      fecha: f.fecha_operacion,
      concepto: f.concepto,
      debeMinor: minorATexto(debe),
      haberMinor: minorATexto(haber),
      saldoMinor: minorATexto(saldo)
    };
  });
  return { movimientos, saldoMinor: minorATexto(saldo) };
}
