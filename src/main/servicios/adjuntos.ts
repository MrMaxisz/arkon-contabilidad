import type Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { registroEvento } from './bitacora';

export class ErrorAdjunto extends Error {}

export interface AdjuntoInfo {
  id: number;
  entidad: string;
  entidadId: string;
  nombreOriginal: string;
  rutaRelativa: string;
  hashSha256: string;
  creadoEn: string;
}

const ENTIDADES_VALIDAS = new Set(['compra', 'venta', 'cotizacion', 'proyecto']);

export function validarVinculoDocumento(db: Database.Database, entidad: string, entidadId: string): void {
  if (!ENTIDADES_VALIDAS.has(entidad)) {
    throw new ErrorAdjunto(`Entidad no reconocida para adjuntos: ${entidad}`);
  }
  const tablas: Record<string, string> = {
    compra: 'compra',
    venta: 'venta',
    cotizacion: 'cotizacion',
    proyecto: 'proyecto'
  };
  const tabla = tablas[entidad];
  const columna = entidad === 'cotizacion' || entidad === 'proyecto' ? 'id' : 'folio';
  const fila = db
    .prepare(`SELECT 1 AS x FROM ${tabla} WHERE ${columna} = ?`)
    .get(entidadId) as { x: number } | undefined;
  if (!fila) {
    throw new ErrorAdjunto(`No existe ${entidad} con identificador ${entidadId}; el adjunto debe vincularse a un documento real`);
  }
}

export function registrarAdjunto(
  db: Database.Database,
  dirAdjuntos: string,
  entrada: {
    entidad: string;
    entidadId: string;
    nombreOriginal: string;
    rutaOrigen: string;
    responsable: string;
  }
): AdjuntoInfo {
  if (!entrada.entidad?.trim() || !entrada.entidadId?.trim()) {
    throw new ErrorAdjunto('El adjunto requiere entidad e identificador de origen');
  }
  if (!fs.existsSync(entrada.rutaOrigen)) {
    throw new ErrorAdjunto(`No existe el archivo de origen: ${entrada.rutaOrigen}`);
  }
  const contenido = fs.readFileSync(entrada.rutaOrigen);
  const hash = crypto.createHash('sha256').update(contenido).digest('hex');
  fs.mkdirSync(dirAdjuntos, { recursive: true });
  const extension = path.extname(entrada.nombreOriginal);
  const rutaRelativa = `${hash.slice(0, 16)}-${Date.now()}${extension}`;
  fs.writeFileSync(path.join(dirAdjuntos, rutaRelativa), contenido);
  const hashEscrito = crypto.createHash('sha256').update(fs.readFileSync(path.join(dirAdjuntos, rutaRelativa))).digest('hex');
  if (hashEscrito !== hash) {
    fs.rmSync(path.join(dirAdjuntos, rutaRelativa), { force: true });
    throw new ErrorAdjunto('La copia del adjunto no coincide con el original; registro revertido');
  }
  const info = db
    .prepare(
      'INSERT INTO adjunto (entidad, entidad_id, nombre_original, ruta_relativa, hash_sha256) VALUES (?, ?, ?, ?, ?)'
    )
    .run(entrada.entidad.trim(), entrada.entidadId.trim(), entrada.nombreOriginal.trim(), rutaRelativa, hash);
  registroEvento(db, entrada.responsable, 'adjunto_registrado', entrada.entidad, entrada.entidadId, {
    nombre: entrada.nombreOriginal,
    hash
  });
  return {
    id: Number(info.lastInsertRowid),
    entidad: entrada.entidad.trim(),
    entidadId: entrada.entidadId.trim(),
    nombreOriginal: entrada.nombreOriginal.trim(),
    rutaRelativa,
    hashSha256: hash,
    creadoEn: new Date().toISOString()
  };
}

export function listarAdjuntos(db: Database.Database, entidad?: string, entidadId?: string): AdjuntoInfo[] {
  const filas = (
    entidad
      ? db
          .prepare('SELECT * FROM adjunto WHERE entidad = ? AND (? IS NULL OR entidad_id = ?) ORDER BY id DESC')
          .all(entidad, entidadId ?? null, entidadId ?? null)
      : db.prepare('SELECT * FROM adjunto ORDER BY id DESC').all()
  ) as Array<{
    id: number;
    entidad: string;
    entidad_id: string;
    nombre_original: string;
    ruta_relativa: string;
    hash_sha256: string;
    creado_en: string;
  }>;
  return filas.map(f => ({
    id: f.id,
    entidad: f.entidad,
    entidadId: f.entidad_id,
    nombreOriginal: f.nombre_original,
    rutaRelativa: f.ruta_relativa,
    hashSha256: f.hash_sha256,
    creadoEn: f.creado_en
  }));
}

export function verificarAdjunto(
  db: Database.Database,
  dirAdjuntos: string,
  id: number
): { id: number; nombreOriginal: string; ruta: string; existe: boolean; hashCoincide: boolean } {
  const fila = db.prepare('SELECT * FROM adjunto WHERE id = ?').get(id) as
    | { id: number; entidad: string; entidad_id: string; nombre_original: string; ruta_relativa: string; hash_sha256: string; creado_en: string }
    | undefined;
  if (!fila) {
    throw new ErrorAdjunto(`No existe el adjunto ${id}`);
  }
  validarRutasRelativas([fila.ruta_relativa]);
  const ruta = path.join(dirAdjuntos, fila.ruta_relativa);
  const existe = fs.existsSync(ruta) && fs.statSync(ruta).isFile();
  let hashCoincide = false;
  if (existe) {
    const hash = crypto.createHash('sha256').update(fs.readFileSync(ruta)).digest('hex');
    hashCoincide = hash === fila.hash_sha256;
  }
  return { id: fila.id, nombreOriginal: fila.nombre_original, ruta, existe, hashCoincide };
}

export function inventarioAdjuntosRegistrado(db: Database.Database): Array<{ rutaRelativa: string; hashSha256: string; nombreOriginal: string }> {
  const tablaExiste = db
    .prepare("SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = 'adjunto'")
    .get() as { x: number } | undefined;
  if (!tablaExiste) {
    return [];
  }
  const filas = db
    .prepare('SELECT ruta_relativa, hash_sha256, nombre_original FROM adjunto ORDER BY id')
    .all() as Array<{ ruta_relativa: string; hash_sha256: string; nombre_original: string }>;
  return filas.map(f => ({
    rutaRelativa: f.ruta_relativa,
    hashSha256: f.hash_sha256,
    nombreOriginal: f.nombre_original
  }));
}

export function validarRutasRelativas(rutas: string[]): void {
  for (const ruta of rutas) {
    if (ruta.includes('..') || path.isAbsolute(ruta) || ruta.includes('\\')) {
      throw new ErrorAdjunto(`Ruta de adjunto fuera del paquete: ${ruta}`);
    }
  }
}

export function copiarAdjuntosRespaldo(
  db: Database.Database,
  dirAdjuntos: string,
  dirDestino: string
): Array<{ rutaRelativa: string; hashSha256: string }> {
  const inventario = inventarioAdjuntosRegistrado(db);
  if (inventario.length === 0) {
    return [];
  }
  if (!fs.existsSync(dirAdjuntos)) {
    throw new ErrorAdjunto(`La carpeta de adjuntos no existe y hay ${inventario.length} adjunto(s) registrado(s)`);
  }
  fs.mkdirSync(dirDestino, { recursive: true });
  const copiados: Array<{ rutaRelativa: string; hashSha256: string }> = [];
  for (const registro of inventario) {
    const origen = path.join(dirAdjuntos, registro.rutaRelativa);
    if (!fs.existsSync(origen)) {
      throw new ErrorAdjunto(`Falta el archivo del adjunto registrado: ${registro.nombreOriginal} (${registro.rutaRelativa})`);
    }
    const hashActual = crypto.createHash('sha256').update(fs.readFileSync(origen)).digest('hex');
    if (hashActual !== registro.hashSha256) {
      throw new ErrorAdjunto(
        `El adjunto registrado ${registro.nombreOriginal} no coincide con su hash documentado; respaldo rechazado`
      );
    }
    fs.copyFileSync(origen, path.join(dirDestino, registro.rutaRelativa));
    copiados.push({ rutaRelativa: registro.rutaRelativa, hashSha256: registro.hashSha256 });
  }
  return copiados;
}

export function restaurarAdjuntosRespaldo(dirAdjuntosOrigen: string, dirAdjuntosDestino: string, esperados: Array<{ rutaRelativa: string; hashSha256: string }>): void {
  if (esperados.length === 0) {
    return;
  }
  if (!fs.existsSync(dirAdjuntosOrigen)) {
    throw new ErrorAdjunto('El paquete de respaldo no contiene los adjuntos referidos');
  }
  fs.mkdirSync(dirAdjuntosDestino, { recursive: true });
  for (const esperado of esperados) {
    const origen = path.join(dirAdjuntosOrigen, esperado.rutaRelativa);
    if (!fs.existsSync(origen)) {
      throw new ErrorAdjunto(`Falta el adjunto del respaldo: ${esperado.rutaRelativa}`);
    }
    const hash = crypto.createHash('sha256').update(fs.readFileSync(origen)).digest('hex');
    if (hash !== esperado.hashSha256) {
      throw new ErrorAdjunto(`El adjunto ${esperado.rutaRelativa} no coincide con el hash del manifiesto`);
    }
    fs.copyFileSync(origen, path.join(dirAdjuntosDestino, esperado.rutaRelativa));
  }
}

export function retencionRespaldosAutomaticos(db: Database.Database, dirRespaldos: string): { conservados: number; depurados: number } {
  const fila = db
    .prepare("SELECT valor FROM configuracion WHERE clave = 'respaldo_retencion_automatica'")
    .get() as { valor: string } | undefined;
  const retencion = Math.max(1, Number(fila?.valor ?? '5') || 5);
  if (!fs.existsSync(dirRespaldos)) {
    return { conservados: 0, depurados: 0 };
  }
  const bases = fs
    .readdirSync(dirRespaldos)
    .filter(f => (f.startsWith('respaldo-previo-migracion-') || f.startsWith('respaldo-automatico-')) && f.endsWith('.db'))
    .sort()
    .reverse();
  const aConservar = new Set(bases.slice(0, retencion));
  let depurados = 0;
  for (const base of bases) {
    if (aConservar.has(base)) {
      continue;
    }
    fs.rmSync(path.join(dirRespaldos, base), { force: true });
    fs.rmSync(path.join(dirRespaldos, `${base}.manifest.json`), { force: true });
    fs.rmSync(path.join(dirRespaldos, `${base}-adjuntos`), { recursive: true, force: true });
    depurados++;
  }
  return { conservados: aConservar.size, depurados };
}
