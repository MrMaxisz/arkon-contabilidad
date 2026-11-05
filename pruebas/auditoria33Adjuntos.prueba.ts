import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { abrirBase, prepararRutasDatos } from '../src/main/db/conexion';
import { aplicarMigraciones } from '../src/main/db/aplicarMigraciones';
import { sembrarCatalogoBase } from '../src/main/servicios/cuentas';
import { despachar } from '../src/main/comandos';
import { registrarAdjunto } from '../src/main/servicios/adjuntos';
import { crearContraparte, registrarCompra } from '../src/main/servicios/operacion';
import type BetterSqlite3 from 'better-sqlite3';

let dir: string;
let rutaDb: string;
let rutas: ReturnType<typeof prepararRutasDatos>;
const abiertas: Array<BetterSqlite3.Database> = [];

function abrir(): BetterSqlite3.Database {
  const db = abrirBase(rutaDb);
  aplicarMigraciones(db);
  abiertas.push(db);
  return db;
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arkon-a33a-'));
  rutas = prepararRutasDatos(path.join(dir, 'datos'));
  rutaDb = path.join(rutas.datos, 'op.db');
  fs.mkdirSync(rutas.datos, { recursive: true });
  const db = abrir();
  sembrarCatalogoBase(db);
  db.prepare("INSERT INTO ambito (id, nombre, tipo) VALUES ('administrativo', 'Prueba a33a', 'administrativo')").run();
  db.close();
});

afterEach(() => {
  for (const db of abiertas.splice(0)) {
    if (db.open) {
      db.close();
    }
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

function contexto() {
  const db = abrir();
  return {
    db,
    rutas,
    versionApp: 'prueba',
    rutaDb,
    reabrirBase(this: { db: BetterSqlite3.Database }) {
      if (this.db.open) {
        this.db.close();
      }
      this.db = abrirBase(rutaDb);
      aplicarMigraciones(this.db);
    }
  };
}

describe('auditoría 33: verificación de adjuntos y vínculos de documento', () => {
  it('adjunto:verificar detecta hash alterado y archivo ausente por despachar real', () => {
    const ctx = contexto();
    const proveedor = crearContraparte(ctx.db, { nombre: 'Proveedor Adj A33', esCliente: false, esProveedor: true, responsable: 'p' });
    registrarCompra(ctx.db, {
      contraparteId: proveedor,
      fechaOperacion: '2026-11-02',
      concepto: 'Compra adjunto sintética',
      condicion: 'contado',
      lineas: [{ descripcion: 'Material sintético', cuentaCodigo: '5101', cantidad: '1', precioUnitario: '10.00', tasa: '0', tratamiento: 'exento' }],
      claveIdempotencia: 'c-a33a',
      responsable: 'p'
    });

    const origen = path.join(dir, 'doc-a33a.txt');
    fs.writeFileSync(origen, 'contenido sintético a33a', 'utf8');
    const adjunto = registrarAdjunto(ctx.db, rutas.adjuntos, {
      entidad: 'compra',
      entidadId: 'CMP-000001',
      nombreOriginal: 'doc-a33a.txt',
      rutaOrigen: origen,
      responsable: 'p'
    });

    const ok = despachar(ctx, 'adjunto:verificar', { id: adjunto.id }) as { existe: boolean; hashCoincide: boolean };
    expect(ok.existe).toBe(true);
    expect(ok.hashCoincide).toBe(true);

    fs.writeFileSync(path.join(rutas.adjuntos, adjunto.rutaRelativa), 'contenido alterado sintético', 'utf8');
    const alterado = despachar(ctx, 'adjunto:verificar', { id: adjunto.id }) as { existe: boolean; hashCoincide: boolean };
    expect(alterado.existe).toBe(true);
    expect(alterado.hashCoincide).toBe(false);

    fs.unlinkSync(path.join(rutas.adjuntos, adjunto.rutaRelativa));
    const ausente = despachar(ctx, 'adjunto:verificar', { id: adjunto.id }) as { existe: boolean; hashCoincide: boolean };
    expect(ausente.existe).toBe(false);
    expect(ausente.hashCoincide).toBe(false);

    expect(() => despachar(ctx, 'adjunto:verificar', { id: 99999 })).toThrow(/No existe el adjunto/);
    ctx.db.close();
  });

  it('documento:listarVinculos devuelve documentos reales para el selector', () => {
    const ctx = contexto();
    const cliente = crearContraparte(ctx.db, { nombre: 'Cliente Vinc A33', esCliente: true, esProveedor: false, responsable: 'p' });
    const proveedor = crearContraparte(ctx.db, { nombre: 'Proveedor Vinc A33', esCliente: false, esProveedor: true, responsable: 'p' });
    registrarCompra(ctx.db, {
      contraparteId: proveedor,
      fechaOperacion: '2026-11-02',
      concepto: 'Compra selector sintética',
      condicion: 'contado',
      lineas: [{ descripcion: 'Material sintético', cuentaCodigo: '5101', cantidad: '1', precioUnitario: '5.00', tasa: '0', tratamiento: 'exento' }],
      claveIdempotencia: 'c-vinc33',
      responsable: 'p'
    });
    void cliente;

    const vinculos = despachar(ctx, 'documento:listarVinculos', {}) as {
      venta: Array<{ folio: string }>;
      compra: Array<{ folio: string; concepto: string }>;
    };
    expect(vinculos.compra.length).toBeGreaterThan(0);
    expect(vinculos.compra.some(c => c.folio === 'CMP-000001' && c.concepto.includes('selector'))).toBe(true);
    expect(vinculos.venta).toHaveLength(0);
    ctx.db.close();
  });
});
