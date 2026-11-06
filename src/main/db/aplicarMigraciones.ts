import type Database from 'better-sqlite3';
import { migraciones } from './migraciones';
import { registroEvento } from '../servicios/bitacora';

export function versionEsquemaActual(): number {
  return migraciones[migraciones.length - 1]?.version ?? 0;
}

export function aplicarMigraciones(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS _migracion (
    version INTEGER PRIMARY KEY,
    nombre TEXT NOT NULL,
    aplicada_en TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  const aplicadas = new Set(
    (db.prepare('SELECT version FROM _migracion').all() as Array<{ version: number }>).map(r => r.version)
  );
  const pendientes = migraciones.filter(m => !aplicadas.has(m.version));
  if (pendientes.length === 0) {
    return;
  }
  const insertar = db.prepare('INSERT INTO _migracion (version, nombre) VALUES (?, ?)');
  const transaccion = db.transaction((lista: typeof pendientes) => {
    for (const m of lista) {
      db.exec(m.sql);
      insertar.run(m.version, m.nombre);
    }
  });
  transaccion(pendientes);
  const ultima = pendientes[pendientes.length - 1];
  if (!ultima) {
    return;
  }
  registroEvento(db, 'sistema', 'migracion', '_migracion', String(ultima.version), {
    aplicadas: pendientes.map(m => `${m.version}:${m.nombre}`)
  });
}
