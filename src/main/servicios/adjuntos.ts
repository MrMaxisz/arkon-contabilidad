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

export function copiarAdjuntosRespaldo(dirAdjuntos: string, dirDestino: string): Array<{ rutaRelativa: string; hashSha256: string }> {
  if (!fs.existsSync(dirAdjuntos)) {
    return [];
  }
  fs.mkdirSync(dirDestino, { recursive: true });
  const registrados: Array<{ rutaRelativa: string; hashSha256: string }> = [];
  for (const archivo of fs.readdirSync(dirAdjuntos)) {
    const origen = path.join(dirAdjuntos, archivo);
    fs.copyFileSync(origen, path.join(dirDestino, archivo));
    registrados.push({
      rutaRelativa: archivo,
      hashSha256: crypto.createHash('sha256').update(fs.readFileSync(origen)).digest('hex')
    });
  }
  return registrados;
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
  const automaticos = fs
    .readdirSync(dirRespaldos)
    .filter(f => f.startsWith('respaldo-previo-migracion-') || f.startsWith('respaldo-automatico-'))
    .sort()
    .reverse();
  const aConservar = new Set(automaticos.slice(0, retencion));
  let depurados = 0;
  for (const archivo of automaticos) {
    if (aConservar.has(archivo)) {
      continue;
    }
    fs.rmSync(path.join(dirRespaldos, archivo), { force: true });
    fs.rmSync(path.join(dirRespaldos, `${archivo}.manifest.json`), { force: true });
    depurados++;
  }
  return { conservados: aConservar.size, depurados };
}
