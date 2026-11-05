import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { abrirBase, prepararRutasDatos } from '../src/main/db/conexion';
import { aplicarMigraciones } from '../src/main/db/aplicarMigraciones';
import { sembrarCatalogoBase } from '../src/main/servicios/cuentas';
import { despachar } from '../src/main/comandos';
import { exportarAnexo1VentasContribuyentes } from '../src/main/servicios/anexosFiscales';
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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arkon-a34f-'));
  rutas = prepararRutasDatos(path.join(dir, 'datos'));
  rutaDb = path.join(rutas.datos, 'op.db');
  fs.mkdirSync(rutas.datos, { recursive: true });
  const db = abrir();
  sembrarCatalogoBase(db);
  db.prepare("INSERT INTO ambito (id, nombre, tipo) VALUES ('administrativo', 'Prueba a34f', 'administrativo')").run();
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

describe('auditoría 34: Anexo 1 F-07 v14 con especificación oficial verificada', () => {
  it('estructura oficial A-T con separador ;, fechas DD/MM/AAAA, montos y columnas R/S por período', () => {
    const db = abrir();
    const ctx = contexto(db);
    despachar(contexto(db), 'vigencia:crear', {
      desde: '2026-01-01',
      inscritoIva: true,
      descripcion: 'vigencia sintética aislada solo para prueba del anexo',
      fuente: 'prueba sintética',
      responsable: 'p'
    });
    const cliente = crearContraparte(db, { nombre: 'Cliente Contribuyente A34', esCliente: true, esProveedor: false, responsable: 'p', nit: '0614-123456-101-5' });
    const venta = registrarVenta(db, {
      contraparteId: cliente,
      fechaOperacion: '2026-11-05',
      concepto: 'Venta anexo sintética',
      tipoIngreso: 'instalaciones',
      base: '100.00',
      tasa: '13',
      claveIdempotencia: 'v-a34f',
      responsable: 'p'
    });
    void venta;
    completarClasificacionDocumento(db, 'venta', (db.prepare('SELECT id FROM venta WHERE folio = ?').get('V-000001') as { id: number }).id, {
      clasificacionDocumento: 'contribuyente',
      tipoDocumento: 'ccf',
      responsable: 'p',
      motivo: 'clasificación sintética'
    });

    const anexo = exportarAnexo1VentasContribuyentes(db, '2026-11');
    expect(anexo.version).toBe('anexo-f07-v14-anexo1-esquema1');
    expect(anexo.fuente).toContain('F-07 v14');
    expect(anexo.filas).toBe(1);
    const columnas = anexo.csv.split('\n')[0].split(';');
    expect(columnas).toHaveLength(20);
    expect(columnas[0]).toBe('05/11/2026');
    expect(columnas[2]).toBe('03');
    expect(columnas[6]).toBe('V-000001');
    expect(columnas[7]).toBe('06141234561015');
    expect(columnas[8]).toBe('Cliente Contribuyente A34');
    expect(columnas[9]).toBe('0.00');
    expect(columnas[10]).toBe('0.00');
    expect(columnas[11]).toBe('100.00');
    expect(columnas[12]).toBe('13.00');
    expect(columnas[13]).toBe('0.00');
    expect(columnas[14]).toBe('0.00');
    expect(columnas[15]).toBe('113.00');
    expect(columnas[17]).toBe('1');
    expect(columnas[18]).toBe('2');
    expect(columnas[19]).toBe('1');
    expect(anexo.advertencia).toContain('NO debe presentarse');

    const porDespachar = despachar(ctx, 'fiscal:anexo1Ventas', { mes: '2026-11' }) as { filas: number };
    expect(porDespachar.filas).toBe(1);
    db.close();
  });

  it('excluye anuladas y consumidor final; lista folios incompletos sin inventar datos', () => {
    const db = abrir();
    const ctx = contexto(db);
    const conNit = crearContraparte(db, { nombre: 'Cliente Con NIT A34', esCliente: true, esProveedor: false, responsable: 'p', nit: '0614-999999-101-5' });
    const sinNit = crearContraparte(db, { nombre: 'Cliente Sin NIT A34', esCliente: true, esProveedor: false, responsable: 'p' });
    const final = crearContraparte(db, { nombre: 'Consumidor Final A34', esCliente: true, esProveedor: false, responsable: 'p' });

    const v1 = registrarVenta(db, {
      contraparteId: sinNit,
      fechaOperacion: '2026-11-02',
      concepto: 'Venta sin NIT sintética',
      tipoIngreso: 'instalaciones',
      base: '50.00',
      tasa: '0',
      claveIdempotencia: 'v-a34f-sinnit',
      responsable: 'p'
    });
    completarClasificacionDocumento(db, 'venta', v1.id, {
      clasificacionDocumento: 'contribuyente',
      tipoDocumento: 'ccf',
      responsable: 'p',
      motivo: 'clasificación sintética'
    });

    const v2 = registrarVenta(db, {
      contraparteId: final,
      fechaOperacion: '2026-11-03',
      concepto: 'Venta consumidor final sintética',
      tipoIngreso: 'instalaciones',
      base: '20.00',
      tasa: '0',
      claveIdempotencia: 'v-a34f-final',
      responsable: 'p'
    });
    completarClasificacionDocumento(db, 'venta', v2.id, {
      clasificacionDocumento: 'consumidor_final',
      tipoDocumento: 'factura',
      responsable: 'p',
      motivo: 'clasificación sintética'
    });

    const v3 = registrarVenta(db, {
      contraparteId: conNit,
      fechaOperacion: '2026-11-04',
      concepto: 'Venta anulada sintética',
      tipoIngreso: 'instalaciones',
      base: '10.00',
      tasa: '0',
      claveIdempotencia: 'v-a34f-anulada',
      responsable: 'p'
    });
    completarClasificacionDocumento(db, 'venta', v3.id, {
      clasificacionDocumento: 'contribuyente',
      tipoDocumento: 'ccf',
      responsable: 'p',
      motivo: 'clasificación sintética'
    });
    anularDocumento(db, 'venta', v3.id, 'p', 'anulación sintética');

    const anexo = despachar(ctx, 'fiscal:anexo1Ventas', { mes: '2026-11' }) as {
      filas: number;
      incompletos: Array<{ folio: string; faltantes: string[] }>;
      csv: string;
    };
    expect(anexo.filas).toBe(1);
    expect(anexo.csv).not.toContain('V-000002');
    expect(anexo.csv).not.toContain('V-000003');
    expect(anexo.incompletos.length).toBe(1);
    expect(anexo.incompletos[0].folio).toBe('V-000001');
    expect(anexo.incompletos[0].faltantes.some(f => f.includes('NIT o NRC'))).toBe(true);
    expect(anexo.incompletos[0].faltantes.some(f => f.includes('exenta vs no sujeta'))).toBe(true);

    expect(() => exportarAnexo1VentasContribuyentes(db, '2026-13')).toThrow();
    expect(() => exportarAnexo1VentasContribuyentes(db, 'noviembre')).toThrow(/Mes inválido/);
    db.close();
  });
});
