import type Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { registroEvento } from './bitacora';
import { copiarAdjuntosRespaldo, restaurarAdjuntosRespaldo, retencionRespaldosAutomaticos } from './adjuntos';
import type { InfoRespaldo as InfoRespaldoContrato } from '../../shared/contratos';
import { versionEsquemaActual } from '../db/aplicarMigraciones';

export class ErrorRespaldo extends Error {}


function hashArchivo(ruta: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(ruta)).digest('hex');
}

export function verificarIntegridad(rutaDb: string): void {
  const Database = require('better-sqlite3') as typeof import('better-sqlite3');
  // Apertura read-write con query_only: una conexión de solo lectura sobre una base en modo WAL
  // deja -wal/-shm que no puede borrar al cerrar (defecto auditoría 65). Con query_only el
  // contenido no se modifica y el cierre elimina los archivos transitorios exactos.
  const copia = new Database(rutaDb);
  try {
    copia.pragma('query_only = ON');
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

// Limpieza de rutas EXACTAS derivadas del temporal/destino de una operación de respaldo:
// nunca borrados por patrón amplio. Incluye los restos -wal/-shm del temporal.
export function limpiarRutasRespaldo(rutas: string[]): void {
  for (const ruta of rutas) {
    fs.rmSync(ruta, { force: true, recursive: true });
  }
}

let operacionRespaldoEnCurso = false;

export function operacionRespaldoDisponible(): boolean {
  return !operacionRespaldoEnCurso;
}

export function adquirirOperacionRespaldo(): boolean {
  if (operacionRespaldoEnCurso) {
    return false;
  }
  operacionRespaldoEnCurso = true;
  return true;
}

export function liberarOperacionRespaldo(): void {
  operacionRespaldoEnCurso = false;
}

export async function crearRespaldo(
  db: Database.Database,
  dirRespaldos: string,
  versionApp: string,
  dirAdjuntos?: string
): Promise<InfoRespaldo> {
  if (!adquirirOperacionRespaldo()) {
    throw new ErrorRespaldo('Otra operación de respaldo/restauración está en curso');
  }
  try {
    fs.mkdirSync(dirRespaldos, { recursive: true });
    const marca = new Date().toISOString().replace(/[:.]/g, '-');
    const nombre = `respaldo-${marca}.db`;
    const destino = path.join(dirRespaldos, nombre);
    const temporal = `${destino}.tmp`;
    try {
      await db.backup(temporal);
      verificarIntegridad(temporal);
      const hash = hashArchivo(temporal);
      const Database = require('better-sqlite3') as typeof import('better-sqlite3');
      const dbTemporal = new Database(temporal);
      let adjuntos: Array<{ rutaRelativa: string; hashSha256: string }> = [];
      let version: number;
      try {
        dbTemporal.pragma('query_only = ON');
        version = (dbTemporal.prepare('SELECT MAX(version) AS v FROM _migracion').get() as { v: number | null }).v ?? 0;
        adjuntos = dirAdjuntos ? copiarAdjuntosRespaldo(dbTemporal, dirAdjuntos, `${destino}-adjuntos`) : [];
      } finally {
        dbTemporal.close();
      }
      fs.renameSync(temporal, destino);
      fs.writeFileSync(
        `${destino}.manifest.json`,
        JSON.stringify(
          {
            nombre,
            hashSha256: hash,
            versionApp,
            versionEsquema: version,
            creadoEn: new Date().toISOString(),
            adjuntos
          },
          null,
          2
        ),
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
    } catch (err) {
      // Fallo entre backup y rename: limpieza de rutas EXACTAS de esta operación (auditoría 65).
      limpiarRutasRespaldo([
        temporal,
        `${temporal}-wal`,
        `${temporal}-shm`,
        `${destino}-adjuntos`,
        destino,
        `${destino}.manifest.json`
      ]);
      throw err;
    }
  } finally {
    liberarOperacionRespaldo();
  }
}

interface FilaRespaldo {
  id: number;
  creado_en: string;
  nombre: string;
  hash_sha256: string;
  version_app: string;
  version_esquema: number;
  estado: string;
}

export type InfoRespaldo = InfoRespaldoContrato;

export function listarRespaldos(db: Database.Database): InfoRespaldo[] {
  const filas = db
    .prepare('SELECT id, creado_en, nombre, hash_sha256, version_app, version_esquema, estado FROM respaldo ORDER BY id DESC')
    .all() as FilaRespaldo[];
  return filas.map(f => ({
    id: f.id,
    creadoEn: f.creado_en,
    nombre: f.nombre,
    hashSha256: f.hash_sha256,
    versionApp: f.version_app,
    versionEsquema: f.version_esquema,
    estado: f.estado
  }));
}

export function registrarRestauracion(db: Database.Database, detalle: { respaldo: string; copiaPrevia: string }): void {
  registroEvento(db, 'sistema', 'restauracion_completada', 'respaldo', detalle.respaldo, detalle);
}

export function descubrirRespaldos(dirRespaldos: string): InfoRespaldo[] {
  if (!fs.existsSync(dirRespaldos)) {
    return [];
  }
  const encontrados: InfoRespaldo[] = [];
  for (const archivo of fs.readdirSync(dirRespaldos)) {
    if (!archivo.startsWith('respaldo-') || !archivo.endsWith('.db')) {
      continue;
    }
    const rutaManifiesto = path.join(dirRespaldos, `${archivo}.manifest.json`);
    if (!fs.existsSync(rutaManifiesto)) {
      continue;
    }
    try {
      const m = JSON.parse(fs.readFileSync(rutaManifiesto, 'utf8')) as {
        nombre?: string;
        hashSha256?: string;
        versionApp?: string;
        versionEsquema?: number;
        creadoEn?: string;
      };
      if (m.nombre !== archivo || !m.hashSha256) {
        continue;
      }
      encontrados.push({
        id: 0,
        creadoEn: m.creadoEn ?? '',
        nombre: m.nombre,
        hashSha256: m.hashSha256,
        versionApp: m.versionApp ?? '',
        versionEsquema: m.versionEsquema ?? 0,
        estado: fs.existsSync(path.join(dirRespaldos, archivo)) ? 'disponible' : 'invalido'
      });
    } catch {
      continue;
    }
  }
  return encontrados.sort((a, b) => b.creadoEn.localeCompare(a.creadoEn));
}

export function restaurarRespaldo(
  db: Database.Database,
  rutaRespaldo: string,
  rutaBaseActiva: string
): { ok: boolean; detalle: string; respaldo: string; copiaPrevia: string } {
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
  let adjuntosManifiesto: Array<{ rutaRelativa: string; hashSha256: string }> = [];
  if (fs.existsSync(rutaManifiesto)) {
    const manifiesto = JSON.parse(fs.readFileSync(rutaManifiesto, 'utf8')) as {
      nombre?: string;
      hashSha256?: string;
      adjuntos?: Array<{ rutaRelativa: string; hashSha256: string }>;
    };
    if (manifiesto.nombre !== nombreRespaldo || manifiesto.hashSha256 !== hash) {
      throw new ErrorRespaldo('El manifiesto del respaldo no coincide con el archivo; restauración rechazada');
    }
    adjuntosManifiesto = manifiesto.adjuntos ?? [];
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
  let previa = '';
  try {
    fs.copyFileSync(rutaRespaldo, areaTemporal);
    verificarIntegridad(areaTemporal);
    registroEvento(db, 'sistema', 'restauracion', 'respaldo', path.basename(rutaRespaldo), {
      versionRespaldo,
      estadoPrevioPreservado: true
    });
    db.close();
    previa = `${rutaBaseActiva}.antes-restauracion`;
    fs.copyFileSync(rutaBaseActiva, previa);
    fs.renameSync(areaTemporal, rutaBaseActiva);
  } catch (err) {
    // Limpieza de rutas EXACTAS del área temporal de esta restauración (auditoría 65).
    limpiarRutasRespaldo([areaTemporal, `${areaTemporal}-wal`, `${areaTemporal}-shm`]);
    throw err;
  }
  return {
    ok: true,
    detalle: `Restaurado ${nombreRespaldo}; copia previa en ${path.basename(previa)}`,
    respaldo: nombreRespaldo,
    copiaPrevia: path.basename(previa)
  };
}

function leerVersionEsquema(rutaDb: string): number {
  const Database = require('better-sqlite3') as typeof import('better-sqlite3');
  const copia = new Database(rutaDb);
  try {
    copia.pragma('query_only = ON');
    const fila = copia
      .prepare('SELECT MAX(version) AS v FROM _migracion')
      .get() as { v: number | null } | undefined;
    return fila?.v ?? 0;
  } finally {
    copia.close();
  }
}
