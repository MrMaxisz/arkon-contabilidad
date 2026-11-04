import type Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { registroEvento } from './bitacora';
import { versionEsquemaActual } from '../db/aplicarMigraciones';

export class ErrorRespaldo extends Error {}

export interface InfoRespaldo {
  id: number;
  creadoEn: string;
  nombre: string;
  hashSha256: string;
  versionApp: string;
  versionEsquema: number;
  estado: string;
}

function hashArchivo(ruta: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(ruta)).digest('hex');
}

function verificarIntegridad(rutaDb: string): void {
  const Database = require('better-sqlite3') as typeof import('better-sqlite3');
  const copia = new Database(rutaDb, { readonly: true });
  try {
    const resultado = copia.pragma('integrity_check') as unknown;
    const texto = Array.isArray(resultado)
      ? resultado.map(r => String(Object.values(r)[0])).join(' ')
      : String(resultado);
    if (!texto.includes('ok')) {
      throw new ErrorRespaldo(`Integridad fallida: ${texto}`);
    }
  } finally {
    copia.close();
  }
}

export async function crearRespaldo(
  db: Database.Database,
  dirRespaldos: string,
  versionApp: string
): Promise<InfoRespaldo> {
  fs.mkdirSync(dirRespaldos, { recursive: true });
  const marca = new Date().toISOString().replace(/[:.]/g, '-');
  const nombre = `respaldo-${marca}.db`;
  const destino = path.join(dirRespaldos, nombre);
  const temporal = `${destino}.tmp`;
  await db.backup(temporal);
  verificarIntegridad(temporal);
  const hash = hashArchivo(temporal);
  fs.renameSync(temporal, destino);
  const version = versionEsquemaActual();
  fs.writeFileSync(
    `${destino}.manifest.json`,
    JSON.stringify({ nombre, hashSha256: hash, versionApp, versionEsquema: version, creadoEn: new Date().toISOString() }, null, 2),
    'utf8'
  );
  const info = db
    .prepare(
      'INSERT INTO respaldo (nombre, hash_sha256, version_app, version_esquema, estado) VALUES (?, ?, ?, ?, ?)'
    )
    .run(nombre, hash, versionApp, version, 'disponible');
  const id = Number(info.lastInsertRowid);
  registroEvento(db, 'sistema', 'respaldo_creado', 'respaldo', String(id), { nombre, hash });
  return {
    id,
    creadoEn: new Date().toISOString(),
    nombre,
    hashSha256: hash,
    versionApp,
    versionEsquema: version,
    estado: 'disponible'
  };
}

export function listarRespaldos(db: Database.Database): InfoRespaldo[] {
  return db
    .prepare('SELECT id, creado_en, nombre, hash_sha256, version_app, version_esquema, estado FROM respaldo ORDER BY id DESC')
    .all() as InfoRespaldo[];
}

export function restaurarRespaldo(
  db: Database.Database,
  rutaRespaldo: string,
  rutaBaseActiva: string
): { ok: boolean; detalle: string } {
  if (!fs.existsSync(rutaRespaldo)) {
    throw new ErrorRespaldo(`No existe el respaldo: ${rutaRespaldo}`);
  }
  const nombreRespaldo = path.basename(rutaRespaldo);
  const registro = db
    .prepare('SELECT * FROM respaldo WHERE nombre = ?')
    .get(nombreRespaldo) as (InfoRespaldo & { hash_sha256: string }) | undefined;
  const hash = hashArchivo(rutaRespaldo);
  if (registro && registro.hash_sha256 !== hash) {
    throw new ErrorRespaldo('El hash del respaldo no coincide con el registrado; rechazado');
  }
  const rutaManifiesto = `${rutaRespaldo}.manifest.json`;
  if (fs.existsSync(rutaManifiesto)) {
    const manifiesto = JSON.parse(fs.readFileSync(rutaManifiesto, 'utf8')) as { nombre?: string; hashSha256?: string };
    if (manifiesto.nombre !== nombreRespaldo || manifiesto.hashSha256 !== hash) {
      throw new ErrorRespaldo('El manifiesto del respaldo no coincide con el archivo; restauración rechazada');
    }
  } else if (!registro) {
    throw new ErrorRespaldo('Respaldo sin manifiesto ni registro previo; restauración rechazada');
  }
  verificarIntegridad(rutaRespaldo);
  const versionRespaldo = leerVersionEsquema(rutaRespaldo);
  const versionActual = versionEsquemaActual();
  if (versionRespaldo > versionActual) {
    throw new ErrorRespaldo(
      `El respaldo usa esquema ${versionRespaldo}, superior al soportado (${versionActual}); restauración bloqueada`
    );
  }
  const areaTemporal = `${rutaBaseActiva}.restauracion-tmp`;
  fs.copyFileSync(rutaRespaldo, areaTemporal);
  verificarIntegridad(areaTemporal);
  registroEvento(db, 'sistema', 'restauracion', 'respaldo', path.basename(rutaRespaldo), {
    versionRespaldo,
    estadoPrevioPreservado: true
  });
  db.close();
  const previa = `${rutaBaseActiva}.antes-restauracion`;
  fs.copyFileSync(rutaBaseActiva, previa);
  fs.renameSync(areaTemporal, rutaBaseActiva);
  return { ok: true, detalle: `Restaurado ${path.basename(rutaRespaldo)}; copia previa en ${path.basename(previa)}` };
}

function leerVersionEsquema(rutaDb: string): number {
  const Database = require('better-sqlite3') as typeof import('better-sqlite3');
  const copia = new Database(rutaDb, { readonly: true });
  try {
    const fila = copia
      .prepare('SELECT MAX(version) AS v FROM _migracion')
      .get() as { v: number | null } | undefined;
    return fila?.v ?? 0;
  } finally {
    copia.close();
  }
}
