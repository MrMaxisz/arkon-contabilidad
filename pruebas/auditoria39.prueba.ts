import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { abrirBase, prepararRutasDatos } from '../src/main/db/conexion';
import { aplicarMigraciones } from '../src/main/db/aplicarMigraciones';
import { sembrarCatalogoBase } from '../src/main/servicios/cuentas';
import { despachar } from '../src/main/comandos';
import { exportarAnexo3ComprasPresentacion } from '../src/main/servicios/anexosFiscales';
import { crearContraparte, registrarVenta, registrarCompra, completarClasificacionDocumento } from '../src/main/servicios/operacion';
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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arkon-a39-'));
  rutas = prepararRutasDatos(path.join(dir, 'datos'));
  rutaDb = path.join(rutas.datos, 'op.db');
  fs.mkdirSync(rutas.datos, { recursive: true });
  const db = abrir();
  sembrarCatalogoBase(db);
  db.prepare("INSERT INTO ambito (id, nombre, tipo) VALUES ('administrativo', 'Prueba a39', 'administrativo')").run();
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

describe('auditoría 39: recorrido completo de compra del Anexo 3 con venta simultánea', () => {
  it('diagnóstico3 → Completar compra → guardar R2/S4/T7 sin tipoIngresoRenta → persistencia → listo → exportable', () => {
    const db = abrir();
    const ctx = contexto(db);
    despachar(ctx, 'vigencia:crear', {
      desde: '2026-01-01',
      inscritoIva: true,
      descripcion: 'vigencia sintética aislada',
      fuente: 'prueba sintética',
      responsable: 'p'
    });

    // Venta 7 y compra 7 simultáneas para verificar que el tipo no se confunde.
    const cliente = crearContraparte(db, { nombre: 'Cliente Simultaneo A39', esCliente: true, esProveedor: false, responsable: 'p', nit: '0614-123456-101-5' });
    const venta7 = registrarVenta(db, {
      contraparteId: cliente,
      fechaOperacion: '2026-11-05',
      concepto: 'Venta simultánea sintética',
      tipoIngreso: 'instalaciones',
      base: '100.00',
      tasa: '13',
      claveIdempotencia: 'v-a39-sim',
      responsable: 'p'
    });
    completarClasificacionDocumento(db, 'venta', venta7.id, {
      clasificacionDocumento: 'contribuyente',
      tipoDocumento: 'ccf',
      responsable: 'p',
      motivo: 'clasificación sintética'
    });
    expect(venta7.id).toBeGreaterThan(0);

    const proveedor = crearContraparte(db, { nombre: 'Proveedor Recorrido A39', esCliente: false, esProveedor: true, responsable: 'p', nit: '0614-654321-101-5' });
    const compra7 = registrarCompra(db, {
      contraparteId: proveedor,
      fechaOperacion: '2026-11-08',
      concepto: 'Compra recorrido sintética',
      condicion: 'credito',
      lineas: [{ descripcion: 'Material sintético', cuentaCodigo: '5101', cantidad: '1', precioUnitario: '100.00', tasa: '13', tratamiento: 'gravado' }],
      claveIdempotencia: 'c-a39',
      responsable: 'p'
    });
    completarClasificacionDocumento(db, 'compra', compra7.id, {
      clasificacionDocumento: 'contribuyente',
      tipoDocumento: 'ccf',
      responsable: 'p',
      motivo: 'clasificación sintética'
    });
    expect(compra7.id).toBe(venta7.id);

    // Diagnóstico 3: compra 7 incompleta.
    const diagnosticoInicial = despachar(ctx, 'fiscal:anexo3Compras', { mes: '2026-11' }) as {
      folios: Array<{ folio: string; documentoId: number; faltantes: string[] }>;
      bloqueado: boolean;
    };
    expect(diagnosticoInicial.bloqueado).toBe(true);
    expect(diagnosticoInicial.folios[0].documentoId).toBe(compra7.id);

    // La lectura por tipo compra devuelve la compra 7, no la venta 7.
    const lecturaCompra = despachar(ctx, 'fiscal:metadatosLeer', { documentoId: compra7.id, tipo: 'compra' }) as { folio: string };
    expect(lecturaCompra.folio).toBe('CMP-000001');
    const lecturaVenta = despachar(ctx, 'fiscal:metadatosLeer', { documentoId: venta7.id, tipo: 'venta' }) as { folio: string };
    expect(lecturaVenta.folio).toBe('V-000001');

    // Guardar metadatos de compra SIN tipoIngresoRenta y con R2/S4/T7.
    despachar(ctx, 'fiscal:metadatosCompletar', {
      tipo: 'compra',
      documentoId: compra7.id,
      claseDocumentoFiscal: '1',
      numeroResolucion: 'R-A39',
      serieDocumento: 'A',
      numeroDocumentoAutorizado: 'CCF-A39',
      tipoOperacionRenta: '1',
      clasificacionRenta: '2',
      sector: '4',
      tipoCostoGasto: '7',
      responsable: 'p',
      motivo: 'completitud sintética'
    });

    // Persistencia: reabrir la base conserva los valores (efecto de modificar metadatos ya existentes).
    db.close();
    const db2 = abrir();
    const ctx2 = contexto(db2);
    const releer = despachar(ctx2, 'fiscal:metadatosLeer', { documentoId: compra7.id, tipo: 'compra' }) as {
      clasificacion_renta: string | null;
      sector: string | null;
      tipo_costo_gasto: string | null;
      tipo_ingreso_renta: string | null;
    };
    expect(releer.clasificacion_renta).toBe('2');
    expect(releer.sector).toBe('4');
    expect(releer.tipo_costo_gasto).toBe('7');
    expect(releer.tipo_ingreso_renta).toBeNull();

    // Diagnóstico 3 listo y exportación de presentación.
    const diagnosticoFinal = despachar(ctx2, 'fiscal:anexo3Compras', { mes: '2026-11' }) as {
      bloqueado: boolean;
      listos: string[];
    };
    expect(diagnosticoFinal.bloqueado).toBe(false);
    expect(diagnosticoFinal.listos).toContain('CMP-000001');

    const anexo = exportarAnexo3ComprasPresentacion(db2, '2026-11');
    expect(anexo.filas).toBe(1);
    const fila = anexo.csv.split('\n')[0].split(';');
    expect(fila[16]).toBe('1');
    expect(fila[17]).toBe('2');
    expect(fila[18]).toBe('4');
    expect(fila[19]).toBe('7');
    db2.close();
  });

  it('catálogos: R7/S7/T0 se rechazan en la vía auditada, diagnóstico y exportación', () => {
    const db = abrir();
    const ctx = contexto(db);
    despachar(ctx, 'vigencia:crear', {
      desde: '2026-01-01',
      inscritoIva: true,
      descripcion: 'vigencia sintética aislada',
      fuente: 'prueba sintética',
      responsable: 'p'
    });
    const proveedor = crearContraparte(db, { nombre: 'Proveedor Catalogos A39', esCliente: false, esProveedor: true, responsable: 'p', nit: '0614-999888-101-5' });
    const compra = registrarCompra(db, {
      contraparteId: proveedor,
      fechaOperacion: '2026-11-08',
      concepto: 'Compra catálogos sintética',
      condicion: 'contado',
      lineas: [{ descripcion: 'Material', cuentaCodigo: '5101', cantidad: '1', precioUnitario: '10.00', tasa: '0', tratamiento: 'exento' }],
      claveIdempotencia: 'c-a39-cat',
      responsable: 'p'
    });
    completarClasificacionDocumento(db, 'compra', compra.id, {
      clasificacionDocumento: 'contribuyente',
      tipoDocumento: 'ccf',
      responsable: 'p',
      motivo: 'clasificación sintética'
    });

    expect(() =>
      despachar(ctx, 'fiscal:metadatosCompletar', {
        tipo: 'compra',
        documentoId: compra.id,
        claseDocumentoFiscal: '1',
        numeroResolucion: 'R-A39',
        serieDocumento: 'A',
        numeroDocumentoAutorizado: 'CCF-A39',
        tipoOperacionRenta: '1',
        clasificacionRenta: '7',
        sector: '7',
        tipoCostoGasto: '0',
        responsable: 'p',
        motivo: 'completitud sintética'
      })
    ).toThrow(/catálogo 1-2/);

    despachar(ctx, 'fiscal:metadatosCompletar', {
      tipo: 'compra',
      documentoId: compra.id,
      claseDocumentoFiscal: '1',
      numeroResolucion: 'R-A39',
      serieDocumento: 'A',
      numeroDocumentoAutorizado: 'CCF-A39',
      tipoOperacionRenta: '1',
      clasificacionRenta: '1',
      sector: '2',
      tipoCostoGasto: '3',
      responsable: 'p',
      motivo: 'completitud sintética'
    });

    db.prepare('UPDATE compra SET sector = ? WHERE id = ?').run('7', compra.id);
    const diagnostico = despachar(ctx, 'fiscal:anexo3Compras', { mes: '2026-11' }) as {
      folios: Array<{ folio: string; faltantes: string[] }>;
      bloqueado: boolean;
    };
    expect(diagnostico.bloqueado).toBe(true);
    expect(diagnostico.folios[0].faltantes.some(f => f.includes('catálogo 1-4 (columna S)'))).toBe(true);
    expect(() => exportarAnexo3ComprasPresentacion(db, '2026-11')).toThrow(/catálogo 1-4/);
    db.close();
  });
});
