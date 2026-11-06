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
  leerMetadatosRetencion,
  completarMetadatosRetencion
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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arkon-a41-'));
  rutas = prepararRutasDatos(path.join(dir, 'datos'));
  rutaDb = path.join(rutas.datos, 'op.db');
  fs.mkdirSync(rutas.datos, { recursive: true });
  const db = abrir();
  sembrarCatalogoBase(db);
  db.prepare("INSERT INTO ambito (id, nombre, tipo) VALUES ('administrativo', 'Prueba a41', 'administrativo')").run();
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

function vigenciaF14Autorizada(ctx: ReturnType<typeof contexto>, desde = '2026-01-01', conIva = false) {
  despachar(ctx, 'vigencia:crear', {
    desde,
    inscritoIva: conIva,
    obligacionF14: true,
    descripcion: 'autorización F-14 sintética aislada',
    fuente: 'prueba sintética',
    responsable: 'p'
  });
}

describe('auditoría 41: Anexo F-14 v16 con dos sujetos, reglas propias y autorización separada del IVA', () => {
  it('dos sujetos distintos: archivo con DOS filas físicas de 23 campos y sumas conciliadas', () => {
    const db = abrir();
    const ctx = contexto(db);
    vigenciaF14Autorizada(ctx);

    const proveedorA = crearContraparte(db, { nombre: 'Proveedor Alfa A41', esCliente: false, esProveedor: true, responsable: 'p', nit: '0614-123456-101-5' });
    const proveedorB = crearContraparte(db, { nombre: 'Proveedor Beta A41', esCliente: false, esProveedor: true, responsable: 'p', nit: '0614-654321-101-5' });
    const retA = registrarRetencion(db, {
      tipo: 'efectuada', contraparteId: proveedorA, fechaOperacion: '2026-11-05',
      base: '1000.00', tasa: '10', regla: 'regla sintética', concepto: 'retención alfa sintética',
      claveIdempotencia: 'ret-a41-a', responsable: 'p'
    });
    const retB = registrarRetencion(db, {
      tipo: 'efectuada', contraparteId: proveedorB, fechaOperacion: '2026-11-20',
      base: '2000.00', tasa: '10', regla: 'regla sintética', concepto: 'retención beta sintética',
      claveIdempotencia: 'ret-a41-b', responsable: 'p'
    });

    const bloqueado = despachar(ctx, 'fiscal:anexoRetenciones', { mes: '2026-11' }) as { bloqueado: boolean };
    expect(bloqueado.bloqueado).toBe(true);

    for (const [ret, nit] of [[retA, '0614-123456-101-5'], [retB, '0614-654321-101-5']] as const) {
      despachar(ctx, 'fiscal:retencionMetadatosCompletar', {
        retencionId: ret.id,
        domiciliado: '1',
        codigoPais: '9300',
        nitNif: nit,
        codigoIngreso: '42',
        tipoOperacion: '1',
        clasificacion: '2',
        sector: '2',
        tipoCostoGasto: '1',
        involucraNomina: false,
        personaNatural: false,
        responsable: 'p',
        motivo: 'completitud sintética'
      });
    }

    // Reapertura conserva la identidad de CADA sujeto sin contaminación.
    db.close();
    const db2 = abrir();
    const ctx2 = contexto(db2);
    const lecturaA = leerMetadatosRetencion(db2, retA.id) as { nit_nif: string | null };
    const lecturaB = leerMetadatosRetencion(db2, retB.id) as { nit_nif: string | null };
    expect(lecturaA.nit_nif).toBe('06141234561015');
    expect(lecturaB.nit_nif).toBe('06146543211015');

    const listo = despachar(ctx2, 'fiscal:anexoRetenciones', { mes: '2026-11' }) as { bloqueado: boolean; listos: string[] };
    expect(listo.bloqueado).toBe(false);
    expect(listo.listos).toHaveLength(2);

    const anexo = exportarAnexoRetencionesF14Presentacion(db2, '2026-11');
    expect(anexo.filas).toBe(2);
    const lineasFisicas = anexo.csv.split('\n');
    expect(lineasFisicas).toHaveLength(2);
    expect(anexo.csv).not.toContain('\\n');
    const filaA = lineasFisicas[0]!.split(';');
    const filaB = lineasFisicas[1]!.split(';');
    expect(filaA).toHaveLength(23);
    expect(filaB).toHaveLength(23);
    expect(filaA[3]).toBe('06141234561015');
    expect(filaB[3]).toBe('06146543211015');
    expect(filaA[2]).toBe('PROVEEDOR ALFA A41');
    expect(filaB[2]).toBe('PROVEEDOR BETA A41');
    // Sumas conciliadas: devengado y retenido suman las dos retenciones.
    expect(Number(filaA[6]) + Number(filaB[6])).toBe(3000);
    expect(Number(filaA[8]) + Number(filaB[8])).toBe(300);
    db2.close();
  });

  it('reglas propias del F-14: A 1/2, D/E exclusivos, S 1-4, nota 9 completa y matriz T/U/V', () => {
    const db = abrir();
    const ctx = contexto(db);
    vigenciaF14Autorizada(ctx);
    const proveedor = crearContraparte(db, { nombre: 'Proveedor Reglas A41', esCliente: false, esProveedor: true, responsable: 'p', nit: '0614-999999-101-5' });
    const ret = registrarRetencion(db, {
      tipo: 'efectuada', contraparteId: proveedor, fechaOperacion: '2026-11-10',
      base: '500.00', tasa: '10', regla: 'regla sintética', concepto: 'retención sintética',
      claveIdempotencia: 'ret-a41-r', responsable: 'p'
    });

    const guardar = (overrides: Record<string, unknown>) =>
      despachar(ctx, 'fiscal:retencionMetadatosCompletar', {
        retencionId: ret.id,
        domiciliado: '1',
        codigoPais: '9300',
        nitNif: '0614-999999-101-5',
        codigoIngreso: '42',
        tipoOperacion: '1',
        clasificacion: '2',
        sector: '2',
        tipoCostoGasto: '1',
        involucraNomina: false,
        personaNatural: false,
        responsable: 'p',
        motivo: 'completitud sintética',
        ...overrides
      });

    expect(() => guardar({ domiciliado: '7' })).toThrow(/1 \(domiciliado\) o 2/);
    expect(() => guardar({ dui: '123456789' })).toThrow(/DUI solo corresponde a persona natural/);
    expect(() => guardar({ dui: '123456789', personaNatural: true })).toThrow(/no ambos/);
    expect(() => guardar({ tipoOperacion: '3', clasificacion: '2', sector: '2', tipoCostoGasto: '1' })).not.toThrow();
    expect(() => guardar({ tipoOperacion: '4' })).not.toThrow();
    expect(() => guardar({ tipoOperacion: '5' })).toThrow(/catálogo 1-4/);
    // Nota 9: los cuatro campos juntos o ninguno.
    expect(() => guardar({ tipoOperacion: '9', clasificacion: '1', sector: '2', tipoCostoGasto: '1' })).toThrow(/sin mezclas/);
    expect(() => guardar({ tipoOperacion: '9', clasificacion: '9', sector: '9', tipoCostoGasto: '9', nitNif: undefined, dui: '123456789', personaNatural: true })).not.toThrow();
    // Matriz T/U/V (página 6): T2 → V1-3; T1+U1 → V4-7; T1+U2 → V4-5.
    expect(() => guardar({ tipoOperacion: '1', clasificacion: '2', sector: '4', tipoCostoGasto: '3' })).not.toThrow();
    expect(() => guardar({ tipoOperacion: '1', clasificacion: '2', sector: '4', tipoCostoGasto: '4' })).toThrow(/matriz del manual F-14 v16/);
    expect(() => guardar({ tipoOperacion: '1', clasificacion: '1', sector: '1', tipoCostoGasto: '7' })).not.toThrow();
    expect(() => guardar({ tipoOperacion: '1', clasificacion: '1', sector: '2', tipoCostoGasto: '7' })).toThrow(/matriz del manual F-14 v16/);
    // Nómina: la declaración es obligatoria en el servicio (el comando siempre envía booleano).
    expect(() =>
      completarMetadatosRetencion(db, ret.id, {
        domiciliado: '1',
        codigoPais: '9300',
        nitNif: '0614-999999-101-5',
        codigoIngreso: '42',
        tipoOperacion: '1',
        clasificacion: '2',
        sector: '2',
        tipoCostoGasto: '1',
        involucraNomina: undefined as unknown as boolean,
        personaNatural: false
      }, 'p', 'motivo sintético')
    ).toThrow(/nómina/);
    despachar(ctx, 'fiscal:retencionMetadatosCompletar', {
      retencionId: ret.id, domiciliado: '1', codigoPais: '9300', nitNif: '0614-999999-101-5',
      codigoIngreso: '42', tipoOperacion: '1', clasificacion: '2', sector: '2', tipoCostoGasto: '1',
      involucraNomina: true, personaNatural: false, responsable: 'p', motivo: 'retención sobre nómina sintética'
    });
    const conNomina = despachar(ctx, 'fiscal:anexoRetenciones', { mes: '2026-11' }) as {
      folios: Array<{ folio: string; faltantes: string[] }>;
      bloqueado: boolean;
    };
    expect(conNomina.bloqueado).toBe(true);
    expect(conNomina.folios[0].faltantes.some(f => f.includes('bloqueada hasta que exista soporte de nómina'))).toBe(true);
    expect(() => exportarAnexoRetencionesF14Presentacion(db, '2026-11')).toThrow(/nómina/);
    db.close();
  });

  it('autorización F-14 separada del IVA: caso hipotético sin IVA autorizado y caso administrativo bloqueado', () => {
    const db = abrir();
    const ctx = contexto(db);
    // Caso administrativo: sin vigencia F-14 → bloqueado aunque los metadatos estén completos.
    const proveedor = crearContraparte(db, { nombre: 'Proveedor Auth A41', esCliente: false, esProveedor: true, responsable: 'p', nit: '0614-888888-101-5' });
    const ret = registrarRetencion(db, {
      tipo: 'efectuada', contraparteId: proveedor, fechaOperacion: '2026-11-10',
      base: '500.00', tasa: '10', regla: 'regla sintética', concepto: 'retención sintética',
      claveIdempotencia: 'ret-a41-auth', responsable: 'p'
    });
    despachar(ctx, 'fiscal:retencionMetadatosCompletar', {
      retencionId: ret.id, domiciliado: '1', codigoPais: '9300', nitNif: '0614-888888-101-5',
      codigoIngreso: '42', tipoOperacion: '1', clasificacion: '2', sector: '2', tipoCostoGasto: '1',
      involucraNomina: false, personaNatural: false, responsable: 'p', motivo: 'completitud sintética'
    });
    const sinAutorizacion = despachar(ctx, 'fiscal:anexoRetenciones', { mes: '2026-11' }) as {
      folios: Array<{ folio: string; faltantes: string[] }>;
      bloqueado: boolean;
    };
    expect(sinAutorizacion.bloqueado).toBe(true);
    expect(sinAutorizacion.folios[0].faltantes.some(f => f.includes('autorización de obligación F-14'))).toBe(true);
    expect(() => exportarAnexoRetencionesF14Presentacion(db, '2026-11')).toThrow(/autorización de obligación F-14/);

    // Caso hipotético autorizado: vigencia con obligacion_f14 SIN IVA inscrito → exportable (nota 9 contempla no inscritos).
    vigenciaF14Autorizada(ctx);
    const autorizado = despachar(ctx, 'fiscal:anexoRetenciones', { mes: '2026-11' }) as { bloqueado: boolean };
    expect(autorizado.bloqueado).toBe(false);
    const anexo = exportarAnexoRetencionesF14Presentacion(db, '2026-11');
    expect(anexo.filas).toBe(1);
    db.close();
  });
});

describe('auditoría 42: booleano estricto, catálogo de ingresos e identidad por fecha del F-14', () => {
  it('el comando rechaza involucraNomina/personaNatural ausentes sin mutar la retención', () => {
    const db = abrir();
    const ctx = contexto(db);
    vigenciaF14Autorizada(ctx);
    const proveedor = crearContraparte(db, { nombre: 'Proveedor Booleano A42', esCliente: false, esProveedor: true, responsable: 'p', nit: '0614-333222-101-5' });
    const ret = registrarRetencion(db, {
      tipo: 'efectuada', contraparteId: proveedor, fechaOperacion: '2026-11-10',
      base: '500.00', tasa: '10', regla: 'regla sintética', concepto: 'retención sintética',
      claveIdempotencia: 'ret-a42-b', responsable: 'p'
    });

    const base = {
      retencionId: ret.id, domiciliado: '1', codigoPais: '9300', nitNif: '0614-333222-101-5',
      codigoIngreso: '42', tipoOperacion: '1', clasificacion: '2', sector: '2', tipoCostoGasto: '1',
      responsable: 'p', motivo: 'completitud sintética'
    };
    const sinNomina = { ...base };
    delete (sinNomina as Record<string, unknown>).involucraNomina;
    expect(() => despachar(ctx, 'fiscal:retencionMetadatosCompletar', sinNomina)).toThrow(/Campo requerido \(booleano\): involucraNomina/);
    const sinPersona = { ...base, involucraNomina: false };
    delete (sinPersona as Record<string, unknown>).personaNatural;
    expect(() => despachar(ctx, 'fiscal:retencionMetadatosCompletar', sinPersona)).toThrow(/Campo requerido \(booleano\): personaNatural/);
    const comoCadena = { ...base, involucraNomina: 'no' };
    expect(() => despachar(ctx, 'fiscal:retencionMetadatosCompletar', comoCadena)).toThrow(/Campo requerido \(booleano\): involucraNomina/);

    const fila = db.prepare('SELECT involucra_nomina, persona_natural FROM retencion WHERE id = ?').get(ret.id) as {
      involucra_nomina: number | null;
      persona_natural: number | null;
    };
    expect(fila.involucra_nomina).toBeNull();
    expect(fila.persona_natural).toBeNull();
    db.close();
  });

  it('catálogo de ingresos: 99 rechazado, 01 y 47 bloqueados por alcance, 42 admitido', () => {
    const db = abrir();
    const ctx = contexto(db);
    vigenciaF14Autorizada(ctx);
    const proveedor = crearContraparte(db, { nombre: 'Proveedor Codigos A42', esCliente: false, esProveedor: true, responsable: 'p', nit: '0614-444333-101-5' });
    const ret = registrarRetencion(db, {
      tipo: 'efectuada', contraparteId: proveedor, fechaOperacion: '2026-11-10',
      base: '500.00', tasa: '10', regla: 'regla sintética', concepto: 'retención sintética',
      claveIdempotencia: 'ret-a42-c', responsable: 'p'
    });

    const guardar = (codigo: string) =>
      despachar(ctx, 'fiscal:retencionMetadatosCompletar', {
        retencionId: ret.id, domiciliado: '1', codigoPais: '9300', nitNif: '0614-444333-101-5',
        codigoIngreso: codigo, tipoOperacion: '1', clasificacion: '2', sector: '2', tipoCostoGasto: '1',
        involucraNomina: false, personaNatural: false, responsable: 'p', motivo: 'completitud sintética'
      });

    expect(() => guardar('99')).toThrow(/no verificado en el apéndice oficial/);
    expect(() => guardar('01')).toThrow(/servicios permanentes con subordinación/);
    expect(() => guardar('47')).toThrow(/art\. 123 inciso tercero/);
    expect(() => guardar('42')).not.toThrow();

    db.prepare('UPDATE retencion SET codigo_ingreso = ? WHERE id = ?').run('47', ret.id);
    const diagnostico = despachar(ctx, 'fiscal:anexoRetenciones', { mes: '2026-11' }) as {
      folios: Array<{ folio: string; faltantes: string[] }>;
      bloqueado: boolean;
    };
    expect(diagnostico.bloqueado).toBe(true);
    expect(diagnostico.folios[0].faltantes.some(f => f.includes('art. 123 inciso tercero'))).toBe(true);
    expect(() => exportarAnexoRetencionesF14Presentacion(db, '2026-11')).toThrow(/art\. 123 inciso tercero/);
    db.close();
  });

  it('identidad por fecha: DUI de no domiciliado en 2026 y DUI antes de 2022 se rechazan; NIF extranjero ≤14 caracteres se admite', () => {
    const db = abrir();
    const ctx = contexto(db);
    vigenciaF14Autorizada(ctx, '2021-01-01');
    const proveedor = crearContraparte(db, { nombre: 'Proveedor Identidad A42', esCliente: false, esProveedor: true, responsable: 'p', nit: '0614-555444-101-5' });
    const ret2026 = registrarRetencion(db, {
      tipo: 'efectuada', contraparteId: proveedor, fechaOperacion: '2026-11-10',
      base: '500.00', tasa: '10', regla: 'regla sintética', concepto: 'retención sintética',
      claveIdempotencia: 'ret-a42-i1', responsable: 'p'
    });
    const ret2021 = registrarRetencion(db, {
      tipo: 'efectuada', contraparteId: proveedor, fechaOperacion: '2021-11-10',
      base: '300.00', tasa: '10', regla: 'regla sintética', concepto: 'retención sintética',
      claveIdempotencia: 'ret-a42-i2', responsable: 'p'
    });

    // No domiciliado con DUI en 2026 → rechazado (tu reproducción).
    expect(() =>
      despachar(ctx, 'fiscal:retencionMetadatosCompletar', {
        retencionId: ret2026.id, domiciliado: '2', codigoPais: '9300', dui: '123456789',
        codigoIngreso: '42', tipoOperacion: '1', clasificacion: '2', sector: '2', tipoCostoGasto: '1',
        involucraNomina: false, personaNatural: true, responsable: 'p', motivo: 'completitud sintética'
      })
    ).toThrow(/DUI solo corresponde a persona natural domiciliada/);

    // No domiciliado con NIF extranjero de 10 caracteres alfanuméricos → admitido.
    expect(() =>
      despachar(ctx, 'fiscal:retencionMetadatosCompletar', {
        retencionId: ret2026.id, domiciliado: '2', codigoPais: '9438', nitNif: 'AB12345678',
        codigoIngreso: '42', tipoOperacion: '1', clasificacion: '2', sector: '2', tipoCostoGasto: '1',
        involucraNomina: false, personaNatural: false, responsable: 'p', motivo: 'completitud sintética'
      })
    ).not.toThrow();

    // Domiciliado con DUI en 2021 → rechazado (antes de 2022 el DUI va vacío).
    expect(() =>
      despachar(ctx, 'fiscal:retencionMetadatosCompletar', {
        retencionId: ret2021.id, domiciliado: '1', codigoPais: '9300', nitNif: '0614-555444-101-5', dui: '123456789',
        codigoIngreso: '42', tipoOperacion: '1', clasificacion: '2', sector: '2', tipoCostoGasto: '1',
        involucraNomina: false, personaNatural: true, responsable: 'p', motivo: 'completitud sintética'
      })
    ).toThrow(/anteriores a enero 2022 el DUI va vacío/);
    db.close();
  });
});
