import type Database from 'better-sqlite3';
import { minorATexto } from '../../shared/dinero';
import { validarFechaCalendario } from '../../shared/fechas';

// Libro diario (auditoría 71, bloque 2): partidas por número.
// Servicio puro con `db` por parámetro, sin Electron, para reutilizar en Android.

export interface FiltroPartidas {
  ambitoId?: string;
  busqueda?: string;
  desdeNumero?: number;
  hastaNumero?: number;
  desdeFecha?: string;
  hastaFecha?: string;
  concepto?: string;
  cuentaId?: number;
  origen?: string;
  estado?: string;
  desde: number;
  limite: number;
}

export interface PartidaResumen {
  id: number;
  folio: string;
  numero: number;
  fecha: string;
  concepto: string;
  estado: string;
  origen: string;
  responsable: string;
  totalMinor: string;
}

export interface PartidaLinea {
  cuentaCodigo: string;
  cuentaNombre: string;
  debeMinor: string;
  haberMinor: string;
}

export interface PartidaDetalle {
  id: number;
  folio: string;
  numero: number;
  fecha: string;
  concepto: string;
  estado: string;
  origen: string;
  origenId: string;
  responsable: string;
  motivo: string;
  lineas: PartidaLinea[];
  totalDebeMinor: string;
  totalHaberMinor: string;
  reversoDe: { id: number; folio: string } | null;
  reverso: { id: number; folio: string } | null;
}

// Búsqueda por número: '150', 'A-150' y 'A-000150' encuentran la misma partida.
export function normalizarNumeroPartida(entrada: string): number | null {
  const limpio = entrada.trim();
  const m = limpio.match(/^(?:A-)?(\d{1,9})$/i);
  if (!m) {
    return null;
  }
  const numero = Number(m[1]);
  return Number.isInteger(numero) && numero > 0 ? numero : null;
}

function numeroDeFolio(folio: string): number {
  const m = folio.match(/^A-(\d+)$/i);
  return m ? Number(m[1]) : 0;
}

export function listarPartidas(
  db: Database.Database,
  filtro: FiltroPartidas
): { partidas: PartidaResumen[]; total: number } {
  const condiciones: string[] = ["a.estado IN ('contabilizado','anulado')", 'a.ambito_id = ?'];
  const parametros: Array<string | number> = [filtro.ambitoId ?? 'administrativo'];

  if (filtro.busqueda) {
    const numero = normalizarNumeroPartida(filtro.busqueda);
    const esPatronNumerico = /^\s*(?:A-)?\d+\s*$/i.test(filtro.busqueda);
    if (esPatronNumerico) {
      // 'A-0' y cualquier forma numérica NO caen en búsqueda de texto (auditoría 72).
      condiciones.push('CAST(substr(a.folio, 3) AS INTEGER) = ?');
      parametros.push(numero ?? 0);
    } else {
      const escapado = filtro.busqueda.replace(/[%_\\]/g, ch => `\\${ch}`);
      condiciones.push("(a.concepto LIKE ? ESCAPE '\\' OR a.folio LIKE ? ESCAPE '\\')");
      parametros.push(`%${escapado}%`, `%${escapado}%`);
    }
  }
  if (filtro.desdeNumero !== undefined) {
    condiciones.push('CAST(substr(a.folio, 3) AS INTEGER) >= ?');
    parametros.push(filtro.desdeNumero);
  }
  if (filtro.hastaNumero !== undefined) {
    condiciones.push('CAST(substr(a.folio, 3) AS INTEGER) <= ?');
    parametros.push(filtro.hastaNumero);
  }
  if (filtro.desdeFecha) {
    validarFechaCalendario(filtro.desdeFecha);
    condiciones.push('a.fecha_operacion >= ?');
    parametros.push(filtro.desdeFecha);
  }
  if (filtro.hastaFecha) {
    validarFechaCalendario(filtro.hastaFecha);
    condiciones.push('a.fecha_operacion <= ?');
    parametros.push(filtro.hastaFecha);
  }
  if (filtro.concepto) {
    const escapado = filtro.concepto.replace(/[%_\\]/g, ch => `\\${ch}`);
    condiciones.push("a.concepto LIKE ? ESCAPE '\\'");
    parametros.push(`%${escapado}%`);
  }
  if (filtro.cuentaId) {
    condiciones.push('EXISTS (SELECT 1 FROM asiento_linea l WHERE l.asiento_id = a.id AND l.cuenta_id = ?)');
    parametros.push(filtro.cuentaId);
  }
  if (filtro.origen) {
    condiciones.push('a.origen_tipo = ?');
    parametros.push(filtro.origen);
  }
  if (filtro.estado) {
    condiciones.push('a.estado = ?');
    parametros.push(filtro.estado);
  }

  const donde = condiciones.join(' AND ');
  const limite = Math.max(1, Math.min(500, filtro.limite));
  const desde = Math.max(0, filtro.desde);

  const total = (
    db.prepare(`SELECT COUNT(*) AS n FROM asiento a WHERE ${donde}`).get(...parametros) as { n: number }
  ).n;

  const filas = (
    db
      .prepare(
        `SELECT a.id, a.folio, a.fecha_operacion AS fecha, a.concepto, a.estado,
                COALESCE(a.origen_tipo, '') AS origen, a.responsable,
                COALESCE((SELECT SUM(l.debe_minor) FROM asiento_linea l WHERE l.asiento_id = a.id), 0) AS total
         FROM asiento a
         WHERE ${donde}
         ORDER BY CAST(substr(a.folio, 3) AS INTEGER), a.id
         LIMIT ? OFFSET ?`
      )
      .safeIntegers(true)
      .all(...parametros, limite, desde) as Array<{
      id: number;
      folio: string;
      fecha: string;
      concepto: string;
      estado: string;
      origen: string;
      responsable: string;
      total: bigint;
    }>
  );

  return {
    partidas: filas.map(f => ({
      id: f.id,
      folio: f.folio,
      numero: numeroDeFolio(f.folio),
      fecha: f.fecha,
      concepto: f.concepto,
      estado: f.estado,
      origen: f.origen,
      responsable: f.responsable,
      totalMinor: minorATexto(BigInt(f.total))
    })),
    total
  };
}

export function verPartida(db: Database.Database, partidaId: number, ambitoId = 'administrativo'): PartidaDetalle {
  const asiento = db
    .prepare(
      `SELECT a.id, a.folio, a.fecha_operacion AS fecha, a.concepto, a.estado,
              COALESCE(a.origen_tipo, '') AS origen, COALESCE(a.origen_id, '') AS origenId,
              a.responsable, COALESCE(a.motivo, '') AS motivo, a.reverso_de_id
       FROM asiento a WHERE a.id = ? AND a.ambito_id = ?`
    )
    .get(partidaId, ambitoId) as
    | {
        id: number;
        folio: string;
        fecha: string;
        concepto: string;
        estado: string;
        origen: string;
        origenId: string;
        responsable: string;
        motivo: string;
        reverso_de_id: number | null;
      }
    | undefined;
  if (!asiento) {
    throw new Error(`No existe la partida ${partidaId}`);
  }
  const lineas = db
    .prepare(
      `SELECT c.codigo, c.nombre, l.debe_minor AS debe, l.haber_minor AS haber
       FROM asiento_linea l JOIN cuenta c ON c.id = l.cuenta_id
       WHERE l.asiento_id = ? ORDER BY c.codigo, l.id`
    )
    .safeIntegers(true)
    .all(partidaId) as Array<{ codigo: string; nombre: string; debe: bigint; haber: bigint }>;

  const reversoDe = asiento.reverso_de_id
    ? (db.prepare('SELECT id, folio FROM asiento WHERE id = ?').get(asiento.reverso_de_id) as { id: number; folio: string })
    : null;
  const reverso = (
    db.prepare('SELECT id, folio FROM asiento WHERE reverso_de_id = ?').get(partidaId) as
      | { id: number; folio: string }
      | undefined
  ) ?? null;

  const totalDebe = lineas.reduce((s, l) => s + BigInt(l.debe), 0n);
  const totalHaber = lineas.reduce((s, l) => s + BigInt(l.haber), 0n);

  return {
    id: asiento.id,
    folio: asiento.folio,
    numero: numeroDeFolio(asiento.folio),
    fecha: asiento.fecha,
    concepto: asiento.concepto,
    estado: asiento.estado,
    origen: asiento.origen,
    origenId: asiento.origenId,
    responsable: asiento.responsable,
    motivo: asiento.motivo,
    lineas: lineas.map(l => ({
      cuentaCodigo: l.codigo,
      cuentaNombre: l.nombre,
      debeMinor: minorATexto(BigInt(l.debe)),
      haberMinor: minorATexto(BigInt(l.haber))
    })),
    totalDebeMinor: minorATexto(totalDebe),
    totalHaberMinor: minorATexto(totalHaber),
    reversoDe,
    reverso
  };
}
