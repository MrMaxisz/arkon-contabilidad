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
import { crearContextoBase, manejarRestauracion, respaldoPeriodicoSiCorresponde, ErrorRecuperacionPendiente } from '../src/main/servicios/restauracion';

let dir: string;
let distListo = false;
const abiertas: Array<ReturnType<typeof abrirBase>> = [];

function abrir(ruta: string): ReturnType<typeof abrirBase> {
  const db = abrirBase(ruta);
  aplicarMigraciones(db);
  abiertas.push(db);
  return db;
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arkon-audit25-'));
  if (!distListo) {
    const { execSync } = await import('child_process');
    execSync('npx tsc -p tsconfig.node.json', { cwd: path.resolve(__dirname, '..'), stdio: 'pipe' });
    distListo = true;
  }
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

const SCRIPT_INTERRUPCION_TRAS_ADJ = `
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
  if (paso === 2) {
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

function prepararPerfilConRespaldo(sufijo: string, marcaNueva: string, marcaAnterior: string): {
  rutasDestino: ReturnType<typeof prepararRutasDatos>;
  rutaDestino: string;
  info: { nombre: string };
  adjuntoNuevoRuta: string;
} {
  const rutaOrigen = path.join(dir, `origen-${sufijo}.db`);
  const dbOrigen = baseConAmbito(rutaOrigen, marcaNueva);
  const rutasOrigen = prepararRutasDatos(path.join(dir, `datos-origen-${sufijo}`));
  const archivoOrigen = path.join(dir, `nuevo-${sufijo}.txt`);
  fs.writeFileSync(archivoOrigen, `adjunto nuevo ${sufijo}`, 'utf8');
  const adjuntoNuevo = registrarAdjunto(dbOrigen, rutasOrigen.adjuntos, {
    entidad: 'compra',
    entidadId: 'C1',
    nombreOriginal: `nuevo-${sufijo}.txt`,
    rutaOrigen: archivoOrigen,
    responsable: 'p'
  });
  void crearRespaldo;
  return { rutasDestino: rutasOrigen, rutaDestino: rutaOrigen, info: { nombre: '' }, adjuntoNuevoRuta: adjuntoNuevo.rutaRelativa };
}

describe('auditoría 25: matriz de recuperación', () => {
  it('base activa ausente tras interrupción: se elige conjunto válido antes de limpiar copias', async () => {
    const rutaOrigen = path.join(dir, 'origen-a25a.db');
    const dbOrigen = baseConAmbito(rutaOrigen, 'base-nueva-a25a');
    const rutasOrigen = prepararRutasDatos(path.join(dir, 'datos-origen-a25a'));
    const archivoOrigen = path.join(dir, 'nuevo-a25a.txt');
    fs.writeFileSync(archivoOrigen, 'adjunto nuevo a25a', 'utf8');
    registrarAdjunto(dbOrigen, rutasOrigen.adjuntos, {
      entidad: 'compra',
      entidadId: 'C1',
      nombreOriginal: 'nuevo-a25a.txt',
      rutaOrigen: archivoOrigen,
      responsable: 'p'
    });
    const info = await crearRespaldo(dbOrigen, rutasOrigen.respaldos, 'prueba', rutasOrigen.adjuntos);
    dbOrigen.close();

    const rutasDestino = prepararRutasDatos(path.join(dir, 'datos-destino-a25a'));
    fs.mkdirSync(rutasDestino.respaldos, { recursive: true });
    fs.copyFileSync(path.join(rutasOrigen.respaldos, info.nombre), path.join(rutasDestino.respaldos, info.nombre));
    fs.copyFileSync(path.join(rutasOrigen.respaldos, `${info.nombre}.manifest.json`), path.join(rutasDestino.respaldos, `${info.nombre}.manifest.json`));
    fs.cpSync(path.join(rutasOrigen.respaldos, `${info.nombre}-adjuntos`), path.join(rutasDestino.respaldos, `${info.nombre}-adjuntos`), { recursive: true });

    const rutaDestino = path.join(rutasDestino.datos, 'destino-a25a.db');
    const dbDestino = baseConAmbito(rutaDestino, 'base-anterior-a25a');
    const archivoAnterior = path.join(dir, 'anterior-a25a.txt');
    fs.writeFileSync(archivoAnterior, 'adjunto anterior a25a', 'utf8');
    registrarAdjunto(dbDestino, rutasDestino.adjuntos, {
      entidad: 'compra',
      entidadId: 'C2',
      nombreOriginal: 'anterior-a25a.txt',
      rutaOrigen: archivoAnterior,
      responsable: 'p'
    });
    dbDestino.close();

    const script = path.join(dir, 'interrupcion-a25a.cjs');
    fs.writeFileSync(script, SCRIPT_INTERRUPCION_TRAS_BASE, 'utf8');
    let salida: { status: number } = { status: 0 };
    try {
      execFileSync('node', [script, JSON.stringify(rutasDestino), info.nombre, rutaDestino], { stdio: 'pipe' });
    } catch (err) {
      salida = err as { status: number };
    }
    expect(salida.status).toBe(86);
    const basePrevia = `${rutaDestino}.antes-restauracion`;
    expect(fs.existsSync(basePrevia)).toBe(true);

    fs.rmSync(rutaDestino);

    const ctx = await crearContextoBase(rutasDestino, rutaDestino, 'prueba');
    const ambito = ctx.db.prepare('SELECT nombre FROM ambito LIMIT 1').get() as { nombre: string };
    expect(ambito.nombre).toBe('base-anterior-a25a');
    const inventario = ctx.db.prepare('SELECT ruta_relativa FROM adjunto').all() as Array<{ ruta_relativa: string }>;
    expect(inventario).toHaveLength(1);
    expect(fs.existsSync(path.join(rutasDestino.adjuntos, inventario[0].ruta_relativa))).toBe(true);
    const contenido = fs.readFileSync(path.join(rutasDestino.adjuntos, inventario[0].ruta_relativa), 'utf8');
    expect(contenido).toBe('adjunto anterior a25a');
    ctx.db.close();
    const idx = abiertas.findIndex(d => !d.open);
    if (idx >= 0) {
      abiertas.splice(idx, 1);
    }
  });

  it('ninguna combinación válida: arranque bloqueado con diagnóstico y copias preservadas', async () => {
    const rutaOrigen = path.join(dir, 'origen-a25b.db');
    const dbOrigen = baseConAmbito(rutaOrigen, 'base-nueva-a25b');
    const rutasOrigen = prepararRutasDatos(path.join(dir, 'datos-origen-a25b'));
    const archivoOrigen = path.join(dir, 'nuevo-a25b.txt');
    fs.writeFileSync(archivoOrigen, 'adjunto nuevo a25b', 'utf8');
    registrarAdjunto(dbOrigen, rutasOrigen.adjuntos, {
      entidad: 'compra',
      entidadId: 'C1',
      nombreOriginal: 'nuevo-a25b.txt',
      rutaOrigen: archivoOrigen,
      responsable: 'p'
    });
    const info = await crearRespaldo(dbOrigen, rutasOrigen.respaldos, 'prueba', rutasOrigen.adjuntos);
    dbOrigen.close();

    const rutasDestino = prepararRutasDatos(path.join(dir, 'datos-destino-a25b'));
    fs.mkdirSync(rutasDestino.respaldos, { recursive: true });
    fs.copyFileSync(path.join(rutasOrigen.respaldos, info.nombre), path.join(rutasDestino.respaldos, info.nombre));
    fs.copyFileSync(path.join(rutasOrigen.respaldos, `${info.nombre}.manifest.json`), path.join(rutasDestino.respaldos, `${info.nombre}.manifest.json`));
    fs.cpSync(path.join(rutasOrigen.respaldos, `${info.nombre}-adjuntos`), path.join(rutasDestino.respaldos, `${info.nombre}-adjuntos`), { recursive: true });

    const rutaDestino = path.join(rutasDestino.datos, 'destino-a25b.db');
    const dbDestino = baseConAmbito(rutaDestino, 'base-anterior-a25b');
    const archivoAnterior = path.join(dir, 'anterior-a25b.txt');
    fs.writeFileSync(archivoAnterior, 'adjunto anterior a25b', 'utf8');
    registrarAdjunto(dbDestino, rutasDestino.adjuntos, {
      entidad: 'compra',
      entidadId: 'C2',
      nombreOriginal: 'anterior-a25b.txt',
      rutaOrigen: archivoAnterior,
      responsable: 'p'
    });
    dbDestino.close();

    const script = path.join(dir, 'interrupcion-a25b.cjs');
    fs.writeFileSync(script, SCRIPT_INTERRUPCION_TRAS_ADJ, 'utf8');
    let salida: { status: number } = { status: 0 };
    try {
      execFileSync('node', [script, JSON.stringify(rutasDestino), info.nombre, rutaDestino], { stdio: 'pipe' });
    } catch (err) {
      salida = err as { status: number };
    }
    expect(salida.status).toBe(86);

    const areaTemporal = `${rutasDestino.adjuntos}.restauracion-tmp`;
    const archivosTemporales = fs.readdirSync(areaTemporal);
    fs.writeFileSync(path.join(areaTemporal, archivosTemporales[0]), 'alterado', 'utf8');
    const previaAdjuntos = `${rutasDestino.adjuntos}.antes-restauracion`;
    if (fs.existsSync(previaAdjuntos)) {
      const archivosPrevios = fs.readdirSync(previaAdjuntos);
      fs.writeFileSync(path.join(previaAdjuntos, archivosPrevios[0]), 'alterado', 'utf8');
    }

    await expect(crearContextoBase(rutasDestino, rutaDestino, 'prueba')).rejects.toThrow(ErrorRecuperacionPendiente);
    expect(fs.existsSync(`${path.join(rutasDestino.raiz, 'restauracion-en-curso.json')}.sin-resolver`)).toBe(true);
    expect(fs.existsSync(`${rutaDestino}.antes-restauracion`)).toBe(true);
  });

  it('respaldo periódico: desactivado por defecto, activo con intervalo, omitido durante restauración pendiente', async () => {
    const ruta = path.join(dir, 'op-a25c.db');
    const db = baseConAmbito(ruta, 'periodico');
    const rutas = prepararRutasDatos(path.join(dir, 'datos-a25c'));
    const ctx = contextoManual(rutas, ruta);

    const desactivado = await respaldoPeriodicoSiCorresponde(ctx);
    expect(desactivado.creado).toBe(false);
    expect(desactivado.omitidoPor).toContain('desactivado');

    ctx.db.prepare("UPDATE configuracion SET valor = '60' WHERE clave = 'respaldo_intervalo_minutos'").run();
    const creado = await respaldoPeriodicoSiCorresponde(ctx);
    expect(creado.creado).toBe(true);
    expect(creado.nombre).toBeTruthy();
    expect(fs.existsSync(path.join(rutas.respaldos, creado.nombre as string))).toBe(true);

    const otraVez = await respaldoPeriodicoSiCorresponde(ctx);
    expect(otraVez.creado).toBe(false);
    expect(otraVez.omitidoPor).toContain('último respaldo automático');

    fs.writeFileSync(path.join(rutas.raiz, 'restauracion-en-curso.json'), '{}', 'utf8');
    const duranteRestauracion = await respaldoPeriodicoSiCorresponde(ctx);
    expect(duranteRestauracion.creado).toBe(false);
    expect(duranteRestauracion.omitidoPor).toContain('restauración');
    db.close();
    const idx = abiertas.findIndex(d => !d.open);
    if (idx >= 0) {
      abiertas.splice(idx, 1);
    }
  });
});
