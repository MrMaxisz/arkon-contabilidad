import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { abrirBase, prepararRutasDatos } from '../src/main/db/conexion';
import { aplicarMigraciones } from '../src/main/db/aplicarMigraciones';
import { sembrarCatalogoBase } from '../src/main/servicios/cuentas';
import { despachar } from '../src/main/comandos';
import { consultarEjercicio, csvEjercicio } from '../src/main/servicios/ejercicioAnual';
import { cerrarEjercicio, reabrirEjercicio } from '../src/main/servicios/cierre';
import { anularAsiento } from '../src/main/servicios/motorAsientos';
import { exportarAnexoRetencionesF14Presentacion } from '../src/main/servicios/anexoF14';
import { registrarRetencion } from '../src/main/servicios/fiscal';
import {
  crearContraparte,
  registrarVenta,
  registrarCompra,
  anularDocumento
} from '../src/main/servicios/operacion';
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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arkon-a43-'));
  rutas = prepararRutasDatos(path.join(dir, 'datos'));
  rutaDb = path.join(rutas.datos, 'op.db');
  fs.mkdirSync(rutas.datos, { recursive: true });
  const db = abrir();
  sembrarCatalogoBase(db);
  db.prepare("INSERT INTO ambito (id, nombre, tipo) VALUES ('administrativo', 'Prueba a43', 'administrativo')").run();
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

function venta(db: BetterSqlite3.Database, clienteId: number, fecha: string, base: string, clave: string) {
  return registrarVenta(db, {
    contraparteId: clienteId,
    fechaOperacion: fecha,
    concepto: `Venta ${clave} sintética`,
    tipoIngreso: 'instalaciones',
    base,
    tasa: '0',
    claveIdempotencia: clave,
    responsable: 'p'
  });
}

describe('auditoría 43: soporte interno del ejercicio anual', () => {
  it('diferencia movimientos del ejercicio de saldos acumulados; excluye el cierre del resultado ordinario; concilia con mayor independiente', () => {
    const db = abrir();
    const ctx = contexto(db);
    const cliente = crearContraparte(db, { nombre: 'Cliente Ejercicio A43', esCliente: true, esProveedor: false, responsable: 'p' });
    const proveedor = crearContraparte(db, { nombre: 'Proveedor Ejercicio A43', esCliente: false, esProveedor: true, responsable: 'p' });

    // Antes del año: NO cuenta como movimiento del ejercicio, SÍ en saldos acumulados.
    venta(db, cliente, '2025-12-15', '50.00', 'v-a43-antes');
    // Dentro del año: cuenta en ambos.
    venta(db, cliente, '2026-03-10', '100.00', 'v-a43-dentro');
    // Después del año: NO cuenta en este ejercicio.
    venta(db, cliente, '2027-01-20', '70.00', 'v-a43-despues');
    // Compra dentro (costo) y retención efectuada dentro.
    registrarCompra(db, {
      contraparteId: proveedor,
      fechaOperacion: '2026-05-10',
      concepto: 'Compra ejercicio sintética',
      condicion: 'contado',
      lineas: [{ descripcion: 'Material sintético', cuentaCodigo: '5101', cantidad: '1', precioUnitario: '30.00', tasa: '0', tratamiento: 'exento' }],
      claveIdempotencia: 'c-a43-dentro',
      responsable: 'p'
    });
    registrarRetencion(db, {
      tipo: 'efectuada', contraparteId: proveedor, fechaOperacion: '2026-06-10',
      base: '200.00', tasa: '10', regla: 'regla sintética', concepto: 'retención sintética',
      claveIdempotencia: 'ret-a43', responsable: 'p'
    });
    // Ajuste dentro del año (ingreso adicional).
    despachar(ctx, 'ajuste:registrar', {
      fechaOperacion: '2026-07-15',
      concepto: 'ajuste sintético del ejercicio',
      lineas: [
        { cuentaCodigo: '1101', debeMinor: '10.00', haberMinor: '' },
        { cuentaCodigo: '4101', debeMinor: '', haberMinor: '10.00' }
      ],
      referencia: 'soporte sintético',
      claveIdempotencia: 'aj-a43',
      responsable: 'p'
    });
    // Anulación con reverso dentro del año: neto cero.
    const anulada = venta(db, cliente, '2026-08-10', '40.00', 'v-a43-anulada');
    anularDocumento(db, 'venta', anulada.id, 'p', 'anulación sintética del ejercicio');
    // Cierre del ejercicio 2026 (asiento de cierre: no debe duplicar resultado ordinario).
    cerrarEjercicio(db, { anio: 2026, responsable: 'p', motivo: 'cierre sintético', referencia: 'soporte cierre sintético', claveIdempotencia: 'ci-a43' });

    const informe = consultarEjercicio(db, 2026);
    // Resultado ordinario: ingresos (100 + 10 ajuste + 40 anulada - 40 reverso) - costo 30 = 80.
    expect(informe.resultadoOrdinarioMinor).toBe('80.00');
    // Con cierre: el asiento de cierre lleva resultados a 3201 → resultado con cierre = 0.
    expect(informe.resultadoConCierreMinor).toBe('0.00');
    expect(informe.ingresosMinor).toBe('110.00');
    expect(informe.costosGastosMinor).toBe('-30.00');
    expect(informe.retencionesEfectuadasMinor).toBe('20.00');
    expect(informe.conciliacionMayor.concilia).toBe(true);

    // Saldos acumulados incluyen lo de 2025; movimientos del ejercicio no.
    const cuenta4101 = informe.cuentas.find(c => c.codigo === '4101')!;
    expect(cuenta4101.movimientoMinor).toBe('110.00');
    // Conciliación INDEPENDIENTE: verificar contra una tercera consulta directa del mayor.
    const mayorDirecto = db
      .prepare(
        `SELECT COALESCE(SUM(l.haber_minor - l.debe_minor), 0) AS s
         FROM asiento_linea l
         JOIN asiento a ON a.id = l.asiento_id AND a.estado IN ('contabilizado','anulado')
           AND a.fecha_operacion >= '2026-01-01' AND a.fecha_operacion <= '2026-12-31' AND a.origen_tipo IS NOT 'cierre'
         JOIN cuenta c ON c.id = l.cuenta_id AND c.tipo = 'ingreso'`
      )
      .get() as { s: number };
    const ingresosMayor = BigInt(mayorDirecto.s);
    const ingresosInforme = BigInt(Math.round(Number(informe.ingresosMinor.replace('.', '')) * 100) / 100);
    void ingresosInforme;
    expect(ingresosMayor).toBe(11000n);

    // Reapertura: el resultado ordinario se mantiene (el reverso del cierre compensa).
    reabrirEjercicio(db, { anio: 2026, responsable: 'p', motivo: 'reapertura sintética' });
    const informeReabierto = consultarEjercicio(db, 2026);
    expect(informeReabierto.resultadoOrdinarioMinor).toBe('80.00');
    expect(informeReabierto.conciliacionMayor.concilia).toBe(true);

    // Archivos del paquete con cifras visibles.
    const archivos = csvEjercicio(informeReabierto);
    const leeme = archivos.find(a => a.nombre === 'LEEME.txt')!;
    expect(leeme.contenido).toContain('ejercicio-anual-interno-v1');
    expect(leeme.contenido).toContain('80.00');
    expect(leeme.contenido).toContain('NO es declaración F-11');
    const asientosCsv = archivos.find(a => a.nombre === 'asientos-ejercicio.csv')!;
    expect(asientosCsv.contenido).toContain('cierre');
    db.close();
  });

  it('rechaza año inválido y funciona por despachar con reapertura del paquete', () => {
    const db = abrir();
    const ctx = contexto(db);
    expect(() => consultarEjercicio(db, 12345)).toThrow(/rango/);
    const informe = despachar(ctx, 'ejercicio:consultar', { anio: 2026 }) as {
      version: string;
      anio: number;
      limitaciones: string[];
    };
    expect(informe.version).toBe('ejercicio-anual-interno-v1');
    expect(informe.anio).toBe(2026);
    expect(informe.limitaciones.some(l => l.includes('NO es declaración F-11'))).toBe(true);
    db.close();
  });
});

describe('auditoría 44: familia de cierre anulada no duplica el resultado ordinario', () => {
  it('cierre→reapertura→anular cierre→ajuste→nuevo cierre→reabrir SQLite: cifras independientes correctas', () => {
    const db = abrir();
    const ctx = contexto(db);
    const cliente = crearContraparte(db, { nombre: 'Cliente Cierre A44', esCliente: true, esProveedor: false, responsable: 'p' });
    venta(db, cliente, '2026-03-10', '100.00', 'v-a44-cierre');

    // Cierre inicial: ordinario 100, con cierre 0.
    cerrarEjercicio(db, { anio: 2026, responsable: 'p', motivo: 'cierre sintético uno', referencia: 'soporte sintético', claveIdempotencia: 'ci-a44-1' });
    const trasCierre = consultarEjercicio(db, 2026);
    expect(trasCierre.resultadoOrdinarioMinor).toBe('100.00');
    expect(trasCierre.resultadoConCierreMinor).toBe('0.00');

    // Reapertura y ANULACIÓN del asiento de cierre: el reverso del cierre NO debe duplicar.
    reabrirEjercicio(db, { anio: 2026, responsable: 'p', motivo: 'reapertura sintética' });
    const cierreAsiento = db
      .prepare("SELECT id FROM asiento WHERE origen_tipo = 'cierre' AND estado = 'contabilizado' AND fecha_operacion LIKE '2026%'")
      .get() as { id: number };
    anularAsiento(db, cierreAsiento.id, 'p', 'anulación del cierre sintético');
    const trasAnular = consultarEjercicio(db, 2026);
    expect(trasAnular.resultadoOrdinarioMinor).toBe('100.00');
    expect(trasAnular.resultadoConCierreMinor).toBe('100.00');
    expect(trasAnular.conciliacionMayor.concilia).toBe(true);

    // Ajuste y SEGUNDO cierre: ordinario 110, con cierre 0.
    despachar(ctx, 'ajuste:registrar', {
      fechaOperacion: '2026-10-15',
      concepto: 'ajuste sintético post anulación',
      lineas: [
        { cuentaCodigo: '1101', debeMinor: '10.00', haberMinor: '' },
        { cuentaCodigo: '4101', debeMinor: '', haberMinor: '10.00' }
      ],
      referencia: 'soporte sintético',
      claveIdempotencia: 'aj-a44',
      responsable: 'p'
    });
    cerrarEjercicio(db, { anio: 2026, responsable: 'p', motivo: 'cierre sintético dos', referencia: 'soporte sintético dos', claveIdempotencia: 'ci-a44-2' });
    const trasSegundo = consultarEjercicio(db, 2026);
    expect(trasSegundo.resultadoOrdinarioMinor).toBe('110.00');
    expect(trasSegundo.resultadoConCierreMinor).toBe('0.00');
    expect(trasSegundo.conciliacionMayor.concilia).toBe(true);

    // Reabrir SQLite: cifras persistentes y archivos coherentes.
    db.close();
    const db2 = abrir();
    const trasReabrir = consultarEjercicio(db2, 2026);
    expect(trasReabrir.resultadoOrdinarioMinor).toBe('110.00');
    expect(trasReabrir.resultadoConCierreMinor).toBe('0.00');
    const archivos = csvEjercicio(trasReabrir);
    const leeme = archivos.find(a => a.nombre === 'LEEME.txt')!;
    expect(leeme.contenido).toContain('110.00');
    const cierreFamilia = trasReabrir.asientos.filter(a => a.familiaCierre);
    expect(cierreFamilia.length).toBeGreaterThanOrEqual(2);
    db2.close();
  });
});

describe('auditoría 44: códigos F-14 verificados pero no soportados se bloquean', () => {
  it('código 60 (sin retención) y 80 (laboral) se bloquean en guardar/diagnóstico/exportación', () => {
    const db = abrir();
    const ctx = contexto(db);
    despachar(ctx, 'vigencia:crear', {
      desde: '2026-01-01', inscritoIva: false, obligacionF14: true,
      descripcion: 'autorización F-14 sintética', fuente: 'prueba sintética', responsable: 'p'
    });
    const proveedor = crearContraparte(db, { nombre: 'Proveedor Codigos A44', esCliente: false, esProveedor: true, responsable: 'p', nit: '0614-666777-101-5' });
    const ret = registrarRetencion(db, {
      tipo: 'efectuada', contraparteId: proveedor, fechaOperacion: '2026-11-10',
      base: '100.00', tasa: '10', regla: 'regla sintética', concepto: 'retención sintética',
      claveIdempotencia: 'ret-a44-cod', responsable: 'p'
    });

    const guardar = (codigo: string) =>
      despachar(ctx, 'fiscal:retencionMetadatosCompletar', {
        retencionId: ret.id, domiciliado: '1', codigoPais: '9300', nitNif: '0614-666777-101-5',
        codigoIngreso: codigo, tipoOperacion: '1', clasificacion: '2', sector: '2', tipoCostoGasto: '1',
        involucraNomina: false, personaNatural: false, responsable: 'p', motivo: 'completitud sintética'
      });

    expect(() => guardar('60')).toThrow(/gravados sin retención/);
    expect(() => guardar('80')).toThrow(/código laboral/);
    expect(() => guardar('05')).toThrow(/sin captura\/reglas suficientes/);
    expect(() => guardar('42')).not.toThrow();
    expect(() => guardar('11')).not.toThrow();

    // Registro existente con código bloqueado: diagnóstico y exportación lo rechazan.
    db.prepare('UPDATE retencion SET codigo_ingreso = ? WHERE id = ?').run('60', ret.id);
    const diagnostico = despachar(ctx, 'fiscal:anexoRetenciones', { mes: '2026-11' }) as {
      folios: Array<{ folio: string; faltantes: string[] }>;
      bloqueado: boolean;
    };
    expect(diagnostico.bloqueado).toBe(true);
    expect(diagnostico.folios[0].faltantes.some(f => f.includes('gravados sin retención'))).toBe(true);
    expect(() => exportarAnexoRetencionesF14Presentacion(db, '2026-11')).toThrow(/gravados sin retención/);
    db.close();
  });
});
