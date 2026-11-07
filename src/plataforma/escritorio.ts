import type Database from 'better-sqlite3';
import * as adjuntos from '../main/servicios/adjuntos';
import { comprobarIntegridad, type Plataforma } from './plataforma';

// Las dependencias nativas se resuelven únicamente al solicitar escritorio.
export function crearPlataformaEscritorio(): Plataforma {
  const Database = require('better-sqlite3') as typeof import('better-sqlite3');
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  const crypto = require('crypto') as typeof import('crypto');
  const plataforma: Plataforma = {
    archivos: fs,
    rutas: path,
    prepararRutasDatos(raiz) {
      const rutas = { raiz, datos: path.join(raiz, 'datos'), adjuntos: path.join(raiz, 'adjuntos'), respaldos: path.join(raiz, 'respaldos'), registros: path.join(raiz, 'registros') };
      for (const dir of Object.values(rutas)) fs.mkdirSync(dir, { recursive: true });
      return rutas;
    },
    abrirBase(ruta): Database.Database {
      const db = new Database(ruta);
      db.pragma('journal_mode = WAL');
      db.pragma('foreign_keys = ON');
      db.pragma('synchronous = FULL');
      db.pragma('busy_timeout = 5000');
      return db;
    },
    abrirCopia: (ruta, soloLectura = false) => new Database(ruta, { readonly: soloLectura, fileMustExist: true }),
    copiarBase: async (db, destino) => { await db.backup(destino); },
    verificarIntegridad(ruta) {
      // query_only permite retirar los transitorios WAL/SHM al cerrar.
      const db = plataforma.abrirCopia(ruta);
      try {
        db.pragma('query_only = ON');
        comprobarIntegridad(db);
      } finally { db.close(); }
    },
    hashArchivo: ruta => crypto.createHash('sha256').update(fs.readFileSync(ruta)).digest('hex'),
    copiarAdjuntosRespaldo: (db, origen, destino) => adjuntos.copiarAdjuntosRespaldo(db, origen, destino, plataforma),
    restaurarAdjuntosRespaldo: (origen, destino, esperados) => adjuntos.restaurarAdjuntosRespaldo(origen, destino, esperados, plataforma),
    retencionRespaldosAutomaticos: (db, dir) => adjuntos.retencionRespaldosAutomaticos(db, dir, plataforma),
    inventarioAdjuntosRegistrado: adjuntos.inventarioAdjuntosRegistrado,
    validarRutasRelativas: rutas => adjuntos.validarRutasRelativas(rutas, plataforma)
  };
  return plataforma;
}
