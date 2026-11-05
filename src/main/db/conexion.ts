import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

export interface RutasDatos {
  raiz: string;
  datos: string;
  adjuntos: string;
  respaldos: string;
  registros: string;
}

export function prepararRutasDatos(raiz: string): RutasDatos {
  const rutas: RutasDatos = {
    raiz,
    datos: path.join(raiz, 'datos'),
    adjuntos: path.join(raiz, 'adjuntos'),
    respaldos: path.join(raiz, 'respaldos'),
    registros: path.join(raiz, 'registros')
  };
  for (const dir of [rutas.raiz, rutas.datos, rutas.adjuntos, rutas.respaldos, rutas.registros]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return rutas;
}

export function abrirBase(rutaDb: string, opciones?: { readonly?: boolean; fileMustExist?: boolean }): Database.Database {
  const db = opciones?.readonly
    ? new Database(rutaDb, { readonly: true, fileMustExist: opciones.fileMustExist ?? true })
    : new Database(rutaDb);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = FULL');
  db.pragma('busy_timeout = 5000');
  return db;
}
