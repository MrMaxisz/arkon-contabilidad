import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { SqliteWasmDatabaseAdapter } from './sqliteWasm';
import { aplicarMigraciones } from '../main/db/aplicarMigraciones';
import { sembrarCatalogoBase } from '../main/servicios/cuentas';
import { despachar, comandos, type ContextoApp } from '../main/comandos';

export async function abrirMotorAndroid() {
  // El paquete usa new URL('sqlite3.wasm', import.meta.url): Vite incluye el WASM con su URL final.
  const sqlite = await sqlite3InitModule();
  // No hay fallback a memoria: si OPFS falla, no se permite registrar datos.
  const pool = await sqlite.installOpfsSAHPoolVfs({
    name: 'opfs-sahpool', directory: '/arkon-administrativo',
    preserveOnInitFailure: true
  });
  const db = new SqliteWasmDatabaseAdapter(new pool.OpfsSAHPoolDb('/arkon.db'));
  const ctx: ContextoApp = {
    db: db as unknown as ContextoApp['db'], rutaDb: '/arkon.db', versionApp: '0.1.0',
    rutas: { raiz: '/', datos: '/', adjuntos: '/adjuntos', respaldos: '/respaldos', registros: '/registros' },
    reabrirBase() { throw new Error('Solo una base activa en Android'); }
  };
  try {
    db.pragma('foreign_keys = ON');
    db.pragma('journal_mode = DELETE');
    db.pragma('synchronous = FULL');
    aplicarMigraciones(ctx.db);
    sembrarCatalogoBase(ctx.db, 'sistema');
    db.prepare("INSERT OR IGNORE INTO ambito (id, nombre, tipo) VALUES ('administrativo', 'Administrativo', 'administrativo')").run();
  } catch (error) {
    db.close();
    pool.pauseVfs();
    throw error;
  }
  return {
    db,
    invocar(comando: string, datos?: unknown) {
      if (!Object.hasOwn(comandos, comando)) throw new Error(`Comando desconocido: ${comando}`);
      if (/^(respaldo:|adjunto:|config:respaldo|vigencia:|fiscal:|retencion:)/.test(comando)) {
        throw new Error('Esta función no está disponible aún en Android (solo ámbito administrativo)');
      }
      if (datos && typeof datos === 'object' && 'ambitoId' in datos && datos.ambitoId !== undefined && datos.ambitoId !== 'administrativo') {
        throw new Error('Android solo admite el ámbito administrativo');
      }
      return despachar(ctx, comando, datos);
    },
    cerrar() { db.close(); pool.pauseVfs(); }
  };
}
