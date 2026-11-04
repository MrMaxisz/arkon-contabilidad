import path from 'path';
import type Database from 'better-sqlite3';
import type { RutasDatos } from '../db/conexion';
import { abrirBase } from '../db/conexion';
import { aplicarMigraciones } from '../db/aplicarMigraciones';
import { restaurarRespaldo, registrarRestauracion, ErrorRespaldo } from './respaldo';

export interface ContextoApp {
  db: Database.Database;
  rutas: RutasDatos;
  versionApp: string;
  rutaDb: string;
  reabrirBase(): void;
}

export function crearContextoBase(rutas: RutasDatos, rutaDb: string, versionApp: string): ContextoApp {
  const db = abrirBase(rutaDb);
  aplicarMigraciones(db);
  return {
    db,
    rutas,
    versionApp,
    rutaDb,
    reabrirBase() {
      if (this.db.open) {
        this.db.close();
      }
      this.db = abrirBase(rutaDb);
      aplicarMigraciones(this.db);
    }
  };
}

export function manejarRestauracion(ctx: ContextoApp, nombre: string): {
  ok: boolean;
  detalle: string;
  respaldo: string;
  copiaPrevia: string;
} {
  if (!nombre.startsWith('respaldo-') || nombre.includes(path.sep) || nombre.includes('..')) {
    throw new ErrorRespaldo('Nombre de respaldo inválido');
  }
  const ruta = path.join(ctx.rutas.respaldos, nombre);
  let resultado: { ok: boolean; detalle: string; respaldo: string; copiaPrevia: string };
  try {
    resultado = restaurarRespaldo(ctx.db, ruta, ctx.rutaDb);
  } catch (err) {
    if (!ctx.db.open) {
      ctx.reabrirBase();
    }
    throw err;
  }
  ctx.reabrirBase();
  registrarRestauracion(ctx.db, { respaldo: resultado.respaldo, copiaPrevia: resultado.copiaPrevia });
  return resultado;
}
