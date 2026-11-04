import type Database from 'better-sqlite3';
import { parseMontoMinor, minorATexto } from '../../shared/dinero';
import { validarFechaCalendario } from '../../shared/fechas';
import { contabilizarAsiento, anularAsiento } from './motorAsientos';
import { saldoPendienteDocumento, ErrorOperacion } from './operacion';
import { registroEvento } from './bitacora';
import type { MovimientoTesoreriaResumen } from '../../shared/contratos';

export class ErrorTesoreria extends Error {}

function validarAplicaciones(
  db: Database.Database,
  aplicaciones: AplicacionEntrada[],
  tipoEsperado: 'venta' | 'compra',
  contraparteId: number
): Array<{ documentoId: number; monto: bigint }> {
  const porDocumento = new Map<number, bigint>();
  for (const a of aplicaciones) {
    const montoA = parseMontoMinor(a.monto);
    if (montoA <= 0n) {
      throw new ErrorTesoreria('Cada aplicación requiere monto positivo');
    }
    if (a.documentoTipo !== tipoEsperado) {
      throw new ErrorTesoreria(`El movimiento solo aplica a documentos tipo ${tipoEsperado}`);
    }
    const tabla = tipoEsperado === 'venta' ? 'venta' : 'compra';
    const doc = db
      .prepare(`SELECT contraparte_id FROM ${tabla} WHERE id = ? AND estado = 'registrada'`)
      .get(a.documentoId) as { contraparte_id: number } | undefined;
    if (!doc) {
      throw new ErrorTesoreria(`No existe el documento ${tipoEsperado} ${a.documentoId} en estado registrada`);
    }
    if (doc.contraparte_id !== contraparteId) {
      throw new ErrorTesoreria(
        `El documento ${tipoEsperado} ${a.documentoId} pertenece a otra contraparte; cobros y pagos cruzados se rechazan`
      );
    }
    porDocumento.set(a.documentoId, (porDocumento.get(a.documentoId) ?? 0n) + montoA);
  }
  const resultado: Array<{ documentoId: number; monto: bigint }> = [];
  for (const [documentoId, montoAcumulado] of porDocumento) {
    const pendiente = saldoPendienteDocumento(db, tipoEsperado, documentoId);
    if (montoAcumulado > pendiente) {
      throw new ErrorTesoreria(
        `Las aplicaciones al documento ${documentoId} (${minorATexto(montoAcumulado)}) exceden el saldo pendiente (${minorATexto(pendiente)})`
      );
    }
    resultado.push({ documentoId, monto: montoAcumulado });
  }
  return resultado;
}

interface CuentaEfectivo {
  id: number;
  codigo: string;
  nombre: string;
}

function cuentaEfectiva(db: Database.Database, cuentaId: number): CuentaEfectivo {
  const fila = db
    .prepare('SELECT id, codigo, nombre FROM cuenta WHERE id = ? AND es_efectivo = 1 AND activa = 1')
    .get(cuentaId) as CuentaEfectivo | undefined;
  if (!fila) {
    throw new ErrorTesoreria(`La cuenta ${cuentaId} no es una cuenta de efectivo activa`);
  }
  return fila;
}

export interface AplicacionEntrada {
  documentoTipo: 'venta' | 'compra';
  documentoId: number;
  monto: string;
}

function folioTipo(db: Database.Database, tipo: string): string {
  const prefijo = tipo === 'cobro' ? 'COB' : tipo === 'pago' ? 'PAG' : 'TRF';
  const n = (db.prepare('SELECT COUNT(*) AS n FROM tesoreria_movimiento WHERE tipo = ?').get(tipo) as { n: number }).n;
  return `${prefijo}-${String(n + 1).padStart(6, '0')}`;
}

function previoPorClave(
  db: Database.Database,
  clave: string
): { id: number; folio: string } | undefined {
  return db.prepare('SELECT id, folio FROM tesoreria_movimiento WHERE clave_idempotencia = ?').get(clave) as
    | { id: number; folio: string }
    | undefined;
}

export function registrarCobro(
  db: Database.Database,
  entrada: {
    fechaOperacion: string;
    contraparteId: number;
    cuentaDestinoId: number;
    monto: string;
    concepto: string;
    referencia?: string;
    aplicaciones: AplicacionEntrada[];
    claveIdempotencia: string;
    responsable: string;
  }
): { id: number; folio: string; duplicado: boolean } {
  validarFechaCalendario(entrada.fechaOperacion);
  const previo = previoPorClave(db, entrada.claveIdempotencia);
  if (previo) {
    return { id: previo.id, folio: previo.folio, duplicado: true };
  }
  const cuentaDestino = cuentaEfectiva(db, entrada.cuentaDestinoId);
  const monto = parseMontoMinor(entrada.monto);
  if (monto <= 0n) {
    throw new ErrorTesoreria('El monto debe ser mayor que cero');
  }
  if (!entrada.concepto?.trim()) {
    throw new ErrorTesoreria('El cobro requiere concepto');
  }
  const cliente = db
    .prepare('SELECT id FROM contraparte WHERE id = ? AND es_cliente = 1 AND activa = 1')
    .get(entrada.contraparteId) as { id: number } | undefined;
  if (!cliente) {
    throw new ErrorTesoreria('La contraparte no es un cliente activo');
  }

  const aplicaciones = validarAplicaciones(db, entrada.aplicaciones ?? [], 'venta', entrada.contraparteId);
  const aplicado = aplicaciones.reduce((suma, a) => suma + a.monto, 0n);
  if (aplicado > monto) {
    throw new ErrorTesoreria('Las aplicaciones exceden el monto cobrado');
  }
  const excedente = monto - aplicado;

  const cuentaClientes = (db.prepare("SELECT id FROM cuenta WHERE codigo = '1201'").get() as { id: number }).id;
  const cuentaAnticipoClientes = (db.prepare("SELECT id FROM cuenta WHERE codigo = '2102'").get() as { id: number }).id;

  const lineasAsiento = [{ cuentaId: cuentaDestino.id, debeMinor: minorATexto(monto), haberMinor: '' }];
  if (aplicado > 0n) {
    lineasAsiento.push({ cuentaId: cuentaClientes, debeMinor: '', haberMinor: minorATexto(aplicado) });
  }
  if (excedente > 0n) {
    lineasAsiento.push({ cuentaId: cuentaAnticipoClientes, debeMinor: '', haberMinor: minorATexto(excedente) });
  }

  const tx = db.transaction((): { id: number; folio: string; duplicado: boolean } => {
    const folio = folioTipo(db, 'cobro');
    const asiento = contabilizarAsiento(db, {
      fechaOperacion: entrada.fechaOperacion,
      concepto: `Cobro ${folio}: ${entrada.concepto}`,
      lineas: lineasAsiento,
      origenTipo: 'cobro',
      origenId: folio,
      claveIdempotencia: `${entrada.claveIdempotencia}:asiento`,
      responsable: entrada.responsable,
      ambitoId: 'administrativo'
    });
    const info = db
      .prepare(
        `INSERT INTO tesoreria_movimiento (folio, tipo, fecha_operacion, contraparte_id, cuenta_origen_id, cuenta_destino_id, monto_minor, referencia, concepto, asiento_id, clave_idempotencia, responsable)
         VALUES (?, 'cobro', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        folio,
        entrada.fechaOperacion,
        entrada.contraparteId,
        cuentaDestino.id,
        cuentaDestino.id,
        monto,
        entrada.referencia?.trim() ?? null,
        entrada.concepto.trim(),
        asiento.asientoId,
        entrada.claveIdempotencia,
        entrada.responsable.trim()
      );
    const movimientoId = Number(info.lastInsertRowid);
    const insertarAplicacion = db.prepare(
      'INSERT INTO aplicacion (movimiento_id, documento_tipo, documento_id, monto_minor) VALUES (?, ?, ?, ?)'
    );
    for (const a of aplicaciones) {
      insertarAplicacion.run(movimientoId, 'venta', a.documentoId, a.monto);
    }
    registroEvento(db, entrada.responsable, 'cobro_registrado', 'tesoreria_movimiento', String(movimientoId), {
      folio,
      monto: minorATexto(monto),
      excedenteAnticipo: minorATexto(excedente)
    });
    return { id: movimientoId, folio, duplicado: false };
  });
  return tx();
}

export function registrarPago(
  db: Database.Database,
  entrada: {
    fechaOperacion: string;
    contraparteId: number;
    cuentaOrigenId: number;
    monto: string;
    concepto: string;
    referencia?: string;
    aplicaciones: AplicacionEntrada[];
    claveIdempotencia: string;
    responsable: string;
  }
): { id: number; folio: string; duplicado: boolean } {
  validarFechaCalendario(entrada.fechaOperacion);
  const previo = previoPorClave(db, entrada.claveIdempotencia);
  if (previo) {
    return { id: previo.id, folio: previo.folio, duplicado: true };
  }
  const cuentaOrigen = cuentaEfectiva(db, entrada.cuentaOrigenId);
  const monto = parseMontoMinor(entrada.monto);
  if (monto <= 0n) {
    throw new ErrorTesoreria('El monto debe ser mayor que cero');
  }
  if (!entrada.concepto?.trim()) {
    throw new ErrorTesoreria('El pago requiere concepto');
  }
  const proveedor = db
    .prepare('SELECT id FROM contraparte WHERE id = ? AND es_proveedor = 1 AND activa = 1')
    .get(entrada.contraparteId) as { id: number } | undefined;
  if (!proveedor) {
    throw new ErrorTesoreria('La contraparte no es un proveedor activo');
  }

  const aplicaciones = validarAplicaciones(db, entrada.aplicaciones ?? [], 'compra', entrada.contraparteId);
  const aplicado = aplicaciones.reduce((suma, a) => suma + a.monto, 0n);
  if (aplicado > monto) {
    throw new ErrorTesoreria('Las aplicaciones exceden el monto pagado');
  }
  const excedente = monto - aplicado;

  const cuentaProveedores = (db.prepare("SELECT id FROM cuenta WHERE codigo = '2101'").get() as { id: number }).id;
  const cuentaAnticipoProveedores = (db.prepare("SELECT id FROM cuenta WHERE codigo = '1202'").get() as { id: number }).id;

  const lineasAsiento = [{ cuentaId: cuentaOrigen.id, debeMinor: '', haberMinor: minorATexto(monto) }];
  if (aplicado > 0n) {
    lineasAsiento.push({ cuentaId: cuentaProveedores, debeMinor: minorATexto(aplicado), haberMinor: '' });
  }
  if (excedente > 0n) {
    lineasAsiento.push({ cuentaId: cuentaAnticipoProveedores, debeMinor: minorATexto(excedente), haberMinor: '' });
  }

  const tx = db.transaction((): { id: number; folio: string; duplicado: boolean } => {
    const folio = folioTipo(db, 'pago');
    const asiento = contabilizarAsiento(db, {
      fechaOperacion: entrada.fechaOperacion,
      concepto: `Pago ${folio}: ${entrada.concepto}`,
      lineas: lineasAsiento,
      origenTipo: 'pago',
      origenId: folio,
      claveIdempotencia: `${entrada.claveIdempotencia}:asiento`,
      responsable: entrada.responsable,
      ambitoId: 'administrativo'
    });
    const info = db
      .prepare(
        `INSERT INTO tesoreria_movimiento (folio, tipo, fecha_operacion, contraparte_id, cuenta_origen_id, cuenta_destino_id, monto_minor, referencia, concepto, asiento_id, clave_idempotencia, responsable)
         VALUES (?, 'pago', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        folio,
        entrada.fechaOperacion,
        entrada.contraparteId,
        cuentaOrigen.id,
        cuentaOrigen.id,
        monto,
        entrada.referencia?.trim() ?? null,
        entrada.concepto.trim(),
        asiento.asientoId,
        entrada.claveIdempotencia,
        entrada.responsable.trim()
      );
    const movimientoId = Number(info.lastInsertRowid);
    const insertarAplicacion = db.prepare(
      'INSERT INTO aplicacion (movimiento_id, documento_tipo, documento_id, monto_minor) VALUES (?, ?, ?, ?)'
    );
    for (const a of aplicaciones) {
      insertarAplicacion.run(movimientoId, 'compra', a.documentoId, a.monto);
    }
    registroEvento(db, entrada.responsable, 'pago_registrado', 'tesoreria_movimiento', String(movimientoId), {
      folio,
      monto: minorATexto(monto),
      excedenteAnticipo: minorATexto(excedente)
    });
    return { id: movimientoId, folio, duplicado: false };
  });
  return tx();
}

export function registrarTransferencia(
  db: Database.Database,
  entrada: {
    fechaOperacion: string;
    cuentaOrigenId: number;
    cuentaDestinoId: number;
    monto: string;
    concepto: string;
    referencia?: string;
    claveIdempotencia: string;
    responsable: string;
  }
): { id: number; folio: string; duplicado: boolean } {
  validarFechaCalendario(entrada.fechaOperacion);
  const previo = previoPorClave(db, entrada.claveIdempotencia);
  if (previo) {
    return { id: previo.id, folio: previo.folio, duplicado: true };
  }
  const origen = cuentaEfectiva(db, entrada.cuentaOrigenId);
  const destino = cuentaEfectiva(db, entrada.cuentaDestinoId);
  if (origen.id === destino.id) {
    throw new ErrorTesoreria('La transferencia requiere cuentas distintas');
  }
  const monto = parseMontoMinor(entrada.monto);
  if (monto <= 0n) {
    throw new ErrorTesoreria('El monto debe ser mayor que cero');
  }
  if (!entrada.concepto?.trim()) {
    throw new ErrorTesoreria('La transferencia requiere concepto');
  }

  const tx = db.transaction((): { id: number; folio: string; duplicado: boolean } => {
    const folio = folioTipo(db, 'transferencia');
    const asiento = contabilizarAsiento(db, {
      fechaOperacion: entrada.fechaOperacion,
      concepto: `Transferencia ${folio}: ${entrada.concepto}`,
      lineas: [
        { cuentaId: destino.id, debeMinor: minorATexto(monto), haberMinor: '' },
        { cuentaId: origen.id, debeMinor: '', haberMinor: minorATexto(monto) }
      ],
      origenTipo: 'transferencia',
      origenId: folio,
      claveIdempotencia: `${entrada.claveIdempotencia}:asiento`,
      responsable: entrada.responsable,
      ambitoId: 'administrativo'
    });
    const info = db
      .prepare(
        `INSERT INTO tesoreria_movimiento (folio, tipo, fecha_operacion, cuenta_origen_id, cuenta_destino_id, monto_minor, referencia, concepto, asiento_id, clave_idempotencia, responsable)
         VALUES (?, 'transferencia', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        folio,
        entrada.fechaOperacion,
        origen.id,
        destino.id,
        monto,
        entrada.referencia?.trim() ?? null,
        entrada.concepto.trim(),
        asiento.asientoId,
        entrada.claveIdempotencia,
        entrada.responsable.trim()
      );
    registroEvento(db, entrada.responsable, 'transferencia_registrada', 'tesoreria_movimiento', String(info.lastInsertRowid), {
      folio,
      monto: minorATexto(monto)
    });
    return { id: Number(info.lastInsertRowid), folio, duplicado: false };
  });
  return tx();
}

export function anularMovimiento(db: Database.Database, movimientoId: number, responsable: string, motivo: string): void {
  if (!motivo?.trim()) {
    throw new ErrorTesoreria('La anulación exige motivo');
  }
  const mov = db
    .prepare('SELECT id, folio, asiento_id, estado, tipo FROM tesoreria_movimiento WHERE id = ?')
    .get(movimientoId) as { id: number; folio: string; asiento_id: number; estado: string; tipo: string } | undefined;
  if (!mov) {
    throw new ErrorTesoreria('Movimiento inexistente');
  }
  if (mov.estado !== 'registrado') {
    throw new ErrorTesoreria(`El movimiento ${mov.folio} ya está anulado`);
  }
  const tx = db.transaction(() => {
    anularAsiento(db, mov.asiento_id, responsable, `Anulación de ${mov.folio}: ${motivo}`, true);
    db.prepare("UPDATE tesoreria_movimiento SET estado = 'anulado' WHERE id = ?").run(movimientoId);
    registroEvento(db, responsable, 'movimiento_anulado', 'tesoreria_movimiento', String(movimientoId), {
      folio: mov.folio,
      motivo
    });
  });
  tx();
}

export function listarMovimientos(db: Database.Database): MovimientoTesoreriaResumen[] {
  const filas = db
    .prepare(
      `SELECT t.id, t.folio, t.tipo, t.fecha_operacion, t.concepto, t.monto_minor, t.estado, c.nombre AS contraparte
       FROM tesoreria_movimiento t LEFT JOIN contraparte c ON c.id = t.contraparte_id
       ORDER BY t.id DESC LIMIT 100`
    )
    .all() as Array<{
    id: number;
    folio: string;
    tipo: string;
    fecha_operacion: string;
    concepto: string;
    monto_minor: number;
    estado: string;
    contraparte: string | null;
  }>;
  return filas.map(f => ({
    id: f.id,
    folio: f.folio,
    tipo: f.tipo,
    fecha: f.fecha_operacion,
    concepto: f.concepto,
    montoMinor: minorATexto(BigInt(f.monto_minor)),
    estado: f.estado,
    contraparteNombre: f.contraparte
  }));
}

export { ErrorOperacion };
