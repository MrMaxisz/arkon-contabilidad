import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { abrirBase, prepararRutasDatos } from '../src/main/db/conexion';
import { aplicarMigraciones } from '../src/main/db/aplicarMigraciones';
import { sembrarCatalogoBase } from '../src/main/servicios/cuentas';
import { despachar } from '../src/main/comandos';
import { generarPaqueteContador } from '../src/main/servicios/paqueteContador';
import { diagnosticarAnexo1Ventas, exportarAnexo1VentasPresentacion, completarMetadatosFiscales } from '../src/main/servicios/anexosFiscales';
import { crearContraparte, registrarVenta, completarClasificacionDocumento } from '../src/main/servicios/operacion';
import { registrarCobro } from '../src/main/servicios/tesoreria';
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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arkon-a36-'));
  rutas = prepararRutasDatos(path.join(dir, 'datos'));
  rutaDb = path.join(rutas.datos, 'op.db');
  fs.mkdirSync(rutas.datos, { recursive: true });
  const db = abrir();
  sembrarCatalogoBase(db);
  db.prepare("INSERT INTO ambito (id, nombre, tipo) VALUES ('administrativo', 'Prueba a36', 'administrativo')").run();
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

function idCuenta(db: BetterSqlite3.Database, codigo: string): number {
  return (db.prepare('SELECT id FROM cuenta WHERE codigo = ?').get(codigo) as { id: number }).id;
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

function vigenciaInscrita(db: BetterSqlite3.Database, desde: string, hasta?: string) {
  despachar(contexto(db), 'vigencia:crear', {
    desde,
    hasta,
    inscritoIva: true,
    descripcion: 'vigencia sintética aislada solo para prueba',
    fuente: 'prueba sintética',
    responsable: 'p'
  });
}

describe('auditoría 36: corte en cuentas.csv/efectivo del paquete', () => {
  it('venta noviembre + cobro TOTAL diciembre: 1201=100 y caja=0 en todos los archivos al corte', () => {
    const db = abrir();
    const cliente = crearContraparte(db, { nombre: 'Cliente Corte A36', esCliente: true, esProveedor: false, responsable: 'p' });
    const venta = registrarVenta(db, {
      contraparteId: cliente,
      fechaOperacion: '2026-11-01',
      concepto: 'Venta corte sintética',
      tipoIngreso: 'instalaciones',
      base: '100.00',
      tasa: '0',
      claveIdempotencia: 'v-a36',
      responsable: 'p'
    });
    registrarCobro(db, {
      fechaOperacion: '2026-12-05',
      contraparteId: cliente,
      cuentaDestinoId: idCuenta(db, '1101'),
      monto: '100.00',
      concepto: 'Cobro total sintético',
      aplicaciones: [{ documentoTipo: 'venta', documentoId: venta.id, monto: '100.00' }],
      claveIdempotencia: 'cob-a36',
      responsable: 'p'
    });

    const paquete = generarPaqueteContador(db, '2026-11-01', '2026-11-30');
    const cuentas = paquete.archivos.find(a => a.nombre === 'cuentas.csv')!;
    expect(cuentas.contenido).toContain('1201,Clientes,activo,100.00');
    expect(cuentas.contenido).toContain('1101,Caja general,activo,0.00');
    const efectivo = paquete.archivos.find(a => a.nombre === 'auxiliar-efectivo.csv')!;
    expect(efectivo.contenido).toContain('1101,Caja general,0.00');
    expect(efectivo.contenido).toContain('TOTAL,,0.00');
    const conciliaciones = paquete.archivos.find(a => a.nombre === 'conciliaciones.csv')!;
    expect(conciliaciones.contenido).toContain('auxiliar-efectivo-al-corte-vs-mayor,ok');
    expect(conciliaciones.contenido).toContain('cuentas-exportadas-vs-mayor-al-corte,ok');
    expect(conciliaciones.contenido).toContain('total-activo,100.00');
    db.close();
  });

  it('un asiento borrador y uno futuro no influyen en los saldos al corte', () => {
    const db = abrir();
    const cliente = crearContraparte(db, { nombre: 'Cliente Borrador A36', esCliente: true, esProveedor: false, responsable: 'p' });
    registrarVenta(db, {
      contraparteId: cliente,
      fechaOperacion: '2026-11-01',
      concepto: 'Venta base sintética',
      tipoIngreso: 'instalaciones',
      base: '50.00',
      tasa: '0',
      claveIdempotencia: 'v-a36b',
      responsable: 'p'
    });

    db.prepare("INSERT OR IGNORE INTO periodo (inicio, fin) VALUES ('2026-11-01', '2026-11-30')").run();
    const periodoId = (db.prepare("SELECT id FROM periodo WHERE inicio = '2026-11-01'").get() as { id: number }).id;
    const borrador = db
      .prepare(
        `INSERT INTO asiento (folio, fecha_operacion, periodo_id, ambito_id, concepto, estado, responsable)
         VALUES ('A-900001', '2026-11-10', ?, 'administrativo', 'Borrador sintético', 'borrador', 'p')`
      )
      .run(periodoId);
    db.prepare('INSERT INTO asiento_linea (asiento_id, cuenta_id, debe_minor, haber_minor) VALUES (?, ?, 7000, 0)').run(
      borrador.lastInsertRowid,
      idCuenta(db, '1101')
    );
    const futuro = db
      .prepare(
        `INSERT INTO asiento (folio, fecha_operacion, periodo_id, ambito_id, concepto, estado, responsable)
         VALUES ('A-900002', '2026-12-20', ?, 'administrativo', 'Futuro sintético', 'borrador', 'p')`
      )
      .run(periodoId);
    void futuro;

    const paquete = generarPaqueteContador(db, '2026-11-01', '2026-11-30');
    const cuentas = paquete.archivos.find(a => a.nombre === 'cuentas.csv')!;
    expect(cuentas.contenido).toContain('1101,Caja general,activo,0.00');
    expect(cuentas.contenido).toContain('1201,Clientes,activo,50.00');
    expect(paquete.conciliaciones.balanceCuadra).toBe(true);
    db.close();
  });
});

describe('auditoría 36: matriz de validación fiscal del Anexo 1', () => {
  it('identificación inválida, límites y vigencia parcial bloquean la presentación', () => {
    const db = abrir();
    vigenciaInscrita(db, '2026-11-01', '2026-11-15');
    const venta = ventaContribuyente(db, {
      nombre: 'Cliente Validación A36',
      nit: 'ABC',
      fecha: '2026-11-20',
      base: '100.00',
      tasa: '0',
      clave: 'v-a36v'
    });
    completarMetadatosFiscales(
      db,
      'venta',
      venta.id,
      {
        claseDocumentoFiscal: '2',
        numeroResolucion: 'R'.repeat(101),
        serieDocumento: 'A',
        numeroDocumentoAutorizado: 'NUM-SINTETICO',
        tratamientoVenta: 'exenta',
        tipoOperacionRenta: '2',
        tipoIngresoRenta: '2'
      },
      'p',
      'completitud sintética'
    );

    const diagnostico = despachar(contexto(db), 'fiscal:anexo1Ventas', { mes: '2026-11' }) as {
      folios: Array<{ folio: string; faltantes: string[] }>;
      bloqueado: boolean;
    };
    expect(diagnostico.bloqueado).toBe(true);
    const faltantes = diagnostico.folios[0].faltantes;
    expect(faltantes.some(f => f.includes('NIT (14 dígitos) o NRC válido'))).toBe(true);
    expect(faltantes.some(f => f.includes('resolución excede 100 caracteres'))).toBe(true);
    expect(faltantes.some(f => f.includes('cobertura de vigencia'))).toBe(true);
    expect(() => exportarAnexo1VentasPresentacion(db, '2026-11')).toThrow(/bloqueado/);
    db.close();
  });

  it('clase 2 exige G=F y clase 4 deja G vacía; período anterior a 2025 usa R/S=0', () => {
    const db = abrir();
    vigenciaInscrita(db, '2024-01-01');
    const venta2024 = ventaContribuyente(db, {
      nombre: 'Cliente Clase 2 A36',
      nit: '0614-123456-101-5',
      fecha: '2024-11-05',
      base: '100.00',
      tasa: '13',
      clave: 'v-a36c2'
    });
    completarMetadatosFiscales(
      db,
      'venta',
      venta2024.id,
      {
        claseDocumentoFiscal: '2',
        numeroResolucion: 'R-SINTETICA-2',
        serieDocumento: 'A',
        numeroDocumentoAutorizado: 'NUM-CLASE2',
        tipoOperacionRenta: '1',
        tipoIngresoRenta: '2'
      },
      'p',
      'completitud sintética'
    );

    const anexo2024 = exportarAnexo1VentasPresentacion(db, '2024-11');
    const fila2024 = anexo2024.csv.split('\n')[0].split(';');
    expect(fila2024[5]).toBe('NUM-CLASE2');
    expect(fila2024[6]).toBe('NUM-CLASE2');
    expect(fila2024[17]).toBe('0');
    expect(fila2024[18]).toBe('0');

    const ventaDte = ventaContribuyente(db, {
      nombre: 'Cliente DTE A36',
      nit: '0614-654321-101-5',
      fecha: '2026-11-06',
      base: '100.00',
      tasa: '13',
      clave: 'v-a36dte'
    });
    completarMetadatosFiscales(
      db,
      'venta',
      ventaDte.id,
      {
        claseDocumentoFiscal: '4',
        numeroResolucion: 'CODIGOGENERACION-SINTETICO',
        serieDocumento: 'SELLO-SINTETICO',
        numeroDocumentoAutorizado: 'CODGEN-SINTETICO',
        tipoOperacionRenta: '1',
        tipoIngresoRenta: '2'
      },
      'p',
      'completitud sintética'
    );
    const anexo2026 = exportarAnexo1VentasPresentacion(db, '2026-11');
    const filaDte = anexo2026.csv.split('\n')[0].split(';');
    expect(filaDte[1]).toBe('4');
    expect(filaDte[6]).toBe('');
    expect(filaDte[17]).toBe('1');
    expect(filaDte[18]).toBe('2');
    db.close();
  });

  it('la revalidación al exportar rechaza un folio que dejó de ser válido', () => {
    const db = abrir();
    vigenciaInscrita(db, '2026-01-01');
    const venta = ventaContribuyente(db, {
      nombre: 'Cliente Revalidación A36',
      nit: '0614-999999-101-5',
      fecha: '2026-11-07',
      base: '100.00',
      tasa: '13',
      clave: 'v-a36r'
    });
    completarMetadatosFiscales(
      db,
      'venta',
      venta.id,
      {
        claseDocumentoFiscal: '1',
        numeroResolucion: 'R-SINTETICA-R',
        serieDocumento: 'A',
        numeroDocumentoAutorizado: '000001',
        tipoOperacionRenta: '1',
        tipoIngresoRenta: '2'
      },
      'p',
      'completitud sintética'
    );
    const diagnostico = diagnosticarAnexo1Ventas(db, '2026-11');
    expect(diagnostico.bloqueado).toBe(false);

    db.prepare('UPDATE contraparte SET nit = ? WHERE nombre = ?').run('INVALIDADO', 'Cliente Revalidación A36');
    expect(() => exportarAnexo1VentasPresentacion(db, '2026-11')).toThrow(/NIT \(14 dígitos\) o NRC válido/);
    db.close();
  });
});
