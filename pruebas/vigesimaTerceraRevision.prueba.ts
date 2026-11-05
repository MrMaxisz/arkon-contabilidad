import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { abrirBase, prepararRutasDatos } from '../src/main/db/conexion';
import { aplicarMigraciones } from '../src/main/db/aplicarMigraciones';
import { sembrarCatalogoBase } from '../src/main/servicios/cuentas';
import { registrarAdjunto } from '../src/main/servicios/adjuntos';
import { crearRespaldo } from '../src/main/servicios/respaldo';
import { crearContextoBase, manejarRestauracion } from '../src/main/servicios/restauracion';

let dir: string;
const abiertas: Array<ReturnType<typeof abrirBase>> = [];

function abrir(ruta: string): ReturnType<typeof abrirBase> {
  const db = abrirBase(ruta);
  aplicarMigraciones(db);
  abiertas.push(db);
  return db;
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arkon-rev23-'));
});

afterEach(() => {
  for (const db of abiertas) {
    if (db.open) {
      db.close();
    }
  }
  abiertas.length = 0;
  fs.rmSync(dir, { recursive: true, force: true });
});

function baseConAmbito(ruta: string, marca: string): ReturnType<typeof abrirBase> {
  const db = abrir(ruta);
  db.prepare("INSERT INTO ambito (id, nombre, tipo) VALUES ('administrativo', ?, 'administrativo')").run(marca);
  sembrarCatalogoBase(db, 'prueba');
  return db;
}

function contextoManual(rutas: ReturnType<typeof prepararRutasDatos>, rutaDb: string) {
  const db = abrir(rutaDb);
  return {
    db,
    rutas,
    versionApp: 'prueba',
    rutaDb,
    reabrirBase(this: { db: ReturnType<typeof abrirBase> }) {
      if (this.db.open) {
        this.db.close();
      }
      this.db = abrirBase(rutaDb);
    }
  };
}

const SCRIPT_INTERRUPCION = `
const fs = require('fs');
const path = require('path');
const { abrirBase } = require(${JSON.stringify(path.resolve(__dirname, '../dist/main/db/conexion.js'))});
const { aplicarMigraciones } = require(${JSON.stringify(path.resolve(__dirname, '../dist/main/db/aplicarMigraciones.js'))});
const { manejarRestauracion } = require(${JSON.stringify(path.resolve(__dirname, '../dist/main/servicios/restauracion.js'))});
const rutas = JSON.parse(process.argv[2]);
const nombre = process.argv[3];
const rutaDb = process.argv[4];
const fsReal = fs.renameSync;
let paso = 0;
fs.renameSync = function (...args) {
  paso++;
  if (paso === 2) {
    process.exit(86);
  }
  return fsReal.apply(fs, args);
};
const db = abrirBase(rutaDb);
aplicarMigraciones(db);
const ctx = {
  db,
  rutas,
  versionApp: 'prueba',
  rutaDb,
  reabrirBase() {
    if (this.db.open) { this.db.close(); }
    this.db = abrirBase(rutaDb);
  }
};
manejarRestauracion(ctx, nombre).then(() => { db.close(); process.exit(0); }).catch(e => { console.error(e.message); process.exit(1); });
`;

describe('vigesimatercera revisión: restauración interrumpida', () => {
  it('una interrupción entre base y adjuntos se resuelve coherentemente al arrancar', async () => {
    const rutaOrigen = path.join(dir, 'origen.db');
    const dbOrigen = baseConAmbito(rutaOrigen, 'base-nueva-del-respaldo');
    const rutasOrigen = prepararRutasDatos(path.join(dir, 'datos-origen'));
    const archivoOrigen = path.join(dir, 'nuevo.txt');
    fs.writeFileSync(archivoOrigen, 'adjunto nuevo sintético', 'utf8');
    registrarAdjunto(dbOrigen, rutasOrigen.adjuntos, {
      entidad: 'compra',
      entidadId: 'CMP-000001',
      nombreOriginal: 'nuevo.txt',
      rutaOrigen: archivoOrigen,
      responsable: 'p'
    });
    const info = await crearRespaldo(dbOrigen, rutasOrigen.respaldos, 'prueba', rutasOrigen.adjuntos);
    dbOrigen.close();

    const rutasDestino = prepararRutasDatos(path.join(dir, 'datos-destino'));
    fs.mkdirSync(rutasDestino.respaldos, { recursive: true });
    fs.copyFileSync(path.join(rutasOrigen.respaldos, info.nombre), path.join(rutasDestino.respaldos, info.nombre));
    fs.copyFileSync(path.join(rutasOrigen.respaldos, `${info.nombre}.manifest.json`), path.join(rutasDestino.respaldos, `${info.nombre}.manifest.json`));
    fs.cpSync(path.join(rutasOrigen.respaldos, `${info.nombre}-adjuntos`), path.join(rutasDestino.respaldos, `${info.nombre}-adjuntos`), { recursive: true });

    const rutaDestino = path.join(rutasDestino.datos, 'destino.db');
    const dbDestino = baseConAmbito(rutaDestino, 'base-anterior-del-perfil');
    const archivoAnterior = path.join(dir, 'anterior.txt');
    fs.writeFileSync(archivoAnterior, 'adjunto anterior sintético', 'utf8');
    registrarAdjunto(dbDestino, rutasDestino.adjuntos, {
      entidad: 'compra',
      entidadId: 'CMP-000002',
      nombreOriginal: 'anterior.txt',
      rutaOrigen: archivoAnterior,
      responsable: 'p'
    });
    dbDestino.close();

    const script = path.join(dir, 'interrupcion.cjs');
    fs.writeFileSync(script, SCRIPT_INTERRUPCION, 'utf8');
    let salida: { status: number } = { status: 0 };
    try {
      execFileSync('node', [script, JSON.stringify(rutasDestino), info.nombre, rutaDestino], { stdio: 'pipe' });
    } catch (err) {
      salida = err as { status: number };
    }
    expect(salida.status).toBe(86);

    const marcadorExisteTrasInterrupcion = fs.existsSync(path.join(rutasDestino.raiz, 'restauracion-en-curso.json'));
    expect(marcadorExisteTrasInterrupcion).toBe(true);

    const ctx = await crearContextoBase(rutasDestino, rutaDestino, 'prueba');
    const ambito = ctx.db.prepare('SELECT nombre FROM ambito LIMIT 1').get() as { nombre: string };
    expect(ambito.nombre).toBe('base-nueva-del-respaldo');
    const inventario = ctx.db.prepare('SELECT ruta_relativa FROM adjunto').all() as Array<{ ruta_relativa: string }>;
    expect(inventario).toHaveLength(1);
    const archivoRestaurado = fs.readFileSync(path.join(rutasDestino.adjuntos, inventario[0].ruta_relativa), 'utf8');
    expect(archivoRestaurado).toBe('adjunto nuevo sintético');
    expect(fs.existsSync(path.join(rutasDestino.raiz, 'restauracion-en-curso.json'))).toBe(false);
    ctx.db.close();
    const idx = abiertas.findIndex(d => !d.open);
    if (idx >= 0) {
      abiertas.splice(idx, 1);
    }
  });
});

describe('vigesimatercera revisión: inventario registro por registro', () => {
  it('manifiesto con misma cantidad pero ruta distinta se rechaza', async () => {
    const ruta = path.join(dir, 'op.db');
    const db = baseConAmbito(ruta, 'inventario');
    const rutas = prepararRutasDatos(path.join(dir, 'datos'));
    const origen = path.join(dir, 'a.txt');
    fs.writeFileSync(origen, 'contenido sintético', 'utf8');
    const adjunto = registrarAdjunto(db, rutas.adjuntos, {
      entidad: 'compra',
      entidadId: 'C1',
      nombreOriginal: 'a.txt',
      rutaOrigen: origen,
      responsable: 'p'
    });
    const info = await crearRespaldo(db, rutas.respaldos, 'prueba', rutas.adjuntos);
    db.close();
    const idx = abiertas.findIndex(d => !d.open);
    if (idx >= 0) {
      abiertas.splice(idx, 1);
    }

    const rutaManifiesto = path.join(rutas.respaldos, `${info.nombre}.manifest.json`);
    const manifiesto = JSON.parse(fs.readFileSync(rutaManifiesto, 'utf8')) as {
      adjuntos: Array<{ rutaRelativa: string; hashSha256: string }>;
    };
    manifiesto.adjuntos = manifiesto.adjuntos.map(a => ({ ...a, rutaRelativa: 'ruta-distinta.txt' }));
    fs.writeFileSync(rutaManifiesto, JSON.stringify(manifiesto, null, 2), 'utf8');
    fs.renameSync(
      path.join(rutas.respaldos, `${info.nombre}-adjuntos`, adjunto.rutaRelativa),
      path.join(rutas.respaldos, `${info.nombre}-adjuntos`, 'ruta-distinta.txt')
    );

    const ctx = contextoManual(rutas, ruta);
    await expect(manejarRestauracion(ctx, info.nombre)).rejects.toThrow(/que el manifiesto no declara|discordante/);
    ctx.db.close();
    const idx2 = abiertas.findIndex(d => !d.open);
    if (idx2 >= 0) {
      abiertas.splice(idx2, 1);
    }
  });
});

const SCRIPT_INTERRUPCION_TRAS_BASE = `
const fs = require('fs');
const { abrirBase } = require(${JSON.stringify(path.resolve(__dirname, '../dist/main/db/conexion.js'))});
const { aplicarMigraciones } = require(${JSON.stringify(path.resolve(__dirname, '../dist/main/db/aplicarMigraciones.js'))});
const { manejarRestauracion } = require(${JSON.stringify(path.resolve(__dirname, '../dist/main/servicios/restauracion.js'))});
const rutas = JSON.parse(process.argv[2]);
const nombre = process.argv[3];
const rutaDb = process.argv[4];
const fsReal = fs.renameSync;
let paso = 0;
fs.renameSync = function (...args) {
  paso++;
  if (paso === 1) {
    const resultado = fsReal.apply(fs, args);
    process.exit(86);
  }
  return fsReal.apply(fs, args);
};
const db = abrirBase(rutaDb);
aplicarMigraciones(db);
const ctx = {
  db,
  rutas,
  versionApp: 'prueba',
  rutaDb,
  reabrirBase() {
    if (this.db.open) { this.db.close(); }
    this.db = abrirBase(rutaDb);
  }
};
manejarRestauracion(ctx, nombre).then(() => { db.close(); process.exit(0); }).catch(e => { console.error(e.message); process.exit(1); });
`;

describe('vigesimacuarta revisión: ventanas de interrupción y hashes al reiniciar', () => {
  it('interrupción inmediatamente tras sustituir SQLite (marcador atrasado) se resuelve por contenido', async () => {
    const rutaOrigen = path.join(dir, 'origen-v24.db');
    const dbOrigen = baseConAmbito(rutaOrigen, 'base-nueva-v24');
    const rutasOrigen = prepararRutasDatos(path.join(dir, 'datos-origen-v24'));
    const archivoOrigen = path.join(dir, 'nuevo-v24.txt');
    fs.writeFileSync(archivoOrigen, 'adjunto nuevo v24', 'utf8');
    registrarAdjunto(dbOrigen, rutasOrigen.adjuntos, {
      entidad: 'compra',
      entidadId: 'C1',
      nombreOriginal: 'nuevo-v24.txt',
      rutaOrigen: archivoOrigen,
      responsable: 'p'
    });
    const info = await crearRespaldo(dbOrigen, rutasOrigen.respaldos, 'prueba', rutasOrigen.adjuntos);
    dbOrigen.close();

    const rutasDestino = prepararRutasDatos(path.join(dir, 'datos-destino-v24'));
    fs.mkdirSync(rutasDestino.respaldos, { recursive: true });
    fs.copyFileSync(path.join(rutasOrigen.respaldos, info.nombre), path.join(rutasDestino.respaldos, info.nombre));
    fs.copyFileSync(path.join(rutasOrigen.respaldos, `${info.nombre}.manifest.json`), path.join(rutasDestino.respaldos, `${info.nombre}.manifest.json`));
    fs.cpSync(path.join(rutasOrigen.respaldos, `${info.nombre}-adjuntos`), path.join(rutasDestino.respaldos, `${info.nombre}-adjuntos`), { recursive: true });

    const rutaDestino = path.join(rutasDestino.datos, 'destino-v24.db');
    const dbDestino = baseConAmbito(rutaDestino, 'base-anterior-v24');
    const archivoAnterior = path.join(dir, 'anterior-v24.txt');
    fs.writeFileSync(archivoAnterior, 'adjunto anterior v24', 'utf8');
    registrarAdjunto(dbDestino, rutasDestino.adjuntos, {
      entidad: 'compra',
      entidadId: 'C2',
      nombreOriginal: 'anterior-v24.txt',
      rutaOrigen: archivoAnterior,
      responsable: 'p'
    });
    dbDestino.close();

    const script = path.join(dir, 'interrupcion-tras-base.cjs');
    fs.writeFileSync(script, SCRIPT_INTERRUPCION_TRAS_BASE, 'utf8');
    let salida: { status: number } = { status: 0 };
    try {
      execFileSync('node', [script, JSON.stringify(rutasDestino), info.nombre, rutaDestino], { stdio: 'pipe' });
    } catch (err) {
      salida = err as { status: number };
    }
    expect(salida.status).toBe(86);
    expect(fs.existsSync(path.join(rutasDestino.raiz, 'restauracion-en-curso.json'))).toBe(true);

    const ctx = await crearContextoBase(rutasDestino, rutaDestino, 'prueba');
    const ambito = ctx.db.prepare('SELECT nombre FROM ambito LIMIT 1').get() as { nombre: string };
    expect(ambito.nombre).toBe('base-nueva-v24');
    const inventario = ctx.db.prepare('SELECT ruta_relativa, hash_sha256 FROM adjunto').all() as Array<{ ruta_relativa: string; hash_sha256: string }>;
    expect(inventario).toHaveLength(1);
    const contenido = fs.readFileSync(path.join(rutasDestino.adjuntos, inventario[0].ruta_relativa), 'utf8');
    expect(contenido).toBe('adjunto nuevo v24');
    expect(fs.existsSync(path.join(rutasDestino.raiz, 'restauracion-en-curso.json'))).toBe(false);
    ctx.db.close();
    const idx = abiertas.findIndex(d => !d.open);
    if (idx >= 0) {
      abiertas.splice(idx, 1);
    }
  });

  it('un adjunto temporal alterado al reiniciar no se acepta y no se eliminan las copias', async () => {
    const rutaOrigen = path.join(dir, 'origen-v24b.db');
    const dbOrigen = baseConAmbito(rutaOrigen, 'base-nueva-v24b');
    const rutasOrigen = prepararRutasDatos(path.join(dir, 'datos-origen-v24b'));
    const archivoOrigen = path.join(dir, 'nuevo-v24b.txt');
    fs.writeFileSync(archivoOrigen, 'contenido original v24b', 'utf8');
    registrarAdjunto(dbOrigen, rutasOrigen.adjuntos, {
      entidad: 'compra',
      entidadId: 'C1',
      nombreOriginal: 'nuevo-v24b.txt',
      rutaOrigen: archivoOrigen,
      responsable: 'p'
    });
    const info = await crearRespaldo(dbOrigen, rutasOrigen.respaldos, 'prueba', rutasOrigen.adjuntos);
    dbOrigen.close();

    const rutasDestino = prepararRutasDatos(path.join(dir, 'datos-destino-v24b'));
    fs.mkdirSync(rutasDestino.respaldos, { recursive: true });
    fs.copyFileSync(path.join(rutasOrigen.respaldos, info.nombre), path.join(rutasDestino.respaldos, info.nombre));
    fs.copyFileSync(path.join(rutasOrigen.respaldos, `${info.nombre}.manifest.json`), path.join(rutasDestino.respaldos, `${info.nombre}.manifest.json`));
    fs.cpSync(path.join(rutasOrigen.respaldos, `${info.nombre}-adjuntos`), path.join(rutasDestino.respaldos, `${info.nombre}-adjuntos`), { recursive: true });

    const rutaDestino = path.join(rutasDestino.datos, 'destino-v24b.db');
    const dbDestino = baseConAmbito(rutaDestino, 'base-anterior-v24b');
    const archivoAnterior = path.join(dir, 'anterior-v24b.txt');
    fs.writeFileSync(archivoAnterior, 'adjunto anterior v24b', 'utf8');
    registrarAdjunto(dbDestino, rutasDestino.adjuntos, {
      entidad: 'compra',
      entidadId: 'C2',
      nombreOriginal: 'anterior-v24b.txt',
      rutaOrigen: archivoAnterior,
      responsable: 'p'
    });
    dbDestino.close();

    const script = path.join(dir, 'interrupcion-v24b.cjs');
    fs.writeFileSync(script, SCRIPT_INTERRUPCION.replace('paso === 2', 'paso === 2'), 'utf8');
    let salida: { status: number } = { status: 0 };
    try {
      execFileSync('node', [script, JSON.stringify(rutasDestino), info.nombre, rutaDestino], { stdio: 'pipe' });
    } catch (err) {
      salida = err as { status: number };
    }
    expect(salida.status).toBe(86);

    const areaTemporal = `${rutasDestino.adjuntos}.restauracion-tmp`;
    const archivosTemporales = fs.readdirSync(areaTemporal);
    expect(archivosTemporales.length).toBeGreaterThan(0);
    fs.writeFileSync(path.join(areaTemporal, archivosTemporales[0]), 'contenido alterado v24b', 'utf8');

    const ctx = await crearContextoBase(rutasDestino, rutaDestino, 'prueba');
    const ambito = ctx.db.prepare('SELECT nombre FROM ambito LIMIT 1').get() as { nombre: string };
    expect(ambito.nombre).toBe('base-anterior-v24b');
    const inventario = ctx.db.prepare('SELECT ruta_relativa FROM adjunto').all() as Array<{ ruta_relativa: string }>;
    expect(inventario).toHaveLength(1);
    const contenido = fs.readFileSync(path.join(rutasDestino.adjuntos, inventario[0].ruta_relativa), 'utf8');
    expect(contenido).toBe('adjunto anterior v24b');
    ctx.db.close();
    const idx = abiertas.findIndex(d => !d.open);
    if (idx >= 0) {
      abiertas.splice(idx, 1);
    }
  });
});
