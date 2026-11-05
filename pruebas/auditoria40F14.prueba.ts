import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { abrirBase, prepararRutasDatos } from '../src/main/db/conexion';
import { aplicarMigraciones } from '../src/main/db/aplicarMigraciones';
import { sembrarCatalogoBase } from '../src/main/servicios/cuentas';
import { despachar } from '../src/main/comandos';
import {
  diagnosticarAnexoRetencionesF14,
  exportarAnexoRetencionesF14Presentacion,
  completarMetadatosRetencion,
  FUENTE_OFICIAL_F14
} from '../src/main/servicios/anexoF14';
import { registrarRetencion } from '../src/main/servicios/fiscal';
import { crearContraparte } from '../src/main/servicios/operacion';
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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arkon-a40-'));
  rutas = prepararRutasDatos(path.join(dir, 'datos'));
  rutaDb = path.join(rutas.datos, 'op.db');
  fs.mkdirSync(rutas.datos, { recursive: true });
  const db = abrir();
  sembrarCatalogoBase(db);
  db.prepare("INSERT INTO ambito (id, nombre, tipo) VALUES ('administrativo', 'Prueba a40', 'administrativo')").run();
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

function contexto(db: BetterSqlite3.Database) {
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

describe('auditoría 40: Anexo de Retenciones F-14 v16 (matriz A-W oficial)', () => {
  it('diagnóstico bloquea sin metadatos; completar por vía auditada persiste; exportación con 23 columnas exactas', () => {
    const db = abrir();
    const ctx = contexto(db);
    despachar(ctx, 'vigencia:crear', {
      desde: '2026-01-01',
      inscritoIva: true,
      descripcion: 'vigencia sintética aislada',
      fuente: 'prueba sintética',
      responsable: 'p'
    });
    const proveedor = crearContraparte(db, { nombre: 'Proveedor Retencion A40', esCliente: false, esProveedor: true, responsable: 'p', nit: '0614-777888-101-5' });
    const retencion = registrarRetencion(db, {
      tipo: 'efectuada',
      contraparteId: proveedor,
      fechaOperacion: '2026-11-10',
      base: '1000.00',
      tasa: '10',
      regla: 'regla sintética de prueba',
      concepto: 'retención sintética',
      claveIdempotencia: 'ret-a40',
      responsable: 'p'
    });

    const bloqueado = despachar(ctx, 'fiscal:anexoRetenciones', { mes: '2026-11' }) as {
      folios: Array<{ folio: string; documentoId: number; faltantes: string[] }>;
      bloqueado: boolean;
      fuente: string;
    };
    expect(bloqueado.bloqueado).toBe(true);
    expect(bloqueado.folios[0].documentoId).toBe(retencion.id);
    expect(bloqueado.fuente).toBe(FUENTE_OFICIAL_F14);
    expect(() => exportarAnexoRetencionesF14Presentacion(db, '2026-11')).toThrow(/bloqueado/);

    despachar(ctx, 'fiscal:retencionMetadatosCompletar', {
      retencionId: retencion.id,
      domiciliado: '1',
      codigoPais: '9300',
      nitNif: '0614-777888-101-5',
      codigoIngreso: '42',
      tipoOperacion: '1',
      clasificacion: '2',
      sector: '2',
      tipoCostoGasto: '1',
      responsable: 'p',
      motivo: 'completitud sintética'
    });

    // Persistencia tras reapertura.
    db.close();
    const db2 = abrir();
    const ctx2 = contexto(db2);
    const listo = despachar(ctx2, 'fiscal:anexoRetenciones', { mes: '2026-11' }) as {
      bloqueado: boolean;
      listos: string[];
    };
    expect(listo.bloqueado).toBe(false);
    expect(listo.listos).toContain(retencion.folio);

    const anexo = exportarAnexoRetencionesF14Presentacion(db2, '2026-11');
    expect(anexo.version).toBe('anexo-f14-v16-esquema1');
    expect(anexo.filas).toBe(1);
    const fila = anexo.csv.split('\n')[0].split(';');
    expect(fila).toHaveLength(23);
    expect(fila[0]).toBe('1');
    expect(fila[1]).toBe('9300');
    expect(fila[2]).toBe('PROVEEDOR RETENCION A40');
    expect(fila[3]).toBe('06147778881015');
    expect(fila[5]).toBe('42');
    expect(fila[6]).toBe('1000.00');
    expect(fila[7]).toBe('0.00');
    expect(fila[8]).toBe('100.00');
    expect(fila[18]).toBe('1');
    expect(fila[19]).toBe('2');
    expect(fila[20]).toBe('2');
    expect(fila[21]).toBe('1');
    expect(fila[22]).toBe('112026');

    // Revalidación: mutar el sector a un valor no dígito bloquea la exportación.
    db2.prepare('UPDATE retencion SET sector_f14 = ? WHERE id = ?').run('X', retencion.id);
    expect(() => exportarAnexoRetencionesF14Presentacion(db2, '2026-11')).toThrow(/de un dígito \(columna U\)/);
    db2.close();
  });

  it('rechaza formatos inválidos en la vía auditada: país, NIT, código de ingreso y S/T fuera de catálogo', () => {
    const db = abrir();
    const ctx = contexto(db);
    despachar(ctx, 'vigencia:crear', {
      desde: '2026-01-01',
      inscritoIva: true,
      descripcion: 'vigencia sintética aislada',
      fuente: 'prueba sintética',
      responsable: 'p'
    });
    const proveedor = crearContraparte(db, { nombre: 'Proveedor Validacion A40', esCliente: false, esProveedor: true, responsable: 'p' });
    const retencion = registrarRetencion(db, {
      tipo: 'efectuada',
      contraparteId: proveedor,
      fechaOperacion: '2026-11-10',
      base: '500.00',
      tasa: '10',
      regla: 'regla sintética de prueba',
      concepto: 'retención sintética',
      claveIdempotencia: 'ret-a40b',
      responsable: 'p'
    });

    const guardar = (overrides: Record<string, unknown>) =>
      despachar(ctx, 'fiscal:retencionMetadatosCompletar', {
        retencionId: retencion.id,
        domiciliado: '1',
        codigoPais: '9300',
        nitNif: '0614-777888-101-5',
        codigoIngreso: '42',
        tipoOperacion: '1',
        clasificacion: '2',
        sector: '2',
        tipoCostoGasto: '1',
        responsable: 'p',
        motivo: 'completitud sintética',
        ...overrides
      });

    expect(() => guardar({ codigoPais: '93' })).toThrow(/país inválido: 4 dígitos/);
    expect(() => guardar({ nitNif: 'ABC', dui: undefined })).toThrow(/NIT\/NIF inválido/);
    expect(() => guardar({ codigoIngreso: '4' })).toThrow(/Código de ingreso inválido: 2 dígitos/);
    expect(() => guardar({ tipoOperacion: '3' })).toThrow(/catálogo 1-2 \(o 9 por nota 9\)/);
    expect(() => guardar({ clasificacion: 'X' })).toThrow(/catálogo 1-2 \(o 9 por nota 9\)/);
    expect(() => guardar({ sector: 'X' })).toThrow(/Sector inválido/);
    expect(() => guardar({ responsable: '' })).toThrow(/Campo requerido: responsable/);
    expect(() => guardar({ motivo: ' ' })).toThrow(/Campo requerido: motivo/);

    // Nota 9: S=9/T=9 aceptados para instituciones públicas/no inscritos/no deducibles.
    guardar({ tipoOperacion: '9', clasificacion: '9', nitNif: undefined, dui: '123456789' });
    const anexo = exportarAnexoRetencionesF14Presentacion(db, '2026-11');
    const fila = anexo.csv.split('\n')[0].split(';');
    expect(fila[18]).toBe('9');
    expect(fila[19]).toBe('9');
    expect(fila[4]).toBe('123456789');
    db.close();
  });

  it('período anterior a 2024-02 exporta S/T/U/V en 0 y no los exige', () => {
    const db = abrir();
    const ctx = contexto(db);
    despachar(ctx, 'vigencia:crear', {
      desde: '2023-01-01',
      inscritoIva: true,
      descripcion: 'vigencia sintética aislada',
      fuente: 'prueba sintética',
      responsable: 'p'
    });
    const proveedor = crearContraparte(db, { nombre: 'Proveedor Antiguo A40', esCliente: false, esProveedor: true, responsable: 'p', nit: '0614-111222-101-5' });
    const retencion = registrarRetencion(db, {
      tipo: 'efectuada',
      contraparteId: proveedor,
      fechaOperacion: '2023-11-10',
      base: '300.00',
      tasa: '10',
      regla: 'regla sintética de prueba',
      concepto: 'retención sintética',
      claveIdempotencia: 'ret-a40c',
      responsable: 'p'
    });
    completarMetadatosRetencion(
      db,
      retencion.id,
      {
        domiciliado: '1',
        codigoPais: '9300',
        nitNif: '0614-111222-101-5',
        codigoIngreso: '42',
        tipoOperacion: '1',
        clasificacion: '2',
        sector: '2',
        tipoCostoGasto: '1'
      },
      'p',
      'completitud sintética'
    );
    const anexo = exportarAnexoRetencionesF14Presentacion(db, '2023-11');
    const fila = anexo.csv.split('\n')[0].split(';');
    expect(fila[18]).toBe('0');
    expect(fila[19]).toBe('0');
    expect(fila[20]).toBe('0');
    expect(fila[21]).toBe('0');
    expect(fila[22]).toBe('112023');
    db.close();
  });
});
