import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { abrirBase, prepararRutasDatos } from '../src/main/db/conexion';
import { aplicarMigraciones } from '../src/main/db/aplicarMigraciones';
import { sembrarCatalogoBase } from '../src/main/servicios/cuentas';
import { despachar } from '../src/main/comandos';
import { registrarAdjunto, listarAdjuntos } from '../src/main/servicios/adjuntos';
import { respaldoPeriodicoSiCorresponde } from '../src/main/servicios/restauracion';
import { descubrirRespaldos, crearRespaldo } from '../src/main/servicios/respaldo';
import { manejarRestauracion } from '../src/main/servicios/restauracion';

let dir: string;
let rutaDb: string;
let rutas: ReturnType<typeof prepararRutasDatos>;
const abiertas: Array<ReturnType<typeof abrirBase>> = [];

function abrir(): ReturnType<typeof abrirBase> {
  const db = abrirBase(rutaDb);
  aplicarMigraciones(db);
  abiertas.push(db);
  return db;
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arkon-a26-'));
  rutas = prepararRutasDatos(path.join(dir, 'datos'));
  rutaDb = path.join(rutas.datos, 'op.db');
  const db = abrir();
  db.prepare("INSERT INTO ambito (id, nombre, tipo) VALUES ('administrativo', 'Prueba a26', 'administrativo')").run();
  sembrarCatalogoBase(db, 'prueba');
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

function contexto() {
  const db = abrir();
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
      aplicarMigraciones(this.db);
    }
  };
}

describe('auditoría 26: despachar real de adjuntos y respaldo periódico', () => {
  it('adjunto:listar desde despachar devuelve adjuntos persistidos y la asociación sobrevive reabrir', async () => {
    const ctx = contexto();
    const resultado = despachar(ctx, 'adjunto:listar', {}) as Array<{ id: number; entidad: string }>;
    expect(resultado).toEqual([]);

    const origen = path.join(dir, 'doc-sintetico.txt');
    fs.writeFileSync(origen, 'contenido sintético a26', 'utf8');
    registrarAdjunto(ctx.db, rutas.adjuntos, {
      entidad: 'compra',
      entidadId: 'CMP-000001',
      nombreOriginal: 'doc-sintetico.txt',
      rutaOrigen: origen,
      responsable: 'p'
    });

    const trasRegistro = despachar(ctx, 'adjunto:listar', {}) as Array<{ id: number; entidad: string; entidadId: string; nombreOriginal: string }>;
    expect(trasRegistro).toHaveLength(1);
    expect(trasRegistro[0]?.entidad).toBe('compra');
    expect(trasRegistro[0]?.entidadId).toBe('CMP-000001');
    expect(trasRegistro[0]?.nombreOriginal).toBe('doc-sintetico.txt');

    const filtrado = despachar(ctx, 'adjunto:listar', { entidad: 'compra', entidadId: 'CMP-000001' }) as unknown[];
    expect(filtrado).toHaveLength(1);

    ctx.db.close();
    const idx = abiertas.findIndex(d => !d.open);
    if (idx >= 0) {
      abiertas.splice(idx, 1);
    }
    const ctxReabierto = contexto();
    const trasReabrir = despachar(ctxReabierto, 'adjunto:listar', {}) as Array<{ entidadId: string }>;
    expect(trasReabrir).toHaveLength(1);
    expect(trasReabrir[0]?.entidadId).toBe('CMP-000001');
    ctxReabierto.db.close();
  });

  it('config:respaldoPeriodicoLeer/Guardar desde despachar persiste y valida', () => {
    const ctx = contexto();
    const inicial = despachar(ctx, 'config:respaldoPeriodicoLeer', {}) as { intervaloMinutos: number; retencion: number };
    expect(inicial.intervaloMinutos).toBe(0);
    expect(inicial.retencion).toBe(5);

    despachar(ctx, 'config:respaldoPeriodicoGuardar', { intervaloMinutos: 45, retencion: 3 });
    const trasGuardar = despachar(ctx, 'config:respaldoPeriodicoLeer', {}) as { intervaloMinutos: number; retencion: number };
    expect(trasGuardar.intervaloMinutos).toBe(45);
    expect(trasGuardar.retencion).toBe(3);

    expect(() => despachar(ctx, 'config:respaldoPeriodicoGuardar', { intervaloMinutos: -1, retencion: 3 })).toThrow(/Intervalo inválido/);
    expect(() => despachar(ctx, 'config:respaldoPeriodicoGuardar', { intervaloMinutos: 45, retencion: 0 })).toThrow(/Retención inválida/);
    expect(() => despachar(ctx, 'config:respaldoPeriodicoGuardar', { intervaloMinutos: 2000, retencion: 3 })).toThrow(/Intervalo inválido/);

    const evento = ctx.db
      .prepare("SELECT COUNT(*) AS n FROM bitacora_evento WHERE tipo = 'config_respaldo_periodico'")
      .get() as { n: number };
    expect(evento.n).toBe(1);
  });

  it('respaldo:ejecutarPeriodico desde despachar crea paquete automático y se restaura en otro perfil', async () => {
    const ctx = contexto();
    const origen = path.join(dir, 'auto-a26.txt');
    fs.writeFileSync(origen, 'adjunto automático a26', 'utf8');
    registrarAdjunto(ctx.db, rutas.adjuntos, {
      entidad: 'compra',
      entidadId: 'CMP-000001',
      nombreOriginal: 'auto-a26.txt',
      rutaOrigen: origen,
      responsable: 'p'
    });

    despachar(ctx, 'config:respaldoPeriodicoGuardar', { intervaloMinutos: 60, retencion: 5 });
    const resultado = (await despachar(ctx, 'respaldo:ejecutarPeriodico', undefined)) as { creado: boolean; nombre?: string };
    expect(resultado.creado).toBe(true);
    expect(resultado.nombre).toBeTruthy();

    const trasCrear = (await despachar(ctx, 'respaldo:ejecutarPeriodico', undefined)) as { creado: boolean; omitidoPor?: string };
    expect(trasCrear.creado).toBe(false);
    expect(trasCrear.omitidoPor).toContain('último respaldo automático');

    const copias = descubrirRespaldos(rutas.respaldos);
    expect(copias.some(c => c.nombre === resultado.nombre)).toBe(true);
    ctx.db.close();

    const rutasOtro = prepararRutasDatos(path.join(dir, 'otro-perfil'));
    fs.mkdirSync(rutasOtro.respaldos, { recursive: true });
    fs.copyFileSync(path.join(rutas.respaldos, resultado.nombre as string), path.join(rutasOtro.respaldos, resultado.nombre as string));
    fs.copyFileSync(
      path.join(rutas.respaldos, `${resultado.nombre}.manifest.json`),
      path.join(rutasOtro.respaldos, `${resultado.nombre}.manifest.json`)
    );
    fs.cpSync(path.join(rutas.respaldos, `${resultado.nombre}-adjuntos`), path.join(rutasOtro.respaldos, `${resultado.nombre}-adjuntos`), { recursive: true });

    const rutaOtro = path.join(rutasOtro.datos, 'otro.db');
    const dbOtro = abrirBase(rutaOtro);
    aplicarMigraciones(dbOtro);
    dbOtro.close();
    const ctxOtro = {
      db: abrirBase(rutaOtro),
      rutas: { ...rutasOtro, respaldos: rutas.respaldos },
      versionApp: 'prueba',
      rutaDb: rutaOtro,
      reabrirBase(this: { db: ReturnType<typeof abrirBase> }) {
        if (this.db.open) {
          this.db.close();
        }
        this.db = abrirBase(rutaOtro);
      }
    };
    const restaurado = await manejarRestauracion(ctxOtro, resultado.nombre as string);
    expect(restaurado.ok).toBe(true);
    const adjuntosRestaurados = listarAdjuntos(ctxOtro.db);
    expect(adjuntosRestaurados).toHaveLength(1);
    expect(adjuntosRestaurados[0]?.nombreOriginal).toBe('auto-a26.txt');
    const contenido = fs.readFileSync(path.join(rutasOtro.adjuntos, adjuntosRestaurados[0].rutaRelativa), 'utf8');
    expect(contenido).toBe('adjunto automático a26');
    ctxOtro.db.close();
  });
});
