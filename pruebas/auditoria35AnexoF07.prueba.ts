import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { abrirBase, prepararRutasDatos } from '../src/main/db/conexion';
import { aplicarMigraciones } from '../src/main/db/aplicarMigraciones';
import { sembrarCatalogoBase } from '../src/main/servicios/cuentas';
import { despachar } from '../src/main/comandos';
import {
  diagnosticarAnexo1Ventas,
  exportarAnexo1VentasPresentacion,
  completarMetadatosFiscales,
  FUENTE_OFICIAL_ANEXO1
} from '../src/main/servicios/anexosFiscales';
import { crearContraparte, registrarVenta, anularDocumento, completarClasificacionDocumento } from '../src/main/servicios/operacion';
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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arkon-a35f-'));
  rutas = prepararRutasDatos(path.join(dir, 'datos'));
  rutaDb = path.join(rutas.datos, 'op.db');
  fs.mkdirSync(rutas.datos, { recursive: true });
  const db = abrir();
  sembrarCatalogoBase(db);
  db.prepare("INSERT INTO ambito (id, nombre, tipo) VALUES ('administrativo', 'Prueba a35f', 'administrativo')").run();
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

function ventaContribuyente(
  db: BetterSqlite3.Database,
  opts: { nombre: string; nit?: string; fecha: string; base: string; tasa: string; clave: string }
) {
  const cliente = crearContraparte(db, {
    nombre: opts.nombre,
    esCliente: true,
    esProveedor: false,
    responsable: 'p',
    nit: opts.nit
  });
  const venta = registrarVenta(db, {
    contraparteId: cliente,
    fechaOperacion: opts.fecha,
    concepto: `Venta ${opts.clave} sintética`,
    tipoIngreso: 'instalaciones',
    base: opts.base,
    tasa: opts.tasa,
    claveIdempotencia: opts.clave,
    responsable: 'p'
  });
  completarClasificacionDocumento(db, 'venta', venta.id, {
    clasificacionDocumento: 'contribuyente',
    tipoDocumento: 'ccf',
    responsable: 'p',
    motivo: 'clasificación sintética'
  });
  return venta;
}

function parsearCsv(texto: string, separador: string): string[][] {
  const filas: string[][] = [];
  let fila: string[] = [];
  let campo = '';
  let entreComillas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (entreComillas) {
      if (c === '"') {
        if (texto[i + 1] === '"') {
          campo += '"';
          i++;
        } else {
          entreComillas = false;
        }
      } else {
        campo += c;
      }
    } else if (c === '"') {
      entreComillas = true;
    } else if (c === separador) {
      fila.push(campo);
      campo = '';
    } else if (c === '\n') {
      fila.push(campo);
      filas.push(fila);
      fila = [];
      campo = '';
    } else {
      campo += c;
    }
  }
  if (campo.length > 0 || fila.length > 0) {
    fila.push(campo);
    filas.push(fila);
  }
  return filas;
}

describe('auditoría 35: Anexo 1 F-07 v14 con bloqueo de faltantes y vía auditada', () => {
  it('el diagnóstico enumera TODOS los campos fiscales faltantes y no genera archivo de presentación', () => {
    const db = abrir();
    const ctx = contexto(db);
    ventaContribuyente(db, { nombre: 'Cliente Sin NIT A35', fecha: '2026-11-05', base: '100.00', tasa: '0', clave: 'v-a35f-1' });

    const diagnostico = despachar(ctx, 'fiscal:anexo1Ventas', { mes: '2026-11' }) as {
      folios: Array<{ folio: string; faltantes: string[] }>;
      listos: string[];
      bloqueado: boolean;
      motivo: string;
      fuente: string;
    };
    expect(diagnostico.bloqueado).toBe(true);
    expect(diagnostico.listos).toHaveLength(0);
    const faltantes = diagnostico.folios[0].faltantes;
    for (const esperado of [
      'NIT (14 dígitos) o NRC válido',
      'clase de documento',
      'número de resolución',
      'número de serie',
      'número de documento autorizado',
      'tratamiento de la venta sin IVA',
      'tipo de operación Renta',
      'tipo de ingreso Renta',
      'cobertura de vigencia con IVA inscrito'
    ]) {
      expect(faltantes.some(f => f.includes(esperado))).toBe(true);
    }
    expect(diagnostico.motivo).toContain('metadatos fiscales incompletos');
    expect(diagnostico.fuente).toBe(FUENTE_OFICIAL_ANEXO1);

    expect(() => exportarAnexo1VentasPresentacion(db, '2026-11')).toThrow(/bloqueado/);
    db.close();
  });

  it('sin vigencia inscrita el archivo de presentación se bloquea aunque los metadatos estén completos', () => {
    const db = abrir();
    const venta = ventaContribuyente(db, {
      nombre: 'Cliente Completo A35',
      nit: '0614-123456-101-5',
      fecha: '2026-11-05',
      base: '100.00',
      tasa: '0',
      clave: 'v-a35f-2'
    });
    completarMetadatosFiscales(
      db,
      'venta',
      venta.id,
      {
        claseDocumentoFiscal: '1',
        numeroResolucion: '15034-RES-CR-12345-2021',
        serieDocumento: 'A',
        numeroDocumentoAutorizado: '000001',
        tratamientoVenta: 'exenta',
        tipoOperacionRenta: '1',
        tipoIngresoRenta: '2'
      },
      'p',
      'completitud sintética'
    );
    const diagnostico = diagnosticarAnexo1Ventas(db, '2026-11');
    expect(diagnostico.listos).toHaveLength(0);
    expect(diagnostico.bloqueado).toBe(true);
    expect(diagnostico.folios[0].faltantes.some(f => f.includes('cobertura de vigencia'))).toBe(true);
    expect(() => exportarAnexo1VentasPresentacion(db, '2026-11')).toThrow(/bloqueado/);
    db.close();
  });

  it('con vigencia inscrita y metadatos completos el archivo se genera con 20 columnas exactas y cifras reales', () => {
    const db = abrir();
    const ctx = contexto(db);
    despachar(ctx, 'vigencia:crear', {
      desde: '2026-01-01',
      inscritoIva: true,
      descripcion: 'vigencia sintética aislada solo para prueba',
      fuente: 'prueba sintética',
      responsable: 'p'
    });
    const venta = ventaContribuyente(db, {
      nombre: 'Cliente; "Sintético" con salto\nsegunda línea',
      nit: '0614-123456-101-5',
      fecha: '2026-11-05',
      base: '100.00',
      tasa: '13',
      clave: 'v-a35f-3'
    });
    completarMetadatosFiscales(
      db,
      'venta',
      venta.id,
      {
        claseDocumentoFiscal: '1',
        numeroResolucion: '15034-RES-CR-12345-2021',
        serieDocumento: 'A',
        numeroDocumentoAutorizado: '000001',
        tipoOperacionRenta: '1',
        tipoIngresoRenta: '2'
      },
      'p',
      'completitud sintética'
    );

    const anexo = exportarAnexo1VentasPresentacion(db, '2026-11');
    expect(anexo.version).toBe('anexo-f07-v14-anexo1-esquema2');
    expect(anexo.filas).toBe(1);
    const filas = parsearCsv(anexo.csv, ';');
    expect(filas).toHaveLength(1);
    expect(filas[0]).toHaveLength(20);
    expect(filas[0][0]).toBe('05/11/2026');
    expect(filas[0][1]).toBe('1');
    expect(filas[0][2]).toBe('03');
    expect(filas[0][3]).toBe('15034-RES-CR-12345-2021');
    expect(filas[0][4]).toBe('A');
    expect(filas[0][5]).toBe('000001');
    expect(filas[0][6]).toBe('V-000001');
    expect(filas[0][7]).toBe('06141234561015');
    expect(filas[0][8]).toBe('Cliente; "Sintético" con salto\nsegunda línea');
    expect(filas[0][9]).toBe('0.00');
    expect(filas[0][11]).toBe('100.00');
    expect(filas[0][12]).toBe('13.00');
    expect(filas[0][15]).toBe('113.00');
    expect(filas[0][17]).toBe('1');
    expect(filas[0][18]).toBe('2');
    expect(filas[0][19]).toBe('1');
    db.close();
  });

  it('venta sin IVA con tratamiento explícito exenta/no_sujeta usa la columna correcta sin inferencia', () => {
    const db = abrir();
    const ctx = contexto(db);
    despachar(ctx, 'vigencia:crear', {
      desde: '2026-01-01',
      inscritoIva: true,
      descripcion: 'vigencia sintética aislada solo para prueba',
      fuente: 'prueba sintética',
      responsable: 'p'
    });
    const exenta = ventaContribuyente(db, {
      nombre: 'Cliente Exenta A35',
      nit: '0614-777777-101-5',
      fecha: '2026-11-06',
      base: '50.00',
      tasa: '0',
      clave: 'v-a35f-4'
    });
    completarMetadatosFiscales(
      db,
      'venta',
      exenta.id,
      {
        claseDocumentoFiscal: '1',
        numeroResolucion: 'R-SINTETICA-1',
        serieDocumento: 'B',
        numeroDocumentoAutorizado: '000002',
        tratamientoVenta: 'exenta',
        tipoOperacionRenta: '2',
        tipoIngresoRenta: '2'
      },
      'p',
      'completitud sintética'
    );

    const anexo = exportarAnexo1VentasPresentacion(db, '2026-11');
    const filas = parsearCsv(anexo.csv, ';');
    expect(filas[0][9]).toBe('50.00');
    expect(filas[0][10]).toBe('0.00');
    expect(filas[0][11]).toBe('0.00');
    expect(filas[0][12]).toBe('0.00');
    db.close();
  });

  it('anuladas y consumidor final excluidas; catálogos oficiales validados en la vía auditada', () => {
    const db = abrir();
    const ctx = contexto(db);
    const anulada = ventaContribuyente(db, {
      nombre: 'Cliente Anulada A35',
      nit: '0614-888888-101-5',
      fecha: '2026-11-07',
      base: '10.00',
      tasa: '0',
      clave: 'v-a35f-5'
    });
    anularDocumento(db, 'venta', anulada.id, 'p', 'anulación sintética');

    const final = crearContraparte(db, { nombre: 'Consumidor Final A35', esCliente: true, esProveedor: false, responsable: 'p' });
    const vFinal = registrarVenta(db, {
      contraparteId: final,
      fechaOperacion: '2026-11-08',
      concepto: 'Venta final sintética',
      tipoIngreso: 'instalaciones',
      base: '20.00',
      tasa: '0',
      claveIdempotencia: 'v-a35f-6',
      responsable: 'p'
    });
    completarClasificacionDocumento(db, 'venta', vFinal.id, {
      clasificacionDocumento: 'consumidor_final',
      tipoDocumento: 'factura',
      responsable: 'p',
      motivo: 'clasificación sintética'
    });

    const diagnostico = diagnosticarAnexo1Ventas(db, '2026-11');
    expect(diagnostico.folios).toHaveLength(0);
    expect(diagnostico.listos).toHaveLength(0);

    expect(() =>
      completarMetadatosFiscales(
        db,
        'venta',
        anulada.id,
        {
          claseDocumentoFiscal: '9',
          numeroResolucion: 'R',
          serieDocumento: 'A',
          numeroDocumentoAutorizado: '1',
          tipoOperacionRenta: '1',
          tipoIngresoRenta: '2'
        },
        'p',
        'motivo sintético'
      )
    ).toThrow(/Clase de documento inválida/);
    expect(() => diagnosticarAnexo1Ventas(db, 'noviembre')).toThrow(/Mes inválido/);
    db.close();
  });
});
