import type Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { parseMontoMinor, parseTasa, minorATexto } from '../../shared/dinero';
import { validarFechaCalendario } from '../../shared/fechas';
import { contabilizarAsiento, anularAsiento } from './motorAsientos';
import { registroEvento } from './bitacora';
import { saldoPendienteDocumento } from './saldos';
import { SQL_FAMILIA_CIERRE_EXCLUIDA } from './familiaCierre';

export class ErrorFiscal extends Error {}

export interface VigenciaFiscal {
  id: number;
  desde: string;
  hasta: string | null;
  inscritoIva: boolean;
  descripcion: string | null;
  fuente: string | null;
  obligacionF14: boolean;
}

export function crearVigencia(
  db: Database.Database,
  entrada: { desde: string; hasta?: string; inscritoIva: boolean; obligacionF14?: boolean; descripcion?: string; fuente?: string; responsable: string }
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
    .prepare('INSERT INTO vigencia_fiscal (desde, hasta, inscrito_iva, obligacion_f14, descripcion, fuente, responsable) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(
      entrada.desde,
      entrada.hasta ?? null,
      entrada.inscritoIva ? 1 : 0,
      entrada.obligacionF14 ? 1 : 0,
      entrada.descripcion?.trim() ?? null,
      entrada.fuente?.trim() ?? null,
      entrada.responsable.trim()
    );
  registroEvento(db, entrada.responsable, 'vigencia_creada', 'vigencia_fiscal', String(info.lastInsertRowid), entrada);
  return Number(info.lastInsertRowid);
}

export function listarVigencias(db: Database.Database): VigenciaFiscal[] {
  const filas = db
    .prepare('SELECT id, desde, hasta, inscrito_iva, obligacion_f14, descripcion, fuente FROM vigencia_fiscal ORDER BY desde')
    .all() as Array<{ id: number; desde: string; hasta: string | null; inscrito_iva: number; obligacion_f14: number; descripcion: string | null; fuente: string | null }>;
  return filas.map(f => ({
    id: f.id,
    desde: f.desde,
    hasta: f.hasta,
    inscritoIva: f.inscrito_iva === 1,
    obligacionF14: f.obligacion_f14 === 1,
    descripcion: f.descripcion,
    fuente: f.fuente
  }));
}

export function cerrarVigencia(
  db: Database.Database,
  vigenciaId: number,
  hasta: string,
  responsable: string,
  motivo: string
): void {
  validarFechaCalendario(hasta);
  if (!motivo?.trim()) {
    throw new ErrorFiscal('El cierre de vigencia exige motivo');
  }
  const vigencia = db
    .prepare('SELECT id, desde, hasta FROM vigencia_fiscal WHERE id = ?')
    .get(vigenciaId) as { id: number; desde: string; hasta: string | null } | undefined;
  if (!vigencia) {
    throw new ErrorFiscal('Vigencia inexistente');
  }
  if (vigencia.hasta !== null) {
    throw new ErrorFiscal('La vigencia ya está cerrada');
  }
  if (hasta < vigencia.desde) {
    throw new ErrorFiscal('El cierre no puede preceder al inicio de la vigencia');
  }
  const siguiente = db
    .prepare('SELECT desde FROM vigencia_fiscal WHERE desde > ? ORDER BY desde LIMIT 1')
    .get(vigencia.desde) as { desde: string } | undefined;
  if (siguiente && hasta >= siguiente.desde) {
    throw new ErrorFiscal(`El cierre no puede alcanzar la vigencia que inicia en ${siguiente.desde}`);
  }
  db.prepare('UPDATE vigencia_fiscal SET hasta = ? WHERE id = ?').run(hasta, vigenciaId);
  registroEvento(db, responsable, 'vigencia_cerrada', 'vigencia_fiscal', String(vigenciaId), { hasta, motivo });
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
  conciliaDebito: boolean;
  ivaDocumentadoComprasMinor: string;
  creditoAcreditableLibroMinor: string;
  creditoMayorMinor: string;
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
  const ivaCompras = db
    .prepare(
      `SELECT COALESCE(SUM(iva_minor), 0) AS documentado, COALESCE(SUM(iva_credito_minor), 0) AS acreditable
       FROM compra WHERE fecha_operacion BETWEEN ? AND ? AND estado = 'registrada'`
    )
    .get(inicio, fin) as { documentado: number; acreditable: number };
  const ivaDocumentado = BigInt(ivaCompras.documentado);
  const creditoAcreditableLibro = BigInt(ivaCompras.acreditable);
  return {
    mes,
    debitoLibroMinor: minorATexto(debitoLibro),
    debitoMayorMinor: minorATexto(debitoMayor),
    conciliaDebito: debitoLibro === debitoMayor,
    ivaDocumentadoComprasMinor: minorATexto(ivaDocumentado),
    creditoAcreditableLibroMinor: minorATexto(creditoAcreditableLibro),
    creditoMayorMinor: minorATexto(creditoMayor),
    conciliaCredito: creditoAcreditableLibro === creditoMayor,
    nota:
      'El IVA documentado de compras se muestra por separado: solo el IVA acreditable (registrado en la cuenta 1203 según la política vigente al registrar cada compra) se concilia con el mayor. Cambiar la política no reinterpreta compras históricas.'
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
  const pendiente = saldoPendienteDocumento(db, entrada.documentoTipo, entrada.documentoId);
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

export function politicaAnticipoHechoGenerador(db: Database.Database): string {
  const fila = db
    .prepare("SELECT valor FROM configuracion WHERE clave = 'anticipo_hecho_generador'")
    .get() as { valor: string } | undefined;
  return fila?.valor ?? 'pendiente';
}

export const VERSION_EXPORTACION_INTERNA = 'interna-v1';

export const ADVERTENCIA_EXPORTACION =
  'Exportación interna de trabajo. No constituye el formato oficial de ningún formulario o anexo (F-07, F-14 u otros) y no se declara compatible con ellos: requiere verificación contra la plantilla y el manual vigentes del Ministerio de Hacienda antes de cualquier uso tributario.';

export function generarCsvLibro(
  db: Database.Database,
  tipo: 'venta' | 'compra',
  mes: string
): { csv: string; version: string; advertencia: string } {
  const { inicio, fin } = mesRango(mes);
  const tabla = tipo === 'venta' ? 'venta' : 'compra';
  const filas = db
    .prepare(
      `SELECT folio, fecha_operacion, clasificacion_documento, tipo_documento, base_minor, iva_minor, total_minor
       FROM ${tabla} WHERE fecha_operacion BETWEEN ? AND ? AND estado = 'registrada'
       ORDER BY fecha_operacion, id`
    )
    .all(inicio, fin) as Array<{
    folio: string;
    fecha_operacion: string;
    clasificacion_documento: string | null;
    tipo_documento: string | null;
    base_minor: number;
    iva_minor: number;
    total_minor: number;
  }>;
  const incompletos = filas.filter(f => !f.clasificacion_documento || !f.tipo_documento).map(f => f.folio);
  if (incompletos.length > 0) {
    throw new ErrorFiscal(
      `Exportación bloqueada: documentos sin clasificación tributaria o tipo documental: ${incompletos.join(', ')}`
    );
  }
  const lineas = ['folio,fecha,clasificacion,tipo_documento,base,iva,total'];
  for (const f of filas) {
    lineas.push(
      `${f.folio},${f.fecha_operacion},${f.clasificacion_documento},${f.tipo_documento},${minorATexto(BigInt(f.base_minor))},${minorATexto(BigInt(f.iva_minor))},${minorATexto(BigInt(f.total_minor))}`
    );
  }
  return {
    csv: lineas.join('\n'),
    version: VERSION_EXPORTACION_INTERNA,
    advertencia: ADVERTENCIA_EXPORTACION
  };
}

export function guardarCsvArchivo(ruta: string, contenido: string): void {
  if (!/\.csv$/i.test(ruta)) {
    throw new ErrorFiscal('El archivo de exportación interna debe terminar en .csv');
  }
  fs.writeFileSync(ruta, `${contenido}\n`, 'utf8');
}

export function guardarExportacionArchivo(
  db: Database.Database,
  tipo: 'venta' | 'compra',
  mes: string,
  ruta: string
): { guardado: true; ruta: string; version: string; advertencia: string } {
  const exportacion = generarCsvLibro(db, tipo, mes);
  const rutaFinal = path.extname(ruta) === '' ? `${ruta}.csv` : ruta;
  guardarCsvArchivo(rutaFinal, exportacion.csv);
  registroEvento(db, 'sistema', 'exportacion_guardada', 'archivo_csv', rutaFinal, {
    tipo,
    mes,
    nota: 'Exportación interna de trabajo guardada como archivo'
  });
  return { guardado: true, ruta: rutaFinal, version: exportacion.version, advertencia: exportacion.advertencia };
}

export interface FilaEstadoResultados {
  codigo: string;
  nombre: string;
  tipo: string;
  importeMinor: string;
}

export interface EstadoResultados {
  mes: string;
  filas: FilaEstadoResultados[];
  ingresosMinor: string;
  costosGastosMinor: string;
  resultadoMinor: string;
}

export function estadoResultados(db: Database.Database, mes: string): EstadoResultados {
  const { inicio, fin } = mesRango(mes);
  const filas = db
    .prepare(
      `SELECT c.codigo, c.nombre, c.tipo,
              COALESCE(SUM(l.debe_minor - l.haber_minor), 0) AS saldo
       FROM cuenta c
       JOIN asiento_linea l ON l.cuenta_id = c.id
       JOIN asiento a ON a.id = l.asiento_id
       WHERE c.es_grupo = 0 AND c.tipo IN ('ingreso','costo','gasto')
         AND a.fecha_operacion BETWEEN ? AND ?
         AND a.estado IN ('contabilizado','anulado')
         AND ${SQL_FAMILIA_CIERRE_EXCLUIDA}
       GROUP BY c.id
       ORDER BY c.codigo`
    )
    .all(inicio, fin) as Array<{ codigo: string; nombre: string; tipo: string; saldo: number }>;
  let ingresos = 0n;
  let costosGastos = 0n;
  const mapeadas = filas.map(f => {
    const saldo = BigInt(f.saldo);
    const esIngreso = f.tipo === 'ingreso';
    const importe = esIngreso ? -saldo : saldo;
    if (esIngreso) {
      ingresos += importe;
    } else {
      costosGastos += importe;
    }
    return {
      codigo: f.codigo,
      nombre: f.nombre,
      tipo: f.tipo,
      importeMinor: minorATexto(importe)
    };
  });
  return {
    mes,
    filas: mapeadas,
    ingresosMinor: minorATexto(ingresos),
    costosGastosMinor: minorATexto(costosGastos),
    resultadoMinor: minorATexto(ingresos - costosGastos)
  };
}

export interface RentabilidadProyecto {
  id: number;
  codigo: string;
  nombre: string;
  ingresoMinor: string;
  costoMinor: string;
  margenMinor: string;
  totalDocumentalVentaMinor: string;
  totalDocumentalCompraMinor: string;
}

export function rentabilidadProyectos(
  db: Database.Database
): {
  proyectos: RentabilidadProyecto[];
  provisional: boolean;
  nota: string;
  criterio: string;
} {
  const proyectos = db
    .prepare('SELECT id, codigo, nombre FROM proyecto ORDER BY codigo')
    .all() as Array<{ id: number; codigo: string; nombre: string }>;
  const lista = proyectos.map(p => {
    const ingresoMayor = (
      db
        .prepare(
          `SELECT COALESCE(SUM(l.haber_minor - l.debe_minor), 0) AS t
           FROM asiento_linea l
           JOIN asiento a ON a.id = l.asiento_id
           JOIN cuenta c ON c.id = l.cuenta_id
           WHERE c.tipo = 'ingreso'
             AND a.origen_tipo = 'venta'
             AND a.origen_id IN (SELECT folio FROM venta WHERE proyecto_id = ? AND estado = 'registrada')`
        )
        .get(p.id) as { t: number }
    ).t;
    const costoMayor = (
      db
        .prepare(
          `SELECT COALESCE(SUM(l.debe_minor - l.haber_minor), 0) AS t
           FROM asiento_linea l
           JOIN asiento a ON a.id = l.asiento_id
           JOIN cuenta c ON c.id = l.cuenta_id
           WHERE c.tipo IN ('costo','gasto')
             AND a.origen_tipo = 'compra'
             AND a.origen_id IN (SELECT folio FROM compra WHERE proyecto_id = ? AND estado = 'registrada')`
        )
        .get(p.id) as { t: number }
    ).t;
    const totalVenta = (
      db
        .prepare("SELECT COALESCE(SUM(total_minor), 0) AS t FROM venta WHERE proyecto_id = ? AND estado = 'registrada'")
        .get(p.id) as { t: number }
    ).t;
    const totalCompra = (
      db
        .prepare("SELECT COALESCE(SUM(total_minor), 0) AS t FROM compra WHERE proyecto_id = ? AND estado = 'registrada'")
        .get(p.id) as { t: number }
    ).t;
    return {
      id: p.id,
      codigo: p.codigo,
      nombre: p.nombre,
      ingresoMinor: minorATexto(BigInt(ingresoMayor)),
      costoMinor: minorATexto(BigInt(costoMayor)),
      margenMinor: minorATexto(BigInt(ingresoMayor) - BigInt(costoMayor)),
      totalDocumentalVentaMinor: minorATexto(BigInt(totalVenta)),
      totalDocumentalCompraMinor: minorATexto(BigInt(totalCompra))
    };
  });
  const comprasSinProyecto = (
    db
      .prepare("SELECT COUNT(*) AS n FROM compra WHERE proyecto_id IS NULL AND estado = 'registrada'")
      .get() as { n: number }
  ).n;
  return {
    proyectos: lista,
    provisional: comprasSinProyecto > 0,
    nota:
      comprasSinProyecto > 0
        ? 'Hay compras registradas sin proyecto asignado: ningún costo se inventa como cero, por lo que la rentabilidad mostrada es provisional.'
        : 'Todas las compras registradas están asignadas a un proyecto.',
    criterio:
      'La rentabilidad se calcula con los ingresos y costos/gastos reconocidos en asientos vinculados a los documentos del proyecto (coherente con el mayor): el IVA acreditable (1203) no es costo, el IVA al costo sí lo es, y las compras de activo no se convierten en gasto. Los totales documentales se muestran aparte, como métrica informativa.'
  };
}

export interface FilaAuxiliar {
  contraparteId: number;
  contraparteNombre: string;
  saldoMinor: string;
}

export interface AuxiliarContrapartes {
  clientes: FilaAuxiliar[];
  proveedores: FilaAuxiliar[];
  totalClientesMinor: string;
  totalProveedoresMinor: string;
  conciliaMayor: boolean;
}

export function auxiliarContrapartes(db: Database.Database): AuxiliarContrapartes {
  const clientes = db
    .prepare(
      `SELECT p.id, p.nombre,
              COALESCE((
                SELECT SUM(v.total_minor) FROM venta v WHERE v.contraparte_id = p.id AND v.estado = 'registrada'
              ), 0) - COALESCE((
                SELECT SUM(a.monto_minor) FROM aplicacion a
                JOIN tesoreria_movimiento t ON t.id = a.movimiento_id AND t.estado = 'registrado'
                JOIN venta v2 ON v2.id = a.documento_id AND v2.contraparte_id = p.id AND v2.estado = 'registrada'
                WHERE a.documento_tipo = 'venta'
              ), 0) - COALESCE((
                SELECT SUM(aa.monto_minor) FROM aplicacion_anticipo aa
                JOIN venta v3 ON v3.id = aa.documento_id AND v3.contraparte_id = p.id AND v3.estado = 'registrada'
                WHERE aa.documento_tipo = 'venta' AND aa.estado = 'registrada'
              ), 0) AS saldo
       FROM contraparte p
       WHERE p.es_cliente = 1
       ORDER BY p.nombre`
    )
    .all() as Array<{ id: number; nombre: string; saldo: number }>;
  const proveedores = db
    .prepare(
      `SELECT p.id, p.nombre,
              COALESCE((
                SELECT SUM(co.total_minor) FROM compra co WHERE co.contraparte_id = p.id AND co.estado = 'registrada'
              ), 0) - COALESCE((
                SELECT SUM(a.monto_minor) FROM aplicacion a
                JOIN tesoreria_movimiento t ON t.id = a.movimiento_id AND t.estado = 'registrado'
                JOIN compra co2 ON co2.id = a.documento_id AND co2.contraparte_id = p.id AND co2.estado = 'registrada'
                WHERE a.documento_tipo = 'compra'
              ), 0) - COALESCE((
                SELECT SUM(aa.monto_minor) FROM aplicacion_anticipo aa
                JOIN compra co3 ON co3.id = aa.documento_id AND co3.contraparte_id = p.id AND co3.estado = 'registrada'
                WHERE aa.documento_tipo = 'compra' AND aa.estado = 'registrada'
              ), 0) AS saldo
       FROM contraparte p
       WHERE p.es_proveedor = 1
       ORDER BY p.nombre`
    )
    .all() as Array<{ id: number; nombre: string; saldo: number }>;
  const mapear = (f: { id: number; nombre: string; saldo: number }): FilaAuxiliar => ({
    contraparteId: f.id,
    contraparteNombre: f.nombre,
    saldoMinor: minorATexto(BigInt(f.saldo))
  });
  const mapeadasClientes = clientes.filter(f => f.saldo !== 0).map(mapear);
  const mapeadasProveedores = proveedores.filter(f => f.saldo !== 0).map(mapear);
  const totalClientes = mapeadasClientes.reduce((s, f) => s + BigInt(Math.round(Number(f.saldoMinor.replace('.', '')) * 100) / 100), 0n);
  void totalClientes;
  const totalClientesNum = clientes.reduce((s, f) => s + BigInt(f.saldo), 0n);
  const totalProveedoresNum = proveedores.reduce((s, f) => s + BigInt(f.saldo), 0n);
  const saldoMayor1201 = BigInt(
    (db
      .prepare(
        `SELECT COALESCE(SUM(l.debe_minor - l.haber_minor), 0) AS s
         FROM asiento_linea l
         JOIN asiento a ON a.id = l.asiento_id
         JOIN cuenta c ON c.id = l.cuenta_id
         WHERE c.codigo = '1201' AND a.estado IN ('contabilizado','anulado')`
      )
      .get() as { s: number }).s
  );
  const saldoMayor2101 = BigInt(
    (db
      .prepare(
        `SELECT COALESCE(SUM(l.debe_minor - l.haber_minor), 0) AS s
         FROM asiento_linea l
         JOIN asiento a ON a.id = l.asiento_id
         JOIN cuenta c ON c.id = l.cuenta_id
         WHERE c.codigo = '2101' AND a.estado IN ('contabilizado','anulado')`
      )
      .get() as { s: number }).s
  );
  const conciliaClientes = totalClientesNum === saldoMayor1201;
  const conciliaProveedores = totalProveedoresNum === -saldoMayor2101;
  return {
    clientes: mapeadasClientes,
    proveedores: mapeadasProveedores,
    totalClientesMinor: minorATexto(totalClientesNum),
    totalProveedoresMinor: minorATexto(totalProveedoresNum),
    conciliaMayor: conciliaClientes && conciliaProveedores
  };
}

export interface FilaAuxiliarEfectivo {
  cuentaId: number;
  codigo: string;
  nombre: string;
  saldoMinor: string;
}

export interface AuxiliarEfectivo {
  cuentas: FilaAuxiliarEfectivo[];
  totalMinor: string;
  conciliaMayor: boolean;
}

export function auxiliarEfectivo(db: Database.Database): AuxiliarEfectivo {
  const filas = db
    .prepare(
      `SELECT c.id, c.codigo, c.nombre,
              COALESCE(SUM(CASE WHEN a.estado IN ('contabilizado','anulado')
                                THEN l.debe_minor - l.haber_minor ELSE 0 END), 0) AS saldo
       FROM cuenta c
       LEFT JOIN asiento_linea l ON l.cuenta_id = c.id
       LEFT JOIN asiento a ON a.id = l.asiento_id
       WHERE c.es_efectivo = 1 AND c.activa = 1
       GROUP BY c.id, c.codigo, c.nombre
       ORDER BY c.codigo`
    )
    .all() as Array<{ id: number; codigo: string; nombre: string; saldo: number }>;
  const cuentas = filas.map(f => ({
    cuentaId: f.id,
    codigo: f.codigo,
    nombre: f.nombre,
    saldoMinor: minorATexto(BigInt(f.saldo))
  }));
  const totalAuxiliar = filas.reduce((s, f) => s + BigInt(f.saldo), 0n);
  const totalMayor = BigInt(
    (db
      .prepare(
        `SELECT COALESCE(SUM(l.debe_minor - l.haber_minor), 0) AS s
         FROM asiento_linea l
         JOIN asiento a ON a.id = l.asiento_id
         JOIN cuenta c ON c.id = l.cuenta_id
         WHERE c.es_efectivo = 1 AND a.estado IN ('contabilizado','anulado') AND c.activa = 1`
      )
      .get() as { s: number }).s
  );
  return {
    cuentas,
    totalMinor: minorATexto(totalAuxiliar),
    conciliaMayor: totalAuxiliar === totalMayor
  };
}

export interface DetalleAuxiliarDocumento {
  folio: string;
  fecha: string;
  concepto: string;
  totalMinor: string;
  aplicadoMinor: string;
  saldoMinor: string;
}

export interface AuxiliarContraparteDetalle {
  contraparteId: number;
  contraparteNombre: string;
  saldoMinor: string;
  documentos: DetalleAuxiliarDocumento[];
}

export function auxiliarContraparteDetalle(
  db: Database.Database,
  tipo: 'cliente' | 'proveedor',
  contraparteId: number,
  hastaFecha?: string
): AuxiliarContraparteDetalle {
  if (hastaFecha !== undefined) {
    validarFechaCalendario(hastaFecha);
  }
  const esCliente = tipo === 'cliente';
  const tabla = esCliente ? 'venta' : 'compra';
  const docTipo = esCliente ? 'venta' : 'compra';
  const filtroFechaDoc = hastaFecha ? 'AND x.fecha_operacion <= ?' : '';
  const filtroFechaMov = hastaFecha ? 'AND t.fecha_operacion <= ?' : '';
  const filtroFechaAnt = hastaFecha ? 'AND aa.fecha_operacion <= ?' : '';
  const params = hastaFecha ? [hastaFecha, hastaFecha, contraparteId, hastaFecha] : [contraparteId];
  const documentos = db
    .prepare(
      `SELECT x.folio, x.fecha_operacion, x.concepto, x.total_minor,
              COALESCE((SELECT SUM(a.monto_minor) FROM aplicacion a
                JOIN tesoreria_movimiento t ON t.id = a.movimiento_id AND t.estado = 'registrado'
                WHERE a.documento_tipo = '${docTipo}' AND a.documento_id = x.id ${filtroFechaMov}), 0)
              + COALESCE((SELECT SUM(aa.monto_minor) FROM aplicacion_anticipo aa
                WHERE aa.documento_tipo = '${docTipo}' AND aa.documento_id = x.id AND aa.estado = 'registrada' ${filtroFechaAnt}), 0) AS aplicado
       FROM ${tabla} x
       WHERE x.contraparte_id = ? AND x.estado = 'registrada' ${filtroFechaDoc}
       ORDER BY x.fecha_operacion, x.id`
    )
    .all(...params) as Array<{
    folio: string;
    fecha_operacion: string;
    concepto: string;
    total_minor: number;
    aplicado: number;
  }>;
  const detalle = documentos.map(d => ({
    folio: d.folio,
    fecha: d.fecha_operacion,
    concepto: d.concepto,
    totalMinor: minorATexto(BigInt(d.total_minor)),
    aplicadoMinor: minorATexto(BigInt(d.aplicado)),
    saldoMinor: minorATexto(BigInt(d.total_minor) - BigInt(d.aplicado))
  }));
  const saldoTotal = detalle.reduce((s, d) => s + parseMontoMinor(d.saldoMinor), 0n);
  const nombre = (db.prepare('SELECT nombre FROM contraparte WHERE id = ?').get(contraparteId) as { nombre: string }).nombre;
  return {
    contraparteId,
    contraparteNombre: nombre,
    saldoMinor: minorATexto(saldoTotal),
    documentos: detalle
  };
}

export function escaparCsv(valor: string): string {
  if (/[",\n\r]/.test(valor)) {
    return `"${valor.replace(/"/g, '""')}"`;
  }
  return valor;
}

export function exportarCsvAuxiliar(
  db: Database.Database,
  tipo: 'cliente' | 'proveedor' | 'efectivo'
): { csv: string; version: string } {
  const lineas: string[] = [];
  if (tipo === 'efectivo') {
    const aux = auxiliarEfectivo(db);
    lineas.push('cuenta,nombre,saldo');
    for (const c of aux.cuentas) {
      lineas.push(`${escaparCsv(c.codigo)},${escaparCsv(c.nombre)},${c.saldoMinor}`);
    }
    lineas.push(`TOTAL,,${aux.totalMinor}`);
  } else {
    const aux = auxiliarContrapartes(db);
    const filas = tipo === 'cliente' ? aux.clientes : aux.proveedores;
    const etiqueta = tipo === 'cliente' ? 'cliente' : 'proveedor';
    lineas.push(`${etiqueta},saldo`);
    for (const f of filas) {
      lineas.push(`${escaparCsv(f.contraparteNombre)},${f.saldoMinor}`);
    }
    const total = tipo === 'cliente' ? aux.totalClientesMinor : aux.totalProveedoresMinor;
    lineas.push(`TOTAL,${total}`);
  }
  return {
    csv: lineas.join('\n'),
    version: 'auxiliar-interno-v1'
  };
}

export function exportarCsvAuxiliarDetalle(
  db: Database.Database,
  tipo: 'cliente' | 'proveedor',
  contraparteId: number,
  hastaFecha?: string
): { csv: string; version: string } {
  const detalle = auxiliarContraparteDetalle(db, tipo, contraparteId, hastaFecha);
  const lineas: string[] = [];
  lineas.push('folio,fecha,concepto,total,aplicado,saldo');
  for (const d of detalle.documentos) {
    lineas.push(
      [d.folio, d.fecha, d.concepto, d.totalMinor, d.aplicadoMinor, d.saldoMinor]
        .map(escaparCsv)
        .join(',')
    );
  }
  lineas.push(`TOTAL,,,,,${detalle.saldoMinor}`);
  return {
    csv: lineas.join('\n'),
    version: `auxiliar-detalle-${hastaFecha ?? 'actual'}`
  };
}

export interface EntradaAjuste {
  fechaOperacion: string;
  concepto: string;
  lineas: Array<{ cuentaCodigo: string; debeMinor: string; haberMinor: string }>;
  referencia: string;
  claveIdempotencia: string;
  responsable: string;
}

export function registrarAjuste(
  db: Database.Database,
  entrada: EntradaAjuste
): { id: number; folio: string; duplicado: boolean; estado: string } {
  if (!entrada.referencia?.trim()) {
    throw new ErrorFiscal('El ajuste exige referencia de soporte');
  }
  const previo = db
    .prepare('SELECT id, folio FROM asiento WHERE clave_idempotencia = ?')
    .get(`${entrada.claveIdempotencia}:ajuste`) as { id: number; folio: string } | undefined;
  if (previo) {
    return { id: previo.id, folio: previo.folio, duplicado: true, estado: 'contabilizado' };
  }
  const lineasAsiento = entrada.lineas.map(l => {
    const cuenta = db
      .prepare('SELECT id FROM cuenta WHERE codigo = ? AND es_grupo = 0 AND activa = 1')
      .get(l.cuentaCodigo) as { id: number } | undefined;
    if (!cuenta) {
      throw new ErrorFiscal(`Cuenta inválida o inactiva para ajuste: ${l.cuentaCodigo}`);
    }
    return {
      cuentaId: cuenta.id,
      debeMinor: l.debeMinor || '',
      haberMinor: l.haberMinor || ''
    };
  });
  const asiento = contabilizarAsiento(db, {
    fechaOperacion: entrada.fechaOperacion,
    concepto: entrada.concepto,
    lineas: lineasAsiento,
    origenTipo: 'ajuste',
    origenId: entrada.claveIdempotencia,
    claveIdempotencia: `${entrada.claveIdempotencia}:ajuste`,
    responsable: entrada.responsable,
    ambitoId: 'administrativo'
  });
  db.prepare('UPDATE asiento SET motivo = ? WHERE id = ?').run(entrada.referencia.trim(), asiento.asientoId);
  registroEvento(db, entrada.responsable, 'ajuste_registrado', 'asiento', String(asiento.asientoId), {
    folio: asiento.folio,
    concepto: entrada.concepto,
    referencia: entrada.referencia
  });
  return { id: asiento.asientoId, folio: asiento.folio, duplicado: false, estado: 'contabilizado' };
}
