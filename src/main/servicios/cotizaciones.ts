import type Database from 'better-sqlite3';
import { parseMontoMinor, parseTasa, desglosarIvaIncluido, desglosarIvaSeparado, minorATexto } from '../../shared/dinero';
import { validarFechaCalendario } from '../../shared/fechas';
import { registroEvento } from './bitacora';

export class ErrorCotizacion extends Error {}

export interface LineaCotizacionEntrada {
  tipo: 'servicio' | 'material';
  descripcion: string;
  cantidad: string;
  precioUnitario: string;
  precioConIva: boolean;
  tasa: string;
}

export interface LineaCotizacionCalculada {
  base: bigint;
  iva: bigint;
  total: bigint;
}

export function calcularLinea(linea: LineaCotizacionEntrada): LineaCotizacionCalculada {
  if (!linea.descripcion?.trim()) {
    throw new ErrorCotizacion('Cada línea requiere descripción');
  }
  const cantidad = parseMontoMinor(linea.cantidad, 2);
  if (cantidad <= 0n) {
    throw new ErrorCotizacion('La cantidad debe ser mayor que cero');
  }
  const precioUnitario = parseMontoMinor(linea.precioUnitario);
  if (precioUnitario <= 0n) {
    throw new ErrorCotizacion('El precio unitario debe ser mayor que cero');
  }
  const tasa = parseTasa(linea.tasa);
  const bruto = (cantidad * precioUnitario) / 100n;
  if (linea.precioConIva) {
    if (tasa.puntosBase === 0n) {
      throw new ErrorCotizacion('Un precio con IVA incluye exige tasa mayor que cero');
    }
    return desglosarIvaIncluido(bruto, tasa);
  }
  return desglosarIvaSeparado(bruto, tasa);
}

export interface CotizacionResumen {
  id: number;
  numero: string;
  revision: number;
  contraparteId: number;
  contraparteNombre: string;
  fecha: string;
  estado: string;
  congelada: boolean;
  baseMinor: string;
  ivaMinor: string;
  totalMinor: string;
  condiciones: string | null;
}

interface FilaCotizacion {
  id: number;
  numero: string;
  revision: number;
  contraparte_id: number;
  contraparte_nombre: string;
  fecha: string;
  estado: string;
  congelada: number;
  condiciones: string | null;
  base: number | null;
  iva: number | null;
  total: number | null;
}

function mapear(f: FilaCotizacion): CotizacionResumen {
  return {
    id: f.id,
    numero: f.numero,
    revision: f.revision,
    contraparteId: f.contraparte_id,
    contraparteNombre: f.contraparte_nombre,
    fecha: f.fecha,
    estado: f.estado,
    congelada: f.congelada === 1,
    condiciones: f.condiciones,
    baseMinor: minorATexto(BigInt(f.base ?? 0)),
    ivaMinor: minorATexto(BigInt(f.iva ?? 0)),
    totalMinor: minorATexto(BigInt(f.total ?? 0))
  };
}

const SELECT_COTIZACION = `SELECT c.id, c.numero, c.revision, c.contraparte_id, p.nombre AS contraparte_nombre,
  c.fecha, c.estado, c.congelada, c.condiciones,
  COALESCE(SUM(l.base_minor), 0) AS base,
  COALESCE(SUM(l.iva_minor), 0) AS iva,
  COALESCE(SUM(l.total_minor), 0) AS total
  FROM cotizacion c
  JOIN contraparte p ON p.id = c.contraparte_id
  LEFT JOIN cotizacion_linea l ON l.cotizacion_id = c.id`;

export function crearCotizacion(
  db: Database.Database,
  entrada: { contraparteId: number; fecha: string; condiciones?: string; responsable: string; lineas: LineaCotizacionEntrada[] }
): { id: number; numero: string; revision: number } {
  validarFechaCalendario(entrada.fecha);
  if (!entrada.responsable?.trim()) {
    throw new ErrorCotizacion('La cotización requiere responsable');
  }
  const contraparte = db
    .prepare('SELECT id FROM contraparte WHERE id = ? AND activa = 1')
    .get(entrada.contraparteId) as { id: number } | undefined;
  if (!contraparte) {
    throw new ErrorCotizacion('Contraparte inexistente o inactiva');
  }
  if (!Array.isArray(entrada.lineas) || entrada.lineas.length === 0) {
    throw new ErrorCotizacion('La cotización requiere al menos una línea');
  }
  const calculadas = entrada.lineas.map(calcularLinea);

  const tx = db.transaction(() => {
    const n = (db.prepare('SELECT COUNT(*) AS n FROM cotizacion').get() as { n: number }).n;
    const numero = `C-${String(n + 1).padStart(6, '0')}`;
    const info = db
      .prepare(
        `INSERT INTO cotizacion (numero, revision, contraparte_id, fecha, condiciones, responsable)
         VALUES (?, 1, ?, ?, ?, ?)`
      )
      .run(numero, entrada.contraparteId, entrada.fecha, entrada.condiciones?.trim() ?? null, entrada.responsable.trim());
    const id = Number(info.lastInsertRowid);
    const insertar = db.prepare(
      `INSERT INTO cotizacion_linea
       (cotizacion_id, tipo, descripcion, cantidad, precio_unitario_minor, precio_con_iva, tasa_puntos_base, base_minor, iva_minor, total_minor, orden)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    entrada.lineas.forEach((l, i) => {
      const c = calculadas[i];
      if (!c) {
        throw new ErrorCotizacion('Línea sin cálculo');
      }
      insertar.run(
        id,
        l.tipo,
        l.descripcion.trim(),
        l.cantidad,
        parseMontoMinor(l.precioUnitario),
        l.precioConIva ? 1 : 0,
        Number(parseTasa(l.tasa).puntosBase),
        c.base,
        c.iva,
        c.total,
        i + 1
      );
    });
    registroEvento(db, entrada.responsable, 'cotizacion_creada', 'cotizacion', String(id), { numero });
    return { id, numero, revision: 1 };
  });
  return tx();
}

export function crearRevision(db: Database.Database, cotizacionId: number, responsable: string): { id: number; numero: string; revision: number } {
  const original = db
    .prepare('SELECT id, numero, revision, estado FROM cotizacion WHERE id = ?')
    .get(cotizacionId) as { id: number; numero: string; revision: number; estado: string } | undefined;
  if (!original) {
    throw new ErrorCotizacion('Cotización inexistente');
  }
  if (original.estado === 'aprobada') {
    throw new ErrorCotizacion('No se crean revisiones sobre una cotización aprobada; use una nueva cotización');
  }
  const tx = db.transaction(() => {
    const n = (db.prepare('SELECT COUNT(*) AS n FROM cotizacion').get() as { n: number }).n;
    const numero = `C-${String(n + 1).padStart(6, '0')}`;
    const info = db
      .prepare(
        `INSERT INTO cotizacion (numero, revision, contraparte_id, fecha, condiciones, responsable)
         SELECT ?, ?, contraparte_id, fecha, condiciones, ? FROM cotizacion WHERE id = ?`
      )
      .run(numero, original.revision + 1, responsable, cotizacionId);
    const nueva = Number(info.lastInsertRowid);
    db.prepare(
      `INSERT INTO cotizacion_linea
       (cotizacion_id, tipo, descripcion, cantidad, precio_unitario_minor, precio_con_iva, tasa_puntos_base, base_minor, iva_minor, total_minor, orden)
       SELECT ?, tipo, descripcion, cantidad, precio_unitario_minor, precio_con_iva, tasa_puntos_base, base_minor, iva_minor, total_minor, orden
       FROM cotizacion_linea WHERE cotizacion_id = ?`
    ).run(nueva, cotizacionId);
    registroEvento(db, responsable, 'cotizacion_revision', 'cotizacion', String(nueva), {
      base: cotizacionId,
      revision: original.revision + 1
    });
    return { id: nueva, numero, revision: original.revision + 1 };
  });
  return tx();
}

export function aprobarCotizacion(db: Database.Database, cotizacionId: number, responsable: string): void {
  const cambiado = db
    .prepare(
      "UPDATE cotizacion SET estado = 'aprobada', congelada = 1 WHERE id = ? AND estado = 'borrador'"
    )
    .run(cotizacionId);
  if (cambiado.changes === 0) {
    throw new ErrorCotizacion('Solo se aprueban cotizaciones en borrador');
  }
  registroEvento(db, responsable, 'cotizacion_aprobada', 'cotizacion', String(cotizacionId), {});
}

export function anularCotizacion(db: Database.Database, cotizacionId: number, responsable: string, motivo: string): void {
  if (!motivo?.trim()) {
    throw new ErrorCotizacion('La anulación exige motivo');
  }
  const cambiado = db
    .prepare("UPDATE cotizacion SET estado = 'anulada' WHERE id = ? AND estado IN ('borrador','aprobada')")
    .run(cotizacionId);
  if (cambiado.changes === 0) {
    throw new ErrorCotizacion('La cotización no puede anularse en su estado actual');
  }
  registroEvento(db, responsable, 'cotizacion_anulada', 'cotizacion', String(cotizacionId), { motivo });
}

export function listarCotizaciones(db: Database.Database): CotizacionResumen[] {
  return (db
    .prepare(`${SELECT_COTIZACION} GROUP BY c.id ORDER BY c.id DESC LIMIT 100`)
    .all() as FilaCotizacion[]).map(mapear);
}

export function lineasDeCotizacion(db: Database.Database, cotizacionId: number): Array<{
  id: number;
  tipo: string;
  descripcion: string;
  cantidad: string;
  precioUnitarioMinor: string;
  precioConIva: boolean;
  tasaPuntosBase: number;
  baseMinor: string;
  ivaMinor: string;
  totalMinor: string;
}> {
  const filas = db
    .prepare('SELECT * FROM cotizacion_linea WHERE cotizacion_id = ? ORDER BY orden')
    .all(cotizacionId) as Array<{
    id: number;
    tipo: string;
    descripcion: string;
    cantidad: string;
    precio_unitario_minor: number;
    precio_con_iva: number;
    tasa_puntos_base: number;
    base_minor: number;
    iva_minor: number;
    total_minor: number;
  }>;
  return filas.map(f => ({
    id: f.id,
    tipo: f.tipo,
    descripcion: f.descripcion,
    cantidad: f.cantidad,
    precioUnitarioMinor: minorATexto(BigInt(f.precio_unitario_minor)),
    precioConIva: f.precio_con_iva === 1,
    tasaPuntosBase: f.tasa_puntos_base,
    baseMinor: minorATexto(BigInt(f.base_minor)),
    ivaMinor: minorATexto(BigInt(f.iva_minor)),
    totalMinor: minorATexto(BigInt(f.total_minor))
  }));
}
