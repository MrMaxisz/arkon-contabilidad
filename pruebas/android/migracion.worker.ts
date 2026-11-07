import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { SqliteWasmDatabaseAdapter } from '../../src/plataforma/sqliteWasm';
import { sha256 } from '../../src/shared/sha256';

globalThis.onmessage = async ({ data }) => {
  try {
    const sqlite = await sqlite3InitModule();
    const pool = await sqlite.installOpfsSAHPoolVfs({ name: 'opfs-sahpool', directory: '/arkon-administrativo', preserveOnInitFailure: true });
    if (data.verificar) {
      const huella = sha256(pool.exportFile('/arkon.db'));
      const copia = sha256(pool.exportFile('/arkon-premigracion.db'));
      const db = new SqliteWasmDatabaseAdapter(new pool.OpfsSAHPoolDb('/arkon.db'));
      const ausente = !db.prepare('SELECT 1 AS x FROM _migracion WHERE version = 1').get();
      db.prepare('INSERT INTO _migracion (version,nombre,aplicada_en) VALUES (1,?,?)').run(data.migracion.nombre, data.migracion.aplicada_en);
      db.close(); pool.pauseVfs();
      globalThis.postMessage({ huella, copia, ausente });
    } else {
      const db = new SqliteWasmDatabaseAdapter(new pool.OpfsSAHPoolDb('/arkon.db'));
      const migracion = db.prepare('SELECT nombre,aplicada_en FROM _migracion WHERE version = 1').get();
      // MAX(version) sigue actual, pero falta una migración y su SQL choca con ambito.
      db.prepare('DELETE FROM _migracion WHERE version = 1').run();
      db.close();
      const huella = sha256(pool.exportFile('/arkon.db'));
      pool.pauseVfs(); globalThis.postMessage({ huella, migracion });
    }
  } catch (error) { globalThis.postMessage({ error: String(error) }); }
};
