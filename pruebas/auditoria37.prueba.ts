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
  exportarAnexo2VentasConsumidorPresentacion,
  exportarAnexo3ComprasPresentacion,
  completarMetadatosFiscales
} from '../src/main/servicios/anexosFiscales';
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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arkon-a37-'));
  rutas = prepararRutasDatos(path.join(dir, 'datos'));
  rutaDb = path.join(rutas.datos, 'op.db');
  fs.mkdirSync(rutas.datos, { recursive: true });
  const db = abrir();
  sembrarCatalogoBase(db);
  db.prepare("INSERT INTO ambito (id, nombre, tipo) VALUES ('administrativo', 'Prueba a37', 'administrativo')").run();
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

function metadatosCompletos(db: BetterSqlite3.Database, ventaId: number, clase: string, numero: string) {
  completarMetadatosFiscales(
    db,
    'venta',
    ventaId,
    {
      claseDocumentoFiscal: clase,
      numeroResolucion: 'R-SINTETICA-37',
      serieDocumento: 'A',
      numeroDocumentoAutorizado: numero,
      tipoOperacionRenta: '1',
      tipoIngresoRenta: '2'
    },
    'p',
    'completitud sintética'
  );
}

describe('auditoría 37: límites por columna según manual F-07 v14', () => {
  it('nombre de cliente de 125 caracteres (columna I sin límite) se exporta correctamente', () => {
    const db = abrir();
    despachar(contexto(db), 'vigencia:crear', {
      desde: '2026-01-01',
      inscritoIva: true,
      descripcion: 'vigencia sintética aislada',
      fuente: 'prueba sintética',
      responsable: 'p'
    });
    const nombreLargo = 'Cliente sintético '.repeat(7) + 'final';
    const venta = ventaContribuyente(db, {
      nombre: nombreLargo,
      nit: '0614-123456-101-5',
      fecha: '2026-11-05',
      base: '100.00',
      tasa: '13',
      clave: 'v-a37l'
    });
    metadatosCompletos(db, venta.id, '1', '000001');

    const diagnostico = diagnosticarAnexo1Ventas(db, '2026-11');
    expect(diagnostico.bloqueado).toBe(false);

    const anexo = exportarAnexo1VentasPresentacion(db, '2026-11');
    expect(anexo.filas).toBe(1);
    const fila = anexo.csv.split('\n')[0].split(';');
    expect(fila).toHaveLength(20);
    expect(fila[8]).toBe(nombreLargo);
    expect(nombreLargo.length).toBeGreaterThan(100);
    db.close();
  });

  it('resolución y número de exactamente 100 caracteres pasan y 101 se rechazan por columna', () => {
    const db = abrir();
    despachar(contexto(db), 'vigencia:crear', {
      desde: '2026-01-01',
      inscritoIva: true,
      descripcion: 'vigencia sintética aislada',
      fuente: 'prueba sintética',
      responsable: 'p'
    });
    const venta = ventaContribuyente(db, {
      nombre: 'Cliente Limites A37',
      nit: '0614-123456-101-5',
      fecha: '2026-11-05',
      base: '100.00',
      tasa: '13',
      clave: 'v-a37m'
    });
    completarMetadatosFiscales(
      db,
      'venta',
      venta.id,
      {
        claseDocumentoFiscal: '1',
        numeroResolucion: 'R'.repeat(100),
        serieDocumento: 'S'.repeat(100),
        numeroDocumentoAutorizado: 'N'.repeat(100),
        tipoOperacionRenta: '1',
        tipoIngresoRenta: '2'
      },
      'p',
      'completitud sintética'
    );
    const anexo = exportarAnexo1VentasPresentacion(db, '2026-11');
    expect(anexo.filas).toBe(1);

    db.prepare('UPDATE venta SET numero_resolucion = ? WHERE id = ?').run('R'.repeat(101), venta.id);
    expect(() => exportarAnexo1VentasPresentacion(db, '2026-11')).toThrow(/resolución excede 100 caracteres/);
    db.close();
  });
});

describe('auditoría 37: Anexos 2 y 3 del F-07 v14', () => {
  it('Anexo 2: consumidor final con metadatos completos exporta 23 columnas; incompleto se bloquea', () => {
    const db = abrir();
    despachar(contexto(db), 'vigencia:crear', {
      desde: '2026-01-01',
      inscritoIva: true,
      descripcion: 'vigencia sintética aislada',
      fuente: 'prueba sintética',
      responsable: 'p'
    });
    const cliente = crearContraparte(db, { nombre: 'Consumidor Final A37', esCliente: true, esProveedor: false, responsable: 'p' });
    const venta = registrarVenta(db, {
      contraparteId: cliente,
      fechaOperacion: '2026-11-05',
      concepto: 'Venta final sintética',
      tipoIngreso: 'instalaciones',
      base: '100.00',
      tasa: '13',
      claveIdempotencia: 'v-a37f',
      responsable: 'p'
    });
    completarClasificacionDocumento(db, 'venta', venta.id, {
      clasificacionDocumento: 'consumidor_final',
      tipoDocumento: 'factura',
      responsable: 'p',
      motivo: 'clasificación sintética'
    });

    const bloqueado = despachar(contexto(db), 'fiscal:anexo2Ventas', { mes: '2026-11' }) as {
      folios: Array<{ folio: string; faltantes: string[] }>;
      bloqueado: boolean;
    };
    expect(bloqueado.bloqueado).toBe(true);
    expect(bloqueado.folios[0].faltantes.some(f => f.includes('clase de documento'))).toBe(true);
    expect(() => exportarAnexo2VentasConsumidorPresentacion(db, '2026-11')).toThrow(/bloqueado/);

    completarMetadatosFiscales(
      db,
      'venta',
      venta.id,
      {
        claseDocumentoFiscal: '1',
        numeroResolucion: 'R-SINTETICA-A2',
        serieDocumento: 'A',
        numeroDocumentoAutorizado: '000101',
        tipoOperacionRenta: '1',
        tipoIngresoRenta: '2'
      },
      'p',
      'completitud sintética'
    );
    const anexo = exportarAnexo2VentasConsumidorPresentacion(db, '2026-11');
    expect(anexo.filas).toBe(1);
    const fila = anexo.csv.split('\n')[0].split(';');
    expect(fila).toHaveLength(23);
    expect(fila[0]).toBe('05/11/2026');
    expect(fila[2]).toBe('01');
    expect(fila[5]).toBe('000101');
    expect(fila[6]).toBe('000101');
    expect(fila[7]).toBe('000101');
    expect(fila[8]).toBe('000101');
    expect(fila[13]).toBe('113.00');
    expect(fila[19]).toBe('113.00');
    expect(fila[22]).toBe('2');
    db.close();
  });

  it('Anexo 3: compra con líneas gravadas/exentas y metadatos exporta 21 columnas conciliadas con el crédito fiscal', () => {
    const db = abrir();
    despachar(contexto(db), 'vigencia:crear', {
      desde: '2026-01-01',
      inscritoIva: true,
      descripcion: 'vigencia sintética aislada',
      fuente: 'prueba sintética',
      responsable: 'p'
    });
    const proveedor = crearContraparte(db, {
      nombre: 'Proveedor Anexo3 A37',
      esCliente: false,
      esProveedor: true,
      responsable: 'p',
      nit: '0614-321654-101-5'
    });
    const compra = registrarCompra(db, {
      contraparteId: proveedor,
      fechaOperacion: '2026-11-08',
      concepto: 'Compra anexo3 sintética',
      condicion: 'credito',
      lineas: [
        { descripcion: 'Material gravado', cuentaCodigo: '5101', cantidad: '1', precioUnitario: '100.00', tasa: '13', tratamiento: 'gravado' },
        { descripcion: 'Material exento', cuentaCodigo: '5102', cantidad: '1', precioUnitario: '50.00', tasa: '0', tratamiento: 'exento' }
      ],
      claveIdempotencia: 'c-a37',
      responsable: 'p'
    });
    completarClasificacionDocumento(db, 'compra', compra.id, {
      clasificacionDocumento: 'contribuyente',
      tipoDocumento: 'ccf',
      responsable: 'p',
      motivo: 'clasificación sintética'
    });

    const bloqueado = despachar(contexto(db), 'fiscal:anexo3Compras', { mes: '2026-11' }) as {
      folios: Array<{ folio: string; faltantes: string[] }>;
      bloqueado: boolean;
    };
    expect(bloqueado.bloqueado).toBe(true);
    expect(bloqueado.folios[0].faltantes.some(f => f.includes('clase de documento'))).toBe(true);
    expect(bloqueado.folios[0].faltantes.some(f => f.includes('columna T'))).toBe(true);
    expect(() => exportarAnexo3ComprasPresentacion(db, '2026-11')).toThrow(/bloqueado/);

    completarMetadatosFiscales(
      db,
      'compra',
      compra.id,
      {
        claseDocumentoFiscal: '1',
        numeroResolucion: 'R-SINTETICA-A3',
        serieDocumento: 'A',
        numeroDocumentoAutorizado: 'CCF-000001',
        tipoOperacionRenta: '1',
        tipoIngresoRenta: '2',
        clasificacionRenta: '1',
        sector: '1',
        tipoCostoGasto: '1'
      },
      'p',
      'completitud sintética'
    );
    const anexo = exportarAnexo3ComprasPresentacion(db, '2026-11');
    expect(anexo.filas).toBe(1);
    const fila = anexo.csv.split('\n')[0].split(';');
    expect(fila).toHaveLength(21);
    expect(fila[0]).toBe('08/11/2026');
    expect(fila[2]).toBe('03');
    expect(fila[3]).toBe('CCF-000001');
    expect(fila[4]).toBe('06143216541015');
    expect(fila[6]).toBe('50.00');
    expect(fila[9]).toBe('100.00');
    expect(fila[13]).toBe('13.00');
    const sumaGM = [6, 7, 8, 9, 10, 11, 12]
      .map(i => Number(fila[i]))
      .reduce((a, b) => a + b, 0);
    expect(Number(fila[14])).toBe(sumaGM);
    expect(fila[14]).toBe('150.00');
    expect(fila[20]).toBe('3');
    db.close();
  });
});

describe('auditoría 38: reglas por clase del Anexo 2, agrupación DTE y catálogos del Anexo 3', () => {
  function ventaConsumidor(db: BetterSqlite3.Database, clienteId: number, fecha: string, clave: string, base = '100.00') {
    const venta = registrarVenta(db, {
      contraparteId: clienteId,
      fechaOperacion: fecha,
      concepto: `Venta final ${clave} sintética`,
      tipoIngreso: 'instalaciones',
      base,
      tasa: '13',
      claveIdempotencia: clave,
      responsable: 'p'
    });
    completarClasificacionDocumento(db, 'venta', venta.id, {
      clasificacionDocumento: 'consumidor_final',
      tipoDocumento: 'factura',
      responsable: 'p',
      motivo: 'clasificación sintética'
    });
    return venta;
  }

  it('clase 2: control interno del/al = folio y número del/al = autorizado; DTE del mismo día se agrupa', () => {
    const db = abrir();
    despachar(contexto(db), 'vigencia:crear', {
      desde: '2026-01-01',
      inscritoIva: true,
      descripcion: 'vigencia sintética aislada',
      fuente: 'prueba sintética',
      responsable: 'p'
    });
    const cliente = crearContraparte(db, { nombre: 'Consumidor Clases A38', esCliente: true, esProveedor: false, responsable: 'p' });

    const vClase2 = ventaConsumidor(db, cliente, '2026-11-02', 'v-a38-c2');
    completarMetadatosFiscales(db, 'venta', vClase2.id, {
      claseDocumentoFiscal: '2',
      numeroResolucion: 'R-A38',
      serieDocumento: 'A',
      numeroDocumentoAutorizado: 'NUM-C2',
      tipoOperacionRenta: '1',
      tipoIngresoRenta: '2'
    }, 'p', 'completitud sintética');

    const dte1 = ventaConsumidor(db, cliente, '2026-11-05', 'v-a38-d1');
    const dte2 = ventaConsumidor(db, cliente, '2026-11-05', 'v-a38-d2');
    const dte3 = ventaConsumidor(db, cliente, '2026-11-06', 'v-a38-d3');
    for (const [i, v] of [dte1, dte2, dte3].entries()) {
      completarMetadatosFiscales(db, 'venta', v.id, {
        claseDocumentoFiscal: '4',
        numeroResolucion: 'N/A',
        serieDocumento: 'N/A',
        numeroDocumentoAutorizado: `CODGEN-${i + 1}`,
        tipoOperacionRenta: '1',
        tipoIngresoRenta: '2'
      }, 'p', 'completitud sintética');
    }

    const anexo = exportarAnexo2VentasConsumidorPresentacion(db, '2026-11');
    const filas = anexo.csv.split('\n').map(l => l.split(';'));
    expect(filas).toHaveLength(3);

    const clase2 = filas.find(f => f[1] === '2')!;
    expect(clase2[5]).toBe('V-000001');
    expect(clase2[6]).toBe('V-000001');
    expect(clase2[7]).toBe('NUM-C2');
    expect(clase2[8]).toBe('NUM-C2');

    const dte5 = filas.find(f => f[0] === '05/11/2026')!;
    expect(dte5[3]).toBe('N/A');
    expect(dte5[4]).toBe('N/A');
    expect(dte5[5]).toBe('N/A');
    expect(dte5[6]).toBe('N/A');
    expect(dte5[7]).toBe('CODGEN-1');
    expect(dte5[8]).toBe('CODGEN-2');
    expect(dte5[13]).toBe('226.00');
    expect(dte5[19]).toBe('226.00');

    const dte6 = filas.find(f => f[0] === '06/11/2026')!;
    expect(dte6[7]).toBe('CODGEN-3');
    expect(dte6[8]).toBe('CODGEN-3');
    expect(dte6[19]).toBe('113.00');
    db.close();
  });

  it('catálogos del Anexo 3: valores no numéricos se rechazan en la vía auditada y en el diagnóstico', () => {
    const db = abrir();
    despachar(contexto(db), 'vigencia:crear', {
      desde: '2026-01-01',
      inscritoIva: true,
      descripcion: 'vigencia sintética aislada',
      fuente: 'prueba sintética',
      responsable: 'p'
    });
    const proveedor = crearContraparte(db, {
      nombre: 'Proveedor Catalogos A38',
      esCliente: false,
      esProveedor: true,
      responsable: 'p',
      nit: '0614-112233-101-5'
    });
    const compra = registrarCompra(db, {
      contraparteId: proveedor,
      fechaOperacion: '2026-11-08',
      concepto: 'Compra catálogos sintética',
      condicion: 'contado',
      lineas: [{ descripcion: 'Material', cuentaCodigo: '5101', cantidad: '1', precioUnitario: '10.00', tasa: '0', tratamiento: 'exento' }],
      claveIdempotencia: 'c-a38',
      responsable: 'p'
    });
    completarClasificacionDocumento(db, 'compra', compra.id, {
      clasificacionDocumento: 'contribuyente',
      tipoDocumento: 'ccf',
      responsable: 'p',
      motivo: 'clasificación sintética'
    });

    expect(() =>
      completarMetadatosFiscales(db, 'compra', compra.id, {
        claseDocumentoFiscal: '1',
        numeroResolucion: 'R-A38',
        serieDocumento: 'A',
        numeroDocumentoAutorizado: 'CCF-1',
        tipoOperacionRenta: '1',
        tipoIngresoRenta: '2',
        clasificacionRenta: 'X',
        sector: 'Y',
        tipoCostoGasto: 'Z'
      }, 'p', 'completitud sintética')
    ).toThrow(/numérico de un dígito/);

    completarMetadatosFiscales(db, 'compra', compra.id, {
      claseDocumentoFiscal: '1',
      numeroResolucion: 'R-A38',
      serieDocumento: 'A',
      numeroDocumentoAutorizado: 'CCF-1',
      tipoOperacionRenta: '1',
      tipoIngresoRenta: '2',
      clasificacionRenta: '1',
      sector: '2',
      tipoCostoGasto: '3'
    }, 'p', 'completitud sintética');

    const diagnostico = despachar(contexto(db), 'fiscal:anexo3Compras', { mes: '2026-11' }) as {
      bloqueado: boolean;
      listos: string[];
    };
    expect(diagnostico.bloqueado).toBe(false);
    expect(diagnostico.listos).toContain('CMP-000001');

    db.prepare('UPDATE compra SET sector = ? WHERE id = ?').run('Y', compra.id);
    const invalido = despachar(contexto(db), 'fiscal:anexo3Compras', { mes: '2026-11' }) as {
      folios: Array<{ folio: string; faltantes: string[] }>;
      bloqueado: boolean;
    };
    expect(invalido.bloqueado).toBe(true);
    expect(invalido.folios[0].faltantes.some(f => f.includes('sector numérico'))).toBe(true);
    expect(() => exportarAnexo3ComprasPresentacion(db, '2026-11')).toThrow(/sector numérico/);
    db.close();
  });
});
