import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { abrirBase, prepararRutasDatos } from '../src/main/db/conexion';
import { aplicarMigraciones } from '../src/main/db/aplicarMigraciones';
import { sembrarCatalogoBase } from '../src/main/servicios/cuentas';
import { registrarAdjunto } from '../src/main/servicios/adjuntos';
import { crearRespaldo, descubrirRespaldos } from '../src/main/servicios/respaldo';
import { manejarRestauracion } from '../src/main/servicios/restauracion';
import { despachar } from '../src/main/comandos';

let dir: string;
const abiertas: Array<ReturnType<typeof abrirBase>> = [];

function abrir(ruta: string): ReturnType<typeof abrirBase> {
  const db = abrirBase(ruta);
  aplicarMigraciones(db);
  abiertas.push(db);
  return db;
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arkon-rev22-'));
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

function baseConAmbito(ruta: string): ReturnType<typeof abrirBase> {
  const db = abrir(ruta);
  db.prepare("INSERT INTO ambito (id, nombre, tipo) VALUES ('administrativo', 'Prueba rev22', 'administrativo')").run();
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

describe('vigesimasegunda revisión: inventario de adjuntos desde la base', () => {
  it('respaldo:crear rechaza un adjunto registrado cuyo archivo falta, sin crear paquete', async () => {
    const ruta = path.join(dir, 'op.db');
    const db = baseConAmbito(ruta);
    const rutas = prepararRutasDatos(path.join(dir, 'datos'));
    const origen = path.join(dir, 'soporte.txt');
    fs.writeFileSync(origen, 'contenido sintético', 'utf8');
    const adjunto = registrarAdjunto(db, rutas.adjuntos, {
      entidad: 'compra',
      entidadId: 'CMP-000001',
      nombreOriginal: 'soporte.txt',
      rutaOrigen: origen,
      responsable: 'p'
    });
    fs.rmSync(path.join(rutas.adjuntos, adjunto.rutaRelativa));
    const ctx = contextoManual(rutas, ruta);
    await expect(despachar(ctx, 'respaldo:crear', undefined)).rejects.toThrow(/Falta el archivo del adjunto registrado/);
    const copias = descubrirRespaldos(rutas.respaldos);
    expect(copias).toHaveLength(0);
    db.close();
  });

  it('respaldo:crear rechaza un adjunto cuyo archivo no coincide con su hash documentado', async () => {
    const ruta = path.join(dir, 'op2.db');
    const db = baseConAmbito(ruta);
    const rutas = prepararRutasDatos(path.join(dir, 'datos2'));
    const origen = path.join(dir, 'soporte2.txt');
    fs.writeFileSync(origen, 'contenido original sintético', 'utf8');
    const adjunto = registrarAdjunto(db, rutas.adjuntos, {
      entidad: 'compra',
      entidadId: 'CMP-000001',
      nombreOriginal: 'soporte2.txt',
      rutaOrigen: origen,
      responsable: 'p'
    });
    fs.writeFileSync(path.join(rutas.adjuntos, adjunto.rutaRelativa), 'contenido alterado', 'utf8');
    const ctx = contextoManual(rutas, ruta);
    await expect(despachar(ctx, 'respaldo:crear', undefined)).rejects.toThrow(/no coincide con su hash documentado/);
    db.close();
  });

  it('esquemas sin tabla de adjuntos respaldan con inventario vacío (política explícita)', async () => {
    const ruta = path.join(dir, 'op3.db');
    const db = baseConAmbito(ruta);
    const rutas = prepararRutasDatos(path.join(dir, 'datos3'));
    const ctx = contextoManual(rutas, ruta);
    const info = (await despachar(ctx, 'respaldo:crear', undefined)) as { nombre: string };
    const manifiesto = JSON.parse(fs.readFileSync(path.join(rutas.respaldos, `${info.nombre}.manifest.json`), 'utf8')) as { adjuntos: unknown[] };
    expect(manifiesto.adjuntos).toHaveLength(0);
    db.close();
  });
});

describe('vigesimasegunda revisión: recuperación coordinada ante fallos', () => {
  it('un fallo al activar los adjuntos restaura base y adjuntos anteriores y deja conexión utilizable', async () => {
    const ruta = path.join(dir, 'op4.db');
    const db = baseConAmbito(ruta);
    const rutas = prepararRutasDatos(path.join(dir, 'datos4'));
    const origen = path.join(dir, 'soporte4.txt');
    fs.writeFileSync(origen, 'contenido previo sintético', 'utf8');
    const adjunto = registrarAdjunto(db, rutas.adjuntos, {
      entidad: 'compra',
      entidadId: 'CMP-000001',
      nombreOriginal: 'soporte4.txt',
      rutaOrigen: origen,
      responsable: 'p'
    });
    const info = await crearRespaldo(db, rutas.respaldos, 'prueba', rutas.adjuntos);
    db.prepare(
      "INSERT INTO bitacora_evento (actor, tipo, entidad, entidad_id, detalle) VALUES ('p', 'marca_post_respaldo', 'prueba', 'marca', 'dato distintivo posterior al respaldo')"
    ).run();
    db.close();
    const contenidoPreviaAdjunto = fs.readFileSync(path.join(rutas.adjuntos, adjunto.rutaRelativa));
    const indice = abiertas.findIndex(d => !d.open);
    if (indice >= 0) {
      abiertas.splice(indice, 1);
    }

    const ctx = contextoManual(rutas, ruta);
    const fsReal = fs.renameSync;
    let fallosRestantes = 1;
    (fs as unknown as { renameSync: (...args: unknown[]) => void }).renameSync = (...args: unknown[]) => {
      const destino = String(args[1]);
      if (destino === rutas.adjuntos && fallosRestantes > 0) {
        fallosRestantes--;
        throw new Error('Fallo simulado al activar adjuntos');
      }
      return (fsReal as (...a: unknown[]) => void)(...args);
    };
    let error: unknown;
    try {
      manejarRestauracion(ctx, info.nombre);
    } catch (err) {
      error = err;
    } finally {
      (fs as unknown as { renameSync: (...args: unknown[]) => void }).renameSync = fsReal;
    }
    expect(error).toBeTruthy();
    expect(String(error)).not.toContain('recuperación incompleta');
    expect(ctx.db.open).toBe(true);
    const marcaPrevia = ctx.db
      .prepare("SELECT COUNT(*) AS n FROM bitacora_evento WHERE tipo = 'marca_post_respaldo'")
      .get() as { n: number };
    expect(marcaPrevia.n).toBe(1);
    const adjuntoTras = fs.readFileSync(path.join(rutas.adjuntos, adjunto.rutaRelativa));
    expect(adjuntoTras.equals(contenidoPreviaAdjunto)).toBe(true);
    ctx.db.close();
    const indiceCtx = abiertas.findIndex(d => !d.open);
    if (indiceCtx >= 0) {
      abiertas.splice(indiceCtx, 1);
    }
  });
});
