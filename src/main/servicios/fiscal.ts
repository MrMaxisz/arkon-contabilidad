import type Database from 'better-sqlite3';
import { parseMontoMinor, parseTasa, minorATexto } from '../../shared/dinero';
import { validarFechaCalendario } from '../../shared/fechas';
import { contabilizarAsiento, anularAsiento } from './motorAsientos';
import { registroEvento } from './bitacora';

export class ErrorFiscal extends Error {}

export interface VigenciaFiscal {
  id: number;
  desde: string;
  hasta: string | null;
  inscritoIva: boolean;
  descripcion: string | null;
  fuente: string | null;
}

export function crearVigencia(
  db: Database.Database,
  entrada: { desde: string; hasta?: string; inscritoIva: boolean; descripcion?: string; fuente?: string; responsable: string }
): number {
  validarFechaCalendario(entrada.desde);
  if (entrada.hasta) {
    validarFechaCalendario(entrada.hasta);
    if (entrada.hasta < entrada.desde) {
      throw new ErrorFiscal('El fin de la vigencia no puede preceder al inicio');
    }
  }
  const solapada = db
    .prepare(
      "SELECT id FROM vigencia_fiscal WHERE NOT (hasta IS NOT NULL AND hasta < ?) AND desde <= COALESCE(?, '9999-12-31')"
    )
    .get(entrada.desde, entrada.hasta ?? '9999-12-31') as { id: number } | undefined;
  if (solapada) {
    throw new ErrorFiscal('La vigencia se solapa con una existente; las vigencias no se superponen');
  }
  const info = db
    .prepare('INSERT INTO vigencia_fiscal (desde, hasta, inscrito_iva, descripcion, fuente, responsable) VALUES (?, ?, ?, ?, ?, ?)')
    .run(
      entrada.desde,
      entrada.hasta ?? null,
      entrada.inscritoIva ? 1 : 0,
      entrada.descripcion?.trim() ?? null,
      entrada.fuente?.trim() ?? null,
      entrada.responsable.trim()
    );
  registroEvento(db, entrada.responsable, 'vigencia_creada', 'vigencia_fiscal', String(info.lastInsertRowid), entrada);
  return Number(info.lastInsertRowid);
}

export function listarVigencias(db: Database.Database): VigenciaFiscal[] {
  const filas = db
    .prepare('SELECT id, desde, hasta, inscrito_iva, descripcion, fuente FROM vigencia_fiscal ORDER BY desde')
    .all() as Array<{ id: number; desde: string; hasta: string | null; inscrito_iva: number; descripcion: string | null; fuente: string | null }>;
  return filas.map(f => ({
    id: f.id,
    desde: f.desde,
    hasta: f.hasta,
    inscritoIva: f.inscrito_iva === 1,
    descripcion: f.descripcion,
    fuente: f.fuente
  }));
}

export function inscritoIvaEnFecha(db: Database.Database, fecha: string): boolean {
  const hayVigencias = (db.prepare('SELECT COUNT(*) AS n FROM vigencia_fiscal').get() as { n: number }).n > 0;
  if (!hayVigencias) {
    const fila = db.prepare("SELECT valor FROM configuracion WHERE clave = 'perfil_iva_inscrito'").get() as { valor: string } | undefined;
    return fila?.valor === '1';
  }
  const vigencia = db
    .prepare(
      "SELECT inscrito_iva FROM vigencia_fiscal WHERE desde <= ? AND (hasta IS NULL OR hasta >= ?) ORDER BY desde DESC LIMIT 1"
    )
    .get(fecha, fecha) as { inscrito_iva: number } | undefined;
  return vigencia?.inscrito_iva === 1;
}

export interface FilaLibro {
  folio: string;
  fecha: string;
  contraparteNombre: string;
  baseMinor: string;
  ivaMinor: string;
  totalMinor: string;
  estado: string;
}

export interface ResumenLibro {
  filas: FilaLibro[];
  baseMinor: string;
  ivaMinor: string;
  totalMinor: string;
}

function mesRango(mes: string): { inicio: string; fin: string } {
  if (!/^\d{4}-\d{2}$/.test(mes)) {
    throw new ErrorFiscal(`Mes inválido: ${mes}`);
  }
  const partes = mes.split('-').map(Number);
  const anio = partes[0];
  const mesNum = partes[1];
  if (!anio || !mesNum || mesNum < 1 || mesNum > 12) {
    throw new ErrorFiscal(`Mes inválido: ${mes}`);
  }
  const fin = new Date(Date.UTC(anio, mesNum, 0)).toISOString().slice(0, 10);
  return { inicio: `${mes}-01`, fin };
}

export function libroVentas(db: Database.Database, mes: string): ResumenLibro {
  const { inicio, fin } = mesRango(mes);
  const filas = db
    .prepare(
      `SELECT v.folio, v.fecha_operacion, c.nombre AS contraparte, v.base_minor, v.iva_minor, v.total_minor, v.estado
       FROM venta v JOIN contraparte c ON c.id = v.contraparte_id
       WHERE v.fecha_operacion BETWEEN ? AND ?
       ORDER BY v.fecha_operacion, v.id`
    )
    .all(inicio, fin) as Array<{
    folio: string;
    fecha_operacion: string;
    contraparte: string;
    base_minor: number;
    iva_minor: number;
    total_minor: number;
    estado: string;
  }>;
  return mapearLibro(filas);
}

export function libroCompras(db: Database.Database, mes: string): ResumenLibro {
  const { inicio, fin } = mesRango(mes);
  const filas = db
    .prepare(
      `SELECT co.folio, co.fecha_operacion, c.nombre AS contraparte, co.base_minor, co.iva_minor, co.total_minor, co.estado
       FROM compra co JOIN contraparte c ON c.id = co.contraparte_id
       WHERE co.fecha_operacion BETWEEN ? AND ?
       ORDER BY co.fecha_operacion, co.id`
    )
    .all(inicio, fin) as Array<{
    folio: string;
    fecha_operacion: string;
    contraparte: string;
    base_minor: number;
    iva_minor: number;
    total_minor: number;
    estado: string;
  }>;
  return mapearLibro(filas);
}

function mapearLibro(
  filas: Array<{ folio: string; fecha_operacion: string; contraparte: string; base_minor: number; iva_minor: number; total_minor: number; estado: string }>
): ResumenLibro {
  let base = 0n;
  let iva = 0n;
  let total = 0n;
  const mapeadas = filas.map(f => {
    if (f.estado === 'registrada') {
      base += BigInt(f.base_minor);
      iva += BigInt(f.iva_minor);
      total += BigInt(f.total_minor);
    }
    return {
      folio: f.folio,
      fecha: f.fecha_operacion,
      contraparteNombre: f.contraparte,
      baseMinor: minorATexto(BigInt(f.base_minor)),
      ivaMinor: minorATexto(BigInt(f.iva_minor)),
      totalMinor: minorATexto(BigInt(f.total_minor)),
      estado: f.estado
    };
  });
  return {
    filas: mapeadas,
    baseMinor: minorATexto(base),
    ivaMinor: minorATexto(iva),
    totalMinor: minorATexto(total)
  };
}

export interface ConciliacionIva {
  mes: string;
  debitoLibroMinor: string;
  debitoMayorMinor: string;
  creditoLibroMinor: string;
  creditoMayorMinor: string;
  conciliaDebito: boolean;
  conciliaCredito: boolean;
  nota: string;
}

export function conciliarIva(db: Database.Database, mes: string): ConciliacionIva {
  const { inicio, fin } = mesRango(mes);
  const ventas = libroVentas(db, mes);
  const compras = libroCompras(db, mes);
  const saldoMayor = (codigo: string): bigint => {
    const fila = db
      .prepare(
        `SELECT COALESCE(SUM(l.debe_minor - l.haber_minor), 0) AS s
         FROM asiento_linea l
         JOIN asiento a ON a.id = l.asiento_id
         JOIN cuenta c ON c.id = l.cuenta_id
         WHERE c.codigo = ? AND a.fecha_operacion BETWEEN ? AND ?
           AND a.estado IN ('contabilizado','anulado')`
      )
      .get(codigo, inicio, fin) as { s: number };
    return BigInt(fila.s);
  };
  const debitoMayor = -saldoMayor('2201');
  const creditoMayor = saldoMayor('1203');
  const debitoLibro = parseMontoMinor(ventas.ivaMinor);
  const creditoLibro = compras.ivaMinor === '0.00' ? 0n : parseMontoMinor(compras.ivaMinor);
  const creditoFiscalActivo = db
    .prepare("SELECT valor FROM configuracion WHERE clave = 'iva_compras_credito_fiscal'")
    .get() as { valor: string } | undefined;
  return {
    mes,
    debitoLibroMinor: minorATexto(debitoLibro),
    debitoMayorMinor: minorATexto(debitoMayor),
    creditoLibroMinor: minorATexto(creditoLibro),
    creditoMayorMinor: minorATexto(creditoMayor),
    conciliaDebito: debitoLibro === debitoMayor,
    conciliaCredito: creditoLibro === creditoMayor,
    nota:
      creditoFiscalActivo?.valor === '1'
        ? 'El crédito fiscal del mayor corresponde al IVA acreditable con política activa.'
        : 'Con la política de crédito fiscal inactiva, el IVA de compras va al costo; la conciliación del crédito se limita al IVA registrado en la cuenta 1203.'
  };
}

export interface RetencionResumen {
  id: number;
  folio: string;
  tipo: string;
  contraparteNombre: string;
  fecha: string;
  baseMinor: string;
  montoMinor: string;
  regla: string;
  comprobante: string | null;
  estado: string;
}

export function registrarRetencion(
  db: Database.Database,
  entrada: {
    tipo: 'efectuada' | 'recibida';
    contraparteId: number;
    fechaOperacion: string;
    base: string;
    tasa: string;
    regla: string;
    comprobante?: string;
    concepto: string;
    claveIdempotencia: string;
    responsable: string;
  }
): { id: number; folio: string; duplicado: boolean } {
  validarFechaCalendario(entrada.fechaOperacion);
  const previa = db
    .prepare('SELECT id, folio FROM retencion WHERE clave_idempotencia = ?')
    .get(entrada.claveIdempotencia) as { id: number; folio: string } | undefined;
  if (previa) {
    return { id: previa.id, folio: previa.folio, duplicado: true };
  }
  if (!entrada.regla?.trim()) {
    throw new ErrorFiscal('La retención exige regla aplicada');
  }
  const base = parseMontoMinor(entrada.base);
  const tasa = parseTasa(entrada.tasa);
  if (base <= 0n || tasa.puntosBase <= 0n) {
    throw new ErrorFiscal('La retención exige base y tasa positivas');
  }
  const monto = (base * tasa.puntosBase + 5000n) / 10000n;
  const contraparte = db
    .prepare('SELECT id FROM contraparte WHERE id = ? AND activa = 1')
    .get(entrada.contraparteId) as { id: number } | undefined;
  if (!contraparte) {
    throw new ErrorFiscal('Contraparte inexistente o inactiva');
  }
  const tx = db.transaction(() => {
    const n = (db.prepare('SELECT COUNT(*) AS n FROM retencion').get() as { n: number }).n;
    const folio = `RET-${String(n + 1).padStart(6, '0')}`;
    const info = db
      .prepare(
        `INSERT INTO retencion (folio, tipo, contraparte_id, fecha_operacion, base_minor, tasa_puntos_base, monto_minor, regla, comprobante, concepto, clave_idempotencia, responsable)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        folio,
        entrada.tipo,
        entrada.contraparteId,
        entrada.fechaOperacion,
        base,
        Number(tasa.puntosBase),
        monto,
        entrada.regla.trim(),
        entrada.comprobante?.trim() ?? null,
        entrada.concepto.trim(),
        entrada.claveIdempotencia,
        entrada.responsable.trim()
      );
    registroEvento(db, entrada.responsable, 'retencion_registrada', 'retencion', String(info.lastInsertRowid), {
      folio,
      tipo: entrada.tipo,
      monto: minorATexto(monto),
      nota: 'Registro de control sin efecto contable automático; el tratamiento requiere la política del contador responsable'
    });
    return { id: Number(info.lastInsertRowid), folio, duplicado: false };
  });
  return tx();
}

export function listarRetenciones(db: Database.Database): RetencionResumen[] {
  const filas = db
    .prepare(
      `SELECT r.id, r.folio, r.tipo, c.nombre AS contraparte, r.fecha_operacion, r.base_minor, r.monto_minor, r.regla, r.comprobante, r.estado
       FROM retencion r JOIN contraparte c ON c.id = r.contraparte_id
       ORDER BY r.id DESC LIMIT 100`
    )
    .all() as Array<{
    id: number;
    folio: string;
    tipo: string;
    contraparte: string;
    fecha_operacion: string;
    base_minor: number;
    monto_minor: number;
    regla: string;
    comprobante: string | null;
    estado: string;
  }>;
  return filas.map(f => ({
    id: f.id,
    folio: f.folio,
    tipo: f.tipo,
    contraparteNombre: f.contraparte,
    fecha: f.fecha_operacion,
    baseMinor: minorATexto(BigInt(f.base_minor)),
    montoMinor: minorATexto(BigInt(f.monto_minor)),
    regla: f.regla,
    comprobante: f.comprobante,
    estado: f.estado
  }));
}

export function saldoAnticipo(db: Database.Database, tipo: 'cliente' | 'proveedor', contraparteId: number): bigint {
  const tipoMovimiento = tipo === 'cliente' ? 'cobro' : 'pago';
  const excedente = db
    .prepare(
      `SELECT COALESCE(SUM(t.monto_minor - (SELECT COALESCE(SUM(a.monto_minor), 0) FROM aplicacion a WHERE a.movimiento_id = t.id)), 0) AS e
       FROM tesoreria_movimiento t
       WHERE t.tipo = ? AND t.contraparte_id = ? AND t.estado = 'registrado'`
    )
    .get(tipoMovimiento, contraparteId) as { e: number };
  const aplicado = (
    db
      .prepare(
        "SELECT COALESCE(SUM(monto_minor), 0) AS t FROM aplicacion_anticipo WHERE tipo = ? AND contraparte_id = ? AND estado = 'registrada'"
      )
      .get(tipo, contraparteId) as { t: number }
  ).t;
  return BigInt(excedente.e) - BigInt(aplicado);
}

export function aplicarAnticipo(
  db: Database.Database,
  entrada: {
    tipo: 'cliente' | 'proveedor';
    contraparteId: number;
    documentoTipo: 'venta' | 'compra';
    documentoId: number;
    fechaOperacion: string;
    monto: string;
    claveIdempotencia: string;
    responsable: string;
  }
): { id: number; folio: string; duplicado: boolean } {
  validarFechaCalendario(entrada.fechaOperacion);
  const previa = db
    .prepare('SELECT id, folio FROM aplicacion_anticipo WHERE clave_idempotencia = ?')
    .get(entrada.claveIdempotencia) as { id: number; folio: string } | undefined;
  if (previa) {
    return { id: previa.id, folio: previa.folio, duplicado: true };
  }
  if (entrada.documentoTipo !== (entrada.tipo === 'cliente' ? 'venta' : 'compra')) {
    throw new ErrorFiscal('Un anticipo de cliente aplica a ventas y uno de proveedor a compras');
  }
  const tabla = entrada.documentoTipo;
  const doc = db
    .prepare(`SELECT contraparte_id, estado FROM ${tabla} WHERE id = ?`)
    .get(entrada.documentoId) as { contraparte_id: number; estado: string } | undefined;
  if (!doc) {
    throw new ErrorFiscal('Documento inexistente');
  }
  if (doc.estado !== 'registrada') {
    throw new ErrorFiscal('El documento no está registrado');
  }
  if (doc.contraparte_id !== entrada.contraparteId) {
    throw new ErrorFiscal('El documento pertenece a otra contraparte');
  }
  const monto = parseMontoMinor(entrada.monto);
  if (monto <= 0n) {
    throw new ErrorFiscal('El monto a aplicar debe ser mayor que cero');
  }
  const aplicadoPrevio = (
    db
      .prepare(
        `SELECT COALESCE(SUM(monto_minor), 0) AS t FROM (
           SELECT a.monto_minor FROM aplicacion a JOIN tesoreria_movimiento m ON m.id = a.movimiento_id
           WHERE a.documento_tipo = ? AND a.documento_id = ? AND m.estado = 'registrado'
           UNION ALL
           SELECT aa.monto_minor FROM aplicacion_anticipo aa
           WHERE aa.documento_tipo = ? AND aa.documento_id = ? AND aa.estado = 'registrada'
         )`
      )
      .get(entrada.documentoTipo, entrada.documentoId, entrada.documentoTipo, entrada.documentoId) as { t: number }
  ).t;
  const totalDoc = (db.prepare(`SELECT total_minor FROM ${tabla} WHERE id = ?`).get(entrada.documentoId) as { total_minor: number }).total_minor;
  const pendiente = BigInt(totalDoc) - BigInt(aplicadoPrevio);
  if (monto > pendiente) {
    throw new ErrorFiscal(`El anticipo a aplicar (${minorATexto(monto)}) excede el saldo pendiente (${minorATexto(pendiente)})`);
  }
  const saldoAnticipoDisponible = saldoAnticipo(db, entrada.tipo, entrada.contraparteId);
  if (monto > saldoAnticipoDisponible) {
    throw new ErrorFiscal(
      `El anticipo disponible de la contraparte (${minorATexto(saldoAnticipoDisponible)}) es menor que el monto a aplicar`
    );
  }
  const cuentas =
    entrada.tipo === 'cliente'
      ? { anticipo: (db.prepare("SELECT id FROM cuenta WHERE codigo = '2102'").get() as { id: number }).id, documento: (db.prepare("SELECT id FROM cuenta WHERE codigo = '1201'").get() as { id: number }).id }
      : { anticipo: (db.prepare("SELECT id FROM cuenta WHERE codigo = '1202'").get() as { id: number }).id, documento: (db.prepare("SELECT id FROM cuenta WHERE codigo = '2101'").get() as { id: number }).id };
  const lineas =
    entrada.tipo === 'cliente'
      ? [
          { cuentaId: cuentas.anticipo, debeMinor: minorATexto(monto), haberMinor: '' },
          { cuentaId: cuentas.documento, debeMinor: '', haberMinor: minorATexto(monto) }
        ]
      : [
          { cuentaId: cuentas.documento, debeMinor: minorATexto(monto), haberMinor: '' },
          { cuentaId: cuentas.anticipo, debeMinor: '', haberMinor: minorATexto(monto) }
        ];
  const tx = db.transaction(() => {
    const n = (db.prepare('SELECT COUNT(*) AS n FROM aplicacion_anticipo').get() as { n: number }).n;
    const folio = `AAP-${String(n + 1).padStart(6, '0')}`;
    const asiento = contabilizarAsiento(db, {
      fechaOperacion: entrada.fechaOperacion,
      concepto: `Aplicación de anticipo ${folio} al documento ${entrada.documentoId}`,
      lineas,
      origenTipo: 'aplicacion_anticipo',
      origenId: folio,
      claveIdempotencia: `${entrada.claveIdempotencia}:asiento`,
      responsable: entrada.responsable,
      ambitoId: 'administrativo'
    });
    const info = db
      .prepare(
        `INSERT INTO aplicacion_anticipo (folio, tipo, contraparte_id, documento_tipo, documento_id, fecha_operacion, monto_minor, asiento_id, clave_idempotencia, responsable)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        folio,
        entrada.tipo,
        entrada.contraparteId,
        entrada.documentoTipo,
        entrada.documentoId,
        entrada.fechaOperacion,
        monto,
        asiento.asientoId,
        entrada.claveIdempotencia,
        entrada.responsable.trim()
      );
    registroEvento(db, entrada.responsable, 'anticipo_aplicado', 'aplicacion_anticipo', String(info.lastInsertRowid), {
      folio,
      tipo: entrada.tipo,
      monto: minorATexto(monto)
    });
    return { id: Number(info.lastInsertRowid), folio, duplicado: false };
  });
  return tx();
}

export function anularAplicacionAnticipo(db: Database.Database, id: number, responsable: string, motivo: string): void {
  if (!motivo?.trim()) {
    throw new ErrorFiscal('La anulación exige motivo');
  }
  const fila = db
    .prepare('SELECT id, folio, asiento_id, estado FROM aplicacion_anticipo WHERE id = ?')
    .get(id) as { id: number; folio: string; asiento_id: number; estado: string } | undefined;
  if (!fila) {
    throw new ErrorFiscal('Aplicación de anticipo inexistente');
  }
  if (fila.estado !== 'registrada') {
    throw new ErrorFiscal(`La aplicación ${fila.folio} ya está anulada`);
  }
  const tx = db.transaction(() => {
    anularAsiento(db, fila.asiento_id, responsable, `Anulación de ${fila.folio}: ${motivo}`, true);
    db.prepare("UPDATE aplicacion_anticipo SET estado = 'anulada' WHERE id = ?").run(id);
    registroEvento(db, responsable, 'anticipo_aplicacion_anulada', 'aplicacion_anticipo', String(id), { folio: fila.folio, motivo });
  });
  tx();
}
