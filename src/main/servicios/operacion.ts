import type Database from 'better-sqlite3';
import { parseMontoMinor, parseTasa, desglosarIvaSeparado, desglosarIvaIncluido, minorATexto, multiplicarLinea } from '../../shared/dinero';
import { validarFechaCalendario } from '../../shared/fechas';
import { inscritoIvaEnFecha } from './fiscal';
import { aplicacionesActivasDocumento } from './saldos';
import type { ContraparteResumen, ProyectoResumen, VentaResumen, CompraResumen } from '../../shared/contratos';
import { contabilizarAsiento, anularAsiento, ErrorContable } from './motorAsientos';
import { registroEvento } from './bitacora';

export class ErrorOperacion extends Error {}

function configValor(db: Database.Database, clave: string): string | null {
  const fila = db.prepare('SELECT valor FROM configuracion WHERE clave = ?').get(clave) as { valor: string | null } | undefined;
  return fila?.valor ?? null;
}

export function perfilIvaInscrito(db: Database.Database): boolean {
  return configValor(db, 'perfil_iva_inscrito') === '1';
}

export function ivaComprasCreditoFiscal(db: Database.Database): boolean {
  return configValor(db, 'iva_compras_credito_fiscal') === '1';
}

export function crearContraparte(
  db: Database.Database,
  entrada: { nombre: string; esCliente: boolean; esProveedor: boolean; nrc?: string; nit?: string; clasificacionTributaria?: string; notas?: string; responsable: string }
): number {
  if (!entrada.nombre?.trim()) {
    throw new ErrorOperacion('La contraparte requiere nombre');
  }
  if (!entrada.esCliente && !entrada.esProveedor) {
    throw new ErrorOperacion('La contraparte debe ser cliente, proveedor o ambos');
  }
  const info = db
    .prepare(
      `INSERT INTO contraparte (nombre, es_cliente, es_proveedor, nrc, nit, clasificacion_tributaria, notas)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      entrada.nombre.trim(),
      entrada.esCliente ? 1 : 0,
      entrada.esProveedor ? 1 : 0,
      entrada.nrc?.trim() || null,
      entrada.nit?.trim() || null,
      entrada.clasificacionTributaria?.trim() || null,
      entrada.notas?.trim() || null
    );
  registroEvento(db, entrada.responsable, 'contraparte_creada', 'contraparte', String(info.lastInsertRowid), { nombre: entrada.nombre });
  return Number(info.lastInsertRowid);
}

export function listarContrapartes(db: Database.Database): ContraparteResumen[] {
  const filas = db
    .prepare('SELECT id, nombre, es_cliente, es_proveedor, nrc, nit, activa FROM contraparte ORDER BY nombre')
    .all() as Array<{
    id: number;
    nombre: string;
    es_cliente: number;
    es_proveedor: number;
    nrc: string | null;
    nit: string | null;
    activa: number;
  }>;
  return filas.map(f => ({
    id: f.id,
    nombre: f.nombre,
    esCliente: f.es_cliente === 1,
    esProveedor: f.es_proveedor === 1,
    nrc: f.nrc,
    nit: f.nit,
    activa: f.activa === 1
  }));
}

export function crearProyecto(
  db: Database.Database,
  entrada: { codigo: string; nombre: string; contraparteId: number; cotizacionId?: number; alcance?: string; responsable: string }
): number {
  if (!/^[A-Z0-9-]{2,12}$/.test(entrada.codigo)) {
    throw new ErrorOperacion('Código de proyecto inválido (mayúsculas, números y guiones)');
  }
  if (!entrada.nombre?.trim()) {
    throw new ErrorOperacion('El proyecto requiere nombre');
  }
  const existente = db.prepare('SELECT id FROM proyecto WHERE codigo = ?').get(entrada.codigo);
  if (existente) {
    throw new ErrorOperacion(`Ya existe el proyecto ${entrada.codigo}`);
  }
  const contraparte = db.prepare('SELECT id FROM contraparte WHERE id = ?').get(entrada.contraparteId);
  if (!contraparte) {
    throw new ErrorOperacion('Contraparte inexistente');
  }
  if (entrada.cotizacionId) {
    const cot = db
      .prepare("SELECT id FROM cotizacion WHERE id = ? AND estado = 'aprobada'")
      .get(entrada.cotizacionId) as { id: number } | undefined;
    if (!cot) {
      throw new ErrorOperacion('Solo se vincula una cotización aprobada');
    }
  }
  const info = db
    .prepare(
      'INSERT INTO proyecto (codigo, nombre, contraparte_id, cotizacion_id, alcance, responsable) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .run(entrada.codigo, entrada.nombre.trim(), entrada.contraparteId, entrada.cotizacionId ?? null, entrada.alcance?.trim() ?? null, entrada.responsable.trim());
  registroEvento(db, entrada.responsable, 'proyecto_creado', 'proyecto', String(info.lastInsertRowid), { codigo: entrada.codigo });
  return Number(info.lastInsertRowid);
}

export function listarProyectos(db: Database.Database): ProyectoResumen[] {
  const filas = db
    .prepare(
      `SELECT pr.id, pr.codigo, pr.nombre, c.nombre AS contraparte, pr.estado
       FROM proyecto pr JOIN contraparte c ON c.id = pr.contraparte_id ORDER BY pr.codigo`
    )
    .all() as Array<{ id: number; codigo: string; nombre: string; contraparte: string; estado: string }>;
  return filas.map(f => ({
    id: f.id,
    codigo: f.codigo,
    nombre: f.nombre,
    contraparteNombre: f.contraparte,
    estado: f.estado
  }));
}

export interface LineaCompraEntrada {
  descripcion: string;
  cuentaCodigo: string;
  cantidad: string;
  precioUnitario: string;
  tasa: string;
  tratamiento: 'gravado' | 'exento' | 'no_sujeto';
  precioConIva?: boolean;
}

interface LineaCompraCalculada {
  cuentaId: number;
  base: bigint;
  iva: bigint;
  total: bigint;
  entrada: LineaCompraEntrada;
  precioConIva: boolean;
  tasaPb: number;
}

function calcularLineasCompra(db: Database.Database, lineas: LineaCompraEntrada[]): LineaCompraCalculada[] {
  if (!Array.isArray(lineas) || lineas.length === 0) {
    throw new ErrorOperacion('La compra requiere al menos una línea');
  }
  return lineas.map(l => {
    if (!l.descripcion?.trim()) {
      throw new ErrorOperacion('Cada línea de compra requiere descripción');
    }
    const cuenta = db
      .prepare('SELECT id, tipo, es_grupo, activa FROM cuenta WHERE codigo = ?')
      .get(l.cuentaCodigo) as { id: number; tipo: string; es_grupo: number; activa: number } | undefined;
    if (!cuenta || cuenta.es_grupo === 1 || cuenta.activa === 0) {
      throw new ErrorOperacion(`Cuenta de costo/gasto inválida: ${l.cuentaCodigo}`);
    }
    if (!['costo', 'gasto', 'activo'].includes(cuenta.tipo)) {
      throw new ErrorOperacion(`La cuenta ${l.cuentaCodigo} no es de costo, gasto o activo`);
    }
    const cantidad = parseMontoMinor(l.cantidad);
    const precio = parseMontoMinor(l.precioUnitario);
    if (cantidad <= 0n || precio <= 0n) {
      throw new ErrorOperacion('Cantidad y precio deben ser mayores que cero');
    }
    const bruto = multiplicarLinea(cantidad, precio);
    const tasa = parseTasa(l.tasa);
    const precioConIva = l.precioConIva === true;
    if (l.tratamiento !== 'gravado') {
      return { cuentaId: cuenta.id, base: bruto, iva: 0n, total: bruto, entrada: l, precioConIva, tasaPb: 0 };
    }
    const d = precioConIva ? desglosarIvaIncluido(bruto, tasa) : desglosarIvaSeparado(bruto, tasa);
    return { cuentaId: cuenta.id, base: d.base, iva: d.iva, total: d.total, entrada: l, precioConIva, tasaPb: Number(tasa.puntosBase) };
  });
}

export function registrarCompra(
  db: Database.Database,
  entrada: {
    contraparteId: number;
    proyectoId?: number;
    fechaOperacion: string;
    concepto: string;
    condicion: 'contado' | 'credito';
    lineas: LineaCompraEntrada[];
    clasificacionDocumento?: ClasificacionDocumento;
    tipoDocumento?: TipoDocumento;
    claveIdempotencia: string;
    responsable: string;
  }
): { id: number; folio: string; duplicado: boolean } {
  validarFechaCalendario(entrada.fechaOperacion);
  const previa = db
    .prepare('SELECT id, folio FROM compra WHERE clave_idempotencia = ?')
    .get(entrada.claveIdempotencia) as { id: number; folio: string } | undefined;
  if (previa) {
    return { id: previa.id, folio: previa.folio, duplicado: true };
  }
  const proveedor = db
    .prepare('SELECT id FROM contraparte WHERE id = ? AND es_proveedor = 1 AND activa = 1')
    .get(entrada.contraparteId) as { id: number } | undefined;
  if (!proveedor) {
    throw new ErrorOperacion('La contraparte no es un proveedor activo');
  }
  if (!entrada.concepto?.trim()) {
    throw new ErrorOperacion('La compra requiere concepto');
  }
  const lineas = calcularLineasCompra(db, entrada.lineas);
  const creditoFiscal = ivaComprasCreditoFiscal(db);
  const cuentaProveedores = (db.prepare("SELECT id FROM cuenta WHERE codigo = '2101'").get() as { id: number }).id;
  const cuentaIvaCredito = (db.prepare("SELECT id FROM cuenta WHERE codigo = '1203'").get() as { id: number }).id;

  let baseTotal = 0n;
  let ivaTotal = 0n;
  let total = 0n;
  const porCuenta = new Map<number, bigint>();
  for (const l of lineas) {
    baseTotal += l.base;
    ivaTotal += l.iva;
    total += l.total;
    const destino = creditoFiscal ? l.base : l.total;
    porCuenta.set(l.cuentaId, (porCuenta.get(l.cuentaId) ?? 0n) + destino);
  }
  const ivaCredito = creditoFiscal ? ivaTotal : 0n;

  const lineasAsiento = Array.from(porCuenta.entries()).map(([cuentaId, monto]) => ({
    cuentaId,
    debeMinor: minorATexto(monto),
    haberMinor: ''
  }));
  if (creditoFiscal && ivaTotal > 0n) {
    lineasAsiento.push({ cuentaId: cuentaIvaCredito, debeMinor: minorATexto(ivaTotal), haberMinor: '' });
  }
  lineasAsiento.push({ cuentaId: cuentaProveedores, debeMinor: '', haberMinor: minorATexto(total) });

  const tx = db.transaction((): { id: number; folio: string; duplicado: boolean } => {
    const n = (db.prepare('SELECT COUNT(*) AS n FROM compra').get() as { n: number }).n;
    const folio = `CMP-${String(n + 1).padStart(6, '0')}`;
    const asiento = contabilizarAsiento(db, {
      fechaOperacion: entrada.fechaOperacion,
      concepto: `Compra ${folio}: ${entrada.concepto}`,
      lineas: lineasAsiento,
      origenTipo: 'compra',
      origenId: folio,
      claveIdempotencia: `${entrada.claveIdempotencia}:asiento`,
      responsable: entrada.responsable,
      ambitoId: 'administrativo'
    });
    const info = db
      .prepare(
        `INSERT INTO compra (folio, contraparte_id, proyecto_id, fecha_operacion, concepto, condicion,
          base_minor, iva_minor, iva_credito_minor, total_minor, asiento_id, clave_idempotencia, responsable,
          clasificacion_documento, tipo_documento)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        folio,
        entrada.contraparteId,
        entrada.proyectoId ?? null,
        entrada.fechaOperacion,
        entrada.concepto.trim(),
        entrada.condicion,
        baseTotal,
        ivaTotal,
        ivaCredito,
        total,
        asiento.asientoId,
        entrada.claveIdempotencia,
        entrada.responsable.trim(),
        entrada.clasificacionDocumento ?? null,
        entrada.tipoDocumento ?? null
      );
    const compraId = Number(info.lastInsertRowid);
    const insertarLinea = db.prepare(
      `INSERT INTO compra_linea (compra_id, descripcion, cuenta_id, cantidad, precio_unitario_minor, tasa_puntos_base, tratamiento, base_minor, iva_minor, total_minor)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const l of lineas) {
      insertarLinea.run(
        compraId,
        l.entrada.descripcion.trim(),
        l.cuentaId,
        l.entrada.cantidad,
        parseMontoMinor(l.entrada.precioUnitario),
        l.tasaPb,
        l.entrada.tratamiento,
        l.base,
        l.iva,
        l.total
      );
    }
    registroEvento(db, entrada.responsable, 'compra_registrada', 'compra', String(compraId), { folio, total: minorATexto(total) });
    return { id: compraId, folio, duplicado: false };
  });
  return tx();
}

export type ClasificacionDocumento = 'contribuyente' | 'consumidor_final' | 'otro';
export type TipoDocumento = 'factura' | 'ccf' | 'recibo' | 'otro';

export function registrarVenta(
  db: Database.Database,
  entrada: {
    contraparteId: number;
    proyectoId?: number;
    fechaOperacion: string;
    concepto: string;
    tipoIngreso: 'instalaciones' | 'oym';
    base: string;
    tasa: string;
    clasificacionDocumento?: ClasificacionDocumento;
    tipoDocumento?: TipoDocumento;
    claveIdempotencia: string;
    responsable: string;
  }
): { id: number; folio: string; duplicado: boolean } {
  validarFechaCalendario(entrada.fechaOperacion);
  const previa = db
    .prepare('SELECT id, folio FROM venta WHERE clave_idempotencia = ?')
    .get(entrada.claveIdempotencia) as { id: number; folio: string } | undefined;
  if (previa) {
    return { id: previa.id, folio: previa.folio, duplicado: true };
  }
  const cliente = db
    .prepare('SELECT id FROM contraparte WHERE id = ? AND es_cliente = 1 AND activa = 1')
    .get(entrada.contraparteId) as { id: number } | undefined;
  if (!cliente) {
    throw new ErrorOperacion('La contraparte no es un cliente activo');
  }
  const base = parseMontoMinor(entrada.base);
  if (base <= 0n) {
    throw new ErrorOperacion('La base debe ser mayor que cero');
  }
  const tasa = parseTasa(entrada.tasa);
  const inscrito = inscritoIvaEnFecha(db, entrada.fechaOperacion);
  let iva = 0n;
  if (tasa.puntosBase > 0n) {
    if (!inscrito) {
      throw new ErrorOperacion(
        'No se registra IVA débito fiscal sin inscripción vigente; registre la operación sin IVA o active el perfil cuando exista la vigencia'
      );
    }
    iva = desglosarIvaSeparado(base, tasa).iva;
  }
  const total = base + iva;
  const cuentaClientes = (db.prepare("SELECT id FROM cuenta WHERE codigo = '1201'").get() as { id: number }).id;
  const cuentaIngreso = (db.prepare("SELECT id FROM cuenta WHERE codigo = ?").get(entrada.tipoIngreso === 'oym' ? '4102' : '4101') as { id: number }).id;
  const cuentaIvaDebito = (db.prepare("SELECT id FROM cuenta WHERE codigo = '2201'").get() as { id: number }).id;

  const lineasAsiento = [
    { cuentaId: cuentaClientes, debeMinor: minorATexto(total), haberMinor: '' },
    { cuentaId: cuentaIngreso, debeMinor: '', haberMinor: minorATexto(base) }
  ];
  if (iva > 0n) {
    lineasAsiento.push({ cuentaId: cuentaIvaDebito, debeMinor: '', haberMinor: minorATexto(iva) });
  }

  const tx = db.transaction((): { id: number; folio: string; duplicado: boolean } => {
    const n = (db.prepare('SELECT COUNT(*) AS n FROM venta').get() as { n: number }).n;
    const folio = `V-${String(n + 1).padStart(6, '0')}`;
    const asiento = contabilizarAsiento(db, {
      fechaOperacion: entrada.fechaOperacion,
      concepto: `Venta ${folio}: ${entrada.concepto}`,
      lineas: lineasAsiento,
      origenTipo: 'venta',
      origenId: folio,
      claveIdempotencia: `${entrada.claveIdempotencia}:asiento`,
      responsable: entrada.responsable,
      ambitoId: 'administrativo'
    });
    const info = db
      .prepare(
        `INSERT INTO venta (folio, contraparte_id, proyecto_id, fecha_operacion, concepto, tipo_ingreso,
          base_minor, iva_minor, total_minor, asiento_id, clave_idempotencia, responsable,
          clasificacion_documento, tipo_documento)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        folio,
        entrada.contraparteId,
        entrada.proyectoId ?? null,
        entrada.fechaOperacion,
        entrada.concepto.trim(),
        entrada.tipoIngreso,
        base,
        iva,
        total,
        asiento.asientoId,
        entrada.claveIdempotencia,
        entrada.responsable.trim(),
        entrada.clasificacionDocumento ?? null,
        entrada.tipoDocumento ?? null
      );
    const ventaId = Number(info.lastInsertRowid);
    registroEvento(db, entrada.responsable, 'venta_registrada', 'venta', String(ventaId), { folio, total: minorATexto(total) });
    return { id: ventaId, folio, duplicado: false };
  });
  return tx();
}

export { saldoPendienteDocumento, aplicacionesActivasDocumento } from './saldos';

export function anularDocumento(
  db: Database.Database,
  tipo: 'venta' | 'compra',
  documentoId: number,
  responsable: string,
  motivo: string
): void {
  const tabla = tipo === 'venta' ? 'venta' : 'compra';
  const doc = db
    .prepare(`SELECT id, folio, asiento_id, estado FROM ${tabla} WHERE id = ?`)
    .get(documentoId) as { id: number; folio: string; asiento_id: number; estado: string } | undefined;
  if (!doc) {
    throw new ErrorOperacion('Documento inexistente');
  }
  if (doc.estado !== 'registrada') {
    throw new ErrorOperacion(`El documento ${doc.folio} no está registrado`);
  }
  const conAplicaciones = aplicacionesActivasDocumento(db, tipo, documentoId);
  if (conAplicaciones > 0) {
    throw new ErrorOperacion(`El documento ${doc.folio} tiene cobros o pagos aplicados; anúlelos primero`);
  }
  const tx = db.transaction(() => {
    anularAsiento(db, doc.asiento_id, responsable, `Anulación de ${doc.folio}: ${motivo}`, true);
    db.prepare(`UPDATE ${tabla} SET estado = 'anulada' WHERE id = ?`).run(documentoId);
    registroEvento(db, responsable, `${tipo}_anulada`, tipo, String(documentoId), { folio: doc.folio, motivo });
  });
  tx();
}

export function listarCompras(db: Database.Database): CompraResumen[] {
  const filas = db
    .prepare(
      `SELECT co.id, co.folio, co.fecha_operacion, co.concepto, co.contraparte_id, p.nombre AS contraparte, co.total_minor, co.estado,
              (co.total_minor
                - COALESCE((SELECT SUM(a.monto_minor) FROM aplicacion a
                  JOIN tesoreria_movimiento t ON t.id = a.movimiento_id
                  WHERE a.documento_tipo = 'compra' AND a.documento_id = co.id AND t.estado = 'registrado'), 0)
                - COALESCE((SELECT SUM(aa.monto_minor) FROM aplicacion_anticipo aa
                  WHERE aa.documento_tipo = 'compra' AND aa.documento_id = co.id AND aa.estado = 'registrada'), 0)) AS saldo
       FROM compra co JOIN contraparte p ON p.id = co.contraparte_id ORDER BY co.id DESC LIMIT 100`
    )
    .all() as Array<{
    id: number;
    folio: string;
    fecha_operacion: string;
    concepto: string;
    contraparte_id: number;
    contraparte: string;
    total_minor: number;
    saldo: number;
    estado: string;
  }>;
  return filas.map(f => ({
    id: f.id,
    folio: f.folio,
    fecha: f.fecha_operacion,
    concepto: f.concepto,
    contraparteId: f.contraparte_id,
    contraparteNombre: f.contraparte,
    totalMinor: minorATexto(BigInt(f.total_minor)),
    saldoMinor: minorATexto(BigInt(f.saldo)),
    estado: f.estado
  }));
}

export function listarVentas(db: Database.Database): VentaResumen[] {
  const filas = db
    .prepare(
      `SELECT v.id, v.folio, v.fecha_operacion, v.concepto, v.contraparte_id, p.nombre AS contraparte, v.total_minor, v.estado,
              (v.total_minor
                - COALESCE((SELECT SUM(a.monto_minor) FROM aplicacion a
                  JOIN tesoreria_movimiento t ON t.id = a.movimiento_id
                  WHERE a.documento_tipo = 'venta' AND a.documento_id = v.id AND t.estado = 'registrado'), 0)
                - COALESCE((SELECT SUM(aa.monto_minor) FROM aplicacion_anticipo aa
                  WHERE aa.documento_tipo = 'venta' AND aa.documento_id = v.id AND aa.estado = 'registrada'), 0)) AS saldo
       FROM venta v JOIN contraparte p ON p.id = v.contraparte_id ORDER BY v.id DESC LIMIT 100`
    )
    .all() as Array<{
    id: number;
    folio: string;
    fecha_operacion: string;
    concepto: string;
    contraparte_id: number;
    contraparte: string;
    total_minor: number;
    saldo: number;
    estado: string;
  }>;
  return filas.map(f => ({
    id: f.id,
    folio: f.folio,
    fecha: f.fecha_operacion,
    concepto: f.concepto,
    contraparteId: f.contraparte_id,
    contraparteNombre: f.contraparte,
    totalMinor: minorATexto(BigInt(f.total_minor)),
    saldoMinor: minorATexto(BigInt(f.saldo)),
    estado: f.estado
  }));
}
