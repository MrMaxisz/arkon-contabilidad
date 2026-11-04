import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { aplicarMigraciones } from '../src/main/db/aplicarMigraciones';
import { sembrarCatalogoBase } from '../src/main/servicios/cuentas';

export interface EntornoPrueba {
  db: Database.Database;
  dir: string;
  limpiar(): void;
}

export function entornoPrueba(): EntornoPrueba {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arkon-prueba-'));
  const db = new Database(path.join(dir, 'prueba.db'));
  db.pragma('foreign_keys = ON');
  aplicarMigraciones(db);
  db.prepare(
    "INSERT INTO ambito (id, nombre, tipo) VALUES ('administrativo', 'Pruebas', 'administrativo')"
  ).run();
  sembrarCatalogoBase(db, 'pruebas');
  return {
    db,
    dir,
    limpiar() {
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
}

export function idCuenta(db: Database.Database, codigo: string): number {
  const fila = db.prepare('SELECT id FROM cuenta WHERE codigo = ?').get(codigo) as { id: number };
  return fila.id;
}
