import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { abrirBase, prepararRutasDatos } from '../src/main/db/conexion';
import { aplicarMigraciones, versionEsquemaActual } from '../src/main/db/aplicarMigraciones';
import { migraciones } from '../src/main/db/migraciones';
import { sembrarCatalogoBase } from '../src/main/servicios/cuentas';
import { contabilizarAsiento } from '../src/main/servicios/motorAsientos';
import { registrarCompra, crearContraparte } from '../src/main/servicios/operacion';
import { estadoSituacionFinanciera } from '../src/main/servicios/estadosFinancieros';
import {
  calcularCuotas,
  cuotasDepreciacionActivo,
  darAltaActivoFijo,
  mesSiguiente,
  ErrorActivoFijo
} from '../src/main/servicios/activosFijos';
import type BetterSqlite3 from 'better-sqlite3';

// Bloque 3, tarea 3A: migración, alta y cálculo de cuotas. Cifras calculadas A MANO.

let dir: string;
let rutaDb: string;
let rutas: ReturnType<typeof prepararRutasDatos>;
let db: BetterSqlite3.Database;
const abiertas: Array<BetterSqlite3.Database> = [];

function idCuenta(codigo: string): number {
  return (db.prepare('SELECT id FROM cuenta WHERE codigo = ?').get(codigo) as { id: number }).id;
}

function alta(entrada: Partial<Parameters<typeof darAltaActivoFijo>[1]> = {}) {
  return darAltaActivoFijo(db, {
    descripcion: 'Herramienta sintética de prueba',
    categoria: 'Herramientas',
    ubicacion: 'Bodega sintética',
    responsable: 'qa',
    fechaAdquisicion: '2026-01-10',
    fechaInicioUso: '2026-01-15',
    costoMinor: '1200.00',
    residualMinor: '0.00',
    vidaUtilMeses: 12,
    cuentaActivoId: idCuenta('1501'),
    cuentaDepreciacionId: idCuenta('1502'),
    cuentaGastoId: idCuenta('6101'),
    cuentaContrapartidaId: idCuenta('1101'),
    ...entrada
  });
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arkon-3a-'));
  rutas = prepararRutasDatos(path.join(dir, 'datos'));
  rutaDb = path.join(rutas.datos, 'op.db');
  db = abrirBase(rutaDb);
  abiertas.push(db);
  aplicarMigraciones(db);
  sembrarCatalogoBase(db);
  db.prepare("INSERT INTO ambito (id, nombre, tipo) VALUES ('administrativo', 'Prueba 3A', 'administrativo')").run();
});

afterEach(() => {
  for (const base of abiertas.splice(0)) {
    if (base.open) {
      base.close();
    }
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('bloque 3A: migración de activos fijos', () => {
  it('la versión 20 crea activo_fijo, depreciacion_lote y depreciacion_detalle con la restricción única', () => {
    expect(versionEsquemaActual()).toBe(20);
    for (const tabla of ['activo_fijo', 'depreciacion_lote', 'depreciacion_detalle']) {
      expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(tabla)).toBeTruthy();
    }
    // Restricción única: un activo no se deprecia dos veces en el mismo mes.
    const asiento = contabilizarAsiento(db, {
      fechaOperacion: '2026-02-10',
      concepto: 'Asiento sintético para el lote',
      responsable: 'qa',
      ambitoId: 'administrativo',
      lineas: [
        { cuentaId: idCuenta('6101'), debeMinor: '1.00', haberMinor: '' },
        { cuentaId: idCuenta('1101'), debeMinor: '', haberMinor: '1.00' }
      ],
      claveIdempotencia: 'lote-3a'
    });
    const asientoId = (db.prepare('SELECT id FROM asiento WHERE folio = ?').get(asiento.folio) as { id: number }).id;
    db.prepare("INSERT INTO depreciacion_lote (mes, asiento_id, total_minor, responsable) VALUES ('2026-02', ?, 0, 'qa')").run(asientoId);
    const loteId = (db.prepare('SELECT id FROM depreciacion_lote LIMIT 1').get() as { id: number }).id;
    const rAlta = alta();
    const insertar = db.prepare('INSERT INTO depreciacion_detalle (lote_id, activo_fijo_id, mes, cuota_minor) VALUES (?, ?, ?, 100)');
    insertar.run(loteId, rAlta.id, '2026-02');
    expect(() => insertar.run(loteId, rAlta.id, '2026-02')).toThrow();
  });

  it('una base con esquema anterior (v19) migra a la 20 conservando los datos', () => {
    const dirAnterior = fs.mkdtempSync(path.join(os.tmpdir(), 'arkon-3a-v19-'));
    const rutaAnterior = path.join(dirAnterior, 'anterior.db');
    const anterior = abrirBase(rutaAnterior);
    abiertas.push(anterior);
    // Aplicar solo hasta v19: esquema anterior.
    anterior.exec(`CREATE TABLE IF NOT EXISTS _migracion (version INTEGER PRIMARY KEY, nombre TEXT NOT NULL, aplicada_en TEXT NOT NULL DEFAULT (datetime('now')))`);
    for (const m of migraciones.filter(m2 => m2.version <= 19)) {
      anterior.exec(m.sql);
      anterior.prepare('INSERT INTO _migracion (version, nombre) VALUES (?, ?)').run(m.version, m.nombre);
    }
    sembrarCatalogoBase(anterior);
    anterior.prepare("INSERT INTO ambito (id, nombre, tipo) VALUES ('administrativo', 'Anterior', 'administrativo')").run();
    const asientosAntes = (anterior.prepare('SELECT COUNT(*) AS n FROM asiento').get() as { n: number }).n;
    aplicarMigraciones(anterior);
    expect((anterior.prepare('SELECT MAX(version) AS v FROM _migracion').get() as { v: number }).v).toBe(20);
    expect(anterior.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'activo_fijo'").get()).toBeTruthy();
    expect((anterior.prepare('SELECT COUNT(*) AS n FROM asiento').get() as { n: number }).n).toBe(asientosAntes);
    anterior.close();
    fs.rmSync(dirAnterior, { recursive: true, force: true });
  });
});

describe('bloque 3A: cálculo de cuotas (cifras a mano)', () => {
  it('1,200.00 a 12 meses: 100.00 por mes y el acumulado iguala lo depreciable', () => {
    const cuotas = calcularCuotas(120000n, 12);
    expect(cuotas).toHaveLength(12);
    expect(cuotas.every(c => c === 10000n)).toBe(true);
    expect(cuotas.reduce((s, c) => s + c, 0n)).toBe(120000n);
  });

  it('1,000.00 a 3 meses: 333.33, 333.33 y 333.34 con acumulado exacto', () => {
    const cuotas = calcularCuotas(100000n, 3);
    expect(cuotas.map(c => c.toString())).toEqual(['33333', '33333', '33334']);
    expect(cuotas.reduce((s, c) => s + c, 0n)).toBe(100000n);
  });

  it('con residual: 1,000.00, residual 100.00, 9 meses → 100.00 por mes', () => {
    const cuotas = calcularCuotas(100000n - 10000n, 9);
    expect(cuotas.every(c => c === 10000n)).toBe(true);
    expect(cuotas.reduce((s, c) => s + c, 0n)).toBe(90000n);
  });

  it('el último mes absorbe el redondeo aunque el acumulado previo se pase', () => {
    // A mano: 100.00 a 3 meses → 33.33, 33.33, 33.34.
    const cuotas = calcularCuotas(10000n, 3);
    expect(cuotas.map(c => c.toString())).toEqual(['3333', '3333', '3334']);
    expect(cuotas.reduce((s, c) => s + c, 0n)).toBe(10000n);
  });

  it('inicio de uso el 31 de enero: la primera cuota cae en febrero (política propuesta)', () => {
    const r = alta({ fechaInicioUso: '2026-01-31', costoMinor: '1200.00', vidaUtilMeses: 12 });
    const cuadro = cuotasDepreciacionActivo(db, r.id);
    expect(cuadro.mesInicio).toBe('2026-02');
    expect(cuadro.cuotas[0]!.mes).toBe('2026-02');
    expect(cuadro.cuotas[0]!.cuotaMinor).toBe('100.00');
    expect(cuadro.cuotas[11]!.mes).toBe('2027-01');
    expect(cuadro.cuotas[11]!.acumuladoMinor).toBe('1200.00');
    expect(mesSiguiente('2026-12-15')).toBe('2027-01');
  });
});

describe('bloque 3A: alta de activos fijos', () => {
  it('código correlativo AF-000001 sin reutilizar y asiento de alta con contrapartida', () => {
    const primero = alta();
    expect(primero.codigo).toBe('AF-000001');
    expect(primero.asientoAltaId).not.toBeNull();
    const asiento = db.prepare('SELECT folio, concepto FROM asiento WHERE id = ?').get(primero.asientoAltaId) as { folio: string; concepto: string };
    expect(asiento.concepto).toContain('AF-000001');
    // Líneas: Debe 1501 1200.00, Haber 1101 1200.00.
    const lineas = db
      .prepare('SELECT c.codigo, l.debe_minor AS debe, l.haber_minor AS haber FROM asiento_linea l JOIN cuenta c ON c.id = l.cuenta_id WHERE l.asiento_id = ?')
      .safeIntegers(true)
      .all(primero.asientoAltaId) as Array<{ codigo: string; debe: bigint; haber: bigint }>;
    expect(lineas).toHaveLength(2);
    const activa = lineas.find(l => l.codigo === '1501')!;
    expect(activa.debe).toBe(120000n);
    const contrapartida = lineas.find(l => l.codigo === '1101')!;
    expect(contrapartida.haber).toBe(120000n);
    const segundo = alta({ descripcion: 'Segunda herramienta sintética' });
    expect(segundo.codigo).toBe('AF-000002');
    // Sin reutilizar: el correlativo sigue al máximo existente.
    const tercero = alta({ descripcion: 'Tercera herramienta sintética' });
    expect(tercero.codigo).toBe('AF-000003');
  });

  it('desde una compra ya contabilizada en la cuenta del activo NO genera otro asiento', () => {
    const proveedor = crearContraparte(db, { nombre: 'Proveedor 3A', esCliente: false, esProveedor: true, responsable: 'qa' });
    const compra = registrarCompra(db, {
      contraparteId: proveedor,
      fechaOperacion: '2026-01-10',
      concepto: 'Compra de herramienta sintética',
      condicion: 'contado',
      lineas: [{ descripcion: 'Herramienta', cuentaCodigo: '1501', cantidad: '1', precioUnitario: '1200.00', tasa: '0', tratamiento: 'exento' }],
      claveIdempotencia: 'c-3a',
      responsable: 'qa'
    });
    const asientosAntes = (db.prepare('SELECT COUNT(*) AS n FROM asiento').get() as { n: number }).n;
    const r = alta({ compraId: compra.id, cuentaContrapartidaId: undefined });
    expect(r.codigo).toBe('AF-000001');
    expect(r.asientoAltaId).toBeNull();
    expect((db.prepare('SELECT COUNT(*) AS n FROM asiento').get() as { n: number }).n).toBe(asientosAntes);
    const activo = db.prepare('SELECT compra_id FROM activo_fijo WHERE id = ?').get(r.id) as { compra_id: number };
    expect(activo.compra_id).toBe(compra.id);
  });

  it('validaciones: residual mayor que costo, cuentas de tipo incorrecto y sin contrapartida sin compra', () => {
    expect(() => alta({ residualMinor: '2000.00' })).toThrow(ErrorActivoFijo);
    expect(() => alta({ cuentaGastoId: idCuenta('4101') })).toThrow(/gasto/);
    expect(() => alta({ cuentaActivoId: idCuenta('6101') })).toThrow(/activo fijo/);
    expect(() => alta({ cuentaContrapartidaId: undefined })).toThrow(/contrapartida/);
    expect(() => alta({ vidaUtilMeses: 0 })).toThrow(ErrorActivoFijo);
    expect(() => alta({ fechaInicioUso: '2026-01-01', fechaAdquisicion: '2026-01-10' })).toThrow(/anterior/);
    expect(() => alta({ compraId: 999999 })).toThrow(/compra/);
  });

  it('bitácora con responsable y la situación financiera cuadra tras el alta', () => {
    const r = alta({ cuentaContrapartidaId: idCuenta('3101') });
    const evento = db
      .prepare("SELECT actor, tipo, detalle FROM bitacora_evento WHERE tipo = 'activo_fijo_alta' ORDER BY id DESC LIMIT 1")
      .get() as { actor: string; tipo: string; detalle: string };
    expect(evento.actor).toBe('qa');
    expect(evento.detalle).toContain('AF-000001');
    expect(evento.detalle).toContain('mes_siguiente_al_inicio_de_uso');
    const s = estadoSituacionFinanciera(db, { corte: '2026-01-31' });
    // A mano: Debe 1501 1200.00 / Haber 3101 1200.00 → activo 1200.00, patrimonio 1200.00, cuadra.
    expect(s.activo.totalMinor).toBe('1200.00');
    expect(s.patrimonio.totalMinor).toBe('1200.00');
    expect(s.cuadra).toBe(true);
  });
});
