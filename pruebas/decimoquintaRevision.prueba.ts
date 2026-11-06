import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { abrirBase, prepararRutasDatos } from '../src/main/db/conexion';
import { aplicarMigraciones } from '../src/main/db/aplicarMigraciones';
import { sembrarCatalogoBase } from '../src/main/servicios/cuentas';
import { crearContraparte, registrarVenta, registrarCompra, listarVentas } from '../src/main/servicios/operacion';
import { despachar } from '../src/main/comandos';

let dir: string;
let rutaDb: string;
const abiertas: Array<ReturnType<typeof abrirBase>> = [];

function abrir(): ReturnType<typeof abrirBase> {
  const db = abrirBase(rutaDb);
  aplicarMigraciones(db);
  abiertas.push(db);
  return db;
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arkon-rev15-'));
  rutaDb = path.join(dir, 'operativa.db');
  const db = abrir();
  db.prepare(
    "INSERT INTO ambito (id, nombre, tipo) VALUES ('administrativo', 'Prueba rev15', 'administrativo')"
  ).run();
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

describe('decimoquinta revisión: contrato IPC de listados', () => {
  it('venta:listar y compra:listar aceptan llamadas sin opciones (datos undefined)', () => {
    const db = abrir();
    const rutas = prepararRutasDatos(path.join(dir, 'datos'));
    const ctx = {
      db,
      rutas,
      versionApp: 'prueba',
      rutaDb,
      reabrirBase() {
        this.db = abrir();
      }
    };
    const cliente = crearContraparte(db, { nombre: 'Cliente KK', esCliente: true, esProveedor: false, responsable: 'p' });
    registrarVenta(db, {
      contraparteId: cliente,
      fechaOperacion: '2026-11-01',
      concepto: 'Venta sintética',
      tipoIngreso: 'instalaciones',
      base: '10.00',
      tasa: '0',
      claveIdempotencia: 'v-kk',
      responsable: 'p'
    });
    const ventasSinOpciones = despachar(ctx, 'venta:listar', undefined) as Array<{ folio: string }>;
    expect(ventasSinOpciones).toHaveLength(1);
    const comprasSinOpciones = despachar(ctx, 'compra:listar', undefined) as Array<{ folio: string }>;
    expect(comprasSinOpciones).toHaveLength(0);
    const ventasConOpciones = despachar(ctx, 'venta:listar', { mes: '2026-10' }) as Array<{ folio: string }>;
    expect(ventasConOpciones).toHaveLength(0);
    const ventasConObjetoVacio = despachar(ctx, 'venta:listar', {}) as Array<{ folio: string }>;
    expect(ventasConObjetoVacio).toHaveLength(1);
    expect(() => despachar(ctx, 'venta:listar', 'texto-inválido')).toThrow(/Payload inválido/);
    expect(() => despachar(ctx, 'venta:listar', [1, 2])).toThrow(/Payload inválido/);
    db.close();
  });

  it('el filtro por mes del contrato devuelve el documento histórico correcto', () => {
    const db = abrir();
    const rutas = prepararRutasDatos(path.join(dir, 'datos'));
    const ctx = { db, rutas, versionApp: 'prueba', rutaDb, reabrirBase() { this.db = abrir(); } };
    const cliente = crearContraparte(db, { nombre: 'Cliente LL', esCliente: true, esProveedor: false, responsable: 'p' });
    const ventaAntigua = registrarVenta(db, {
      contraparteId: cliente,
      fechaOperacion: '2026-09-01',
      concepto: 'Venta antigua',
      tipoIngreso: 'instalaciones',
      base: '5.00',
      tasa: '0',
      claveIdempotencia: 'v-ll-antigua',
      responsable: 'p'
    });
    for (let i = 0; i < 5; i++) {
      registrarVenta(db, {
        contraparteId: cliente,
        fechaOperacion: '2026-10-01',
        concepto: `Venta reciente ${i}`,
        tipoIngreso: 'instalaciones',
        base: '1.00',
        tasa: '0',
        claveIdempotencia: `v-ll-${i}`,
        responsable: 'p'
      });
    }
    const filtradas = despachar(ctx, 'venta:listar', { mes: '2026-09', limite: 2, desde: 0 }) as Array<{ id: number }>;
    expect(filtradas).toHaveLength(1);
    expect(filtradas[0]?.id).toBe(ventaAntigua.id);
    expect(listarVentas(db, { mes: '2026-09' })).toHaveLength(1);
    db.close();
  });
});
