import path from 'path';
import type Database from 'better-sqlite3';
import type { RutasDatos } from '../db/conexion';
import { abrirBase } from '../db/conexion';
import fs from 'fs';
import { aplicarMigraciones } from '../db/aplicarMigraciones';
import { restaurarRespaldo, registrarRestauracion, ErrorRespaldo } from './respaldo';
import { restaurarAdjuntosRespaldo, copiarAdjuntosRespaldo, retencionRespaldosAutomaticos } from './adjuntos';

export interface ContextoApp {
  db: Database.Database;
  rutas: RutasDatos;
  versionApp: string;
  rutaDb: string;
  reabrirBase(): void;
}

export async function crearContextoBase(rutas: RutasDatos, rutaDb: string, versionApp: string): Promise<ContextoApp> {
  if (fs.existsSync(rutaDb)) {
    const versionPrevio = (() => {
      const previa = abrirBase(rutaDb);
      try {
        const fila = previa.prepare('SELECT MAX(version) AS v FROM _migracion').get() as { v: number | null };
        return fila?.v ?? 0;
      } catch {
        return 0;
      } finally {
        previa.close();
      }
    })();
    const { versionEsquemaActual } = await import('../db/aplicarMigraciones');
    if (versionPrevio < versionEsquemaActual()) {
      const dbPrevia = abrirBase(rutaDb);
      try {
        const marca = new Date().toISOString().replace(/[:.]/g, '-');
        const destino = path.join(rutas.respaldos, `respaldo-previo-migracion-${marca}.db`);
        const temporal = `${destino}.tmp`;
        await dbPrevia.backup(temporal);
        const { verificarIntegridad } = await import('./respaldo');
        verificarIntegridad(temporal);
        const crypto = await import('crypto');
        const hash = crypto.createHash('sha256').update(fs.readFileSync(temporal)).digest('hex');
        const adjuntos = copiarAdjuntosRespaldo(rutas.adjuntos, `${destino}-adjuntos`);
        fs.renameSync(temporal, destino);
        fs.writeFileSync(
          `${destino}.manifest.json`,
          JSON.stringify(
            {
              nombre: path.basename(destino),
              hashSha256: hash,
              versionEsquema: versionPrevio,
              versionApp,
              creadoEn: new Date().toISOString(),
              adjuntos,
              nota: 'Respaldo automático previo a migración'
            },
            null,
            2
          ),
          'utf8'
        );
      } finally {
        dbPrevia.close();
      }
      const { retencionRespaldosAutomaticos } = await import('./adjuntos');
      const dbRetencion = abrirBase(rutaDb);
      try {
        aplicarMigraciones(dbRetencion);
        retencionRespaldosAutomaticos(dbRetencion, rutas.respaldos);
      } finally {
        dbRetencion.close();
      }
    }
  }
  const db = abrirBase(rutaDb);
  aplicarMigraciones(db);
  const ctx: ContextoApp = {
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
  return ctx;
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
  const rutaManifiesto = `${ruta}.manifest.json`;
  if (!fs.existsSync(rutaManifiesto)) {
    throw new ErrorRespaldo('Respaldo sin manifiesto; restauración rechazada');
  }
  const manifiesto = JSON.parse(fs.readFileSync(rutaManifiesto, 'utf8')) as {
    adjuntos?: Array<{ rutaRelativa: string; hashSha256: string }>;
  };
  const adjuntosEsperados = manifiesto.adjuntos ?? [];
  const areaAdjuntosTemporal = `${ctx.rutas.adjuntos}.restauracion-tmp`;
  fs.rmSync(areaAdjuntosTemporal, { recursive: true, force: true });
  fs.mkdirSync(areaAdjuntosTemporal, { recursive: true });
  restaurarAdjuntosRespaldo(`${ruta}-adjuntos`, areaAdjuntosTemporal, adjuntosEsperados);
  let resultado: { ok: boolean; detalle: string; respaldo: string; copiaPrevia: string };
  try {
    resultado = restaurarRespaldo(ctx.db, ruta, ctx.rutaDb);
  } catch (err) {
    fs.rmSync(areaAdjuntosTemporal, { recursive: true, force: true });
    if (!ctx.db.open) {
      ctx.reabrirBase();
    }
    throw err;
  }
  const previaAdjuntos = `${ctx.rutas.adjuntos}.antes-restauracion`;
  fs.rmSync(previaAdjuntos, { recursive: true, force: true });
  if (fs.existsSync(ctx.rutas.adjuntos)) {
    fs.renameSync(ctx.rutas.adjuntos, previaAdjuntos);
  }
  fs.renameSync(areaAdjuntosTemporal, ctx.rutas.adjuntos);
  fs.rmSync(previaAdjuntos, { recursive: true, force: true });
  ctx.reabrirBase();
  registrarRestauracion(ctx.db, { respaldo: resultado.respaldo, copiaPrevia: resultado.copiaPrevia });
  return resultado;
}

export function restaurarAdjuntosDesdeRespaldo(
  rutaRespaldo: string,
  dirAdjuntosDestino: string,
  esperados: Array<{ rutaRelativa: string; hashSha256: string }>
): void {
  restaurarAdjuntosRespaldo(`${rutaRespaldo}-adjuntos`, dirAdjuntosDestino, esperados);
}
