import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { abrirBase, prepararRutasDatos } from '../src/main/db/conexion';
import { aplicarMigraciones, versionEsquemaActual } from '../src/main/db/aplicarMigraciones';
import { migraciones } from '../src/main/db/migraciones';
import { sembrarCatalogoBase } from '../src/main/servicios/cuentas';
import { contabilizarAsiento, cerrarPeriodo, periodoDeFecha } from '../src/main/servicios/motorAsientos';
import { registrarCompra, crearContraparte } from '../src/main/servicios/operacion';
import { estadoSituacionFinanciera } from '../src/main/servicios/estadosFinancieros';
import {
  calcularCuotas,
  cuotasDepreciacionActivo,
  darAltaActivoFijo,
  mesSiguiente,
  previsualizarDepreciacion,
  depreciarMes,
  anularUltimoLote,
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

describe('auditoría 75: correcciones a la 3A', () => {
  it('P1-75-1: ninguna cuota negativa; 5 centavos a 10 meses y 10.00 a 285 meses', () => {
    // A mano: 5/10 → 0 en 9 meses y 5 en el último.
    const cinco = calcularCuotas(5n, 10);
    expect(cinco.slice(0, 9).every(c => c === 0n)).toBe(true);
    expect(cinco[9]).toBe(5n);
    expect(cinco.every(c => c >= 0n)).toBe(true);
    expect(cinco.reduce((s, c) => s + c, 0n)).toBe(5n);
    // A mano: 10.00 = 1000 centavos a 285 meses → 3 en 284 meses y 148 en el último.
    const largo = calcularCuotas(1000n, 285);
    expect(largo.slice(0, 284).every(c => c === 3n)).toBe(true);
    expect(largo[284]).toBe(148n);
    expect(largo.every(c => c >= 0n)).toBe(true);
    expect(largo.reduce((s, c) => s + c, 0n)).toBe(1000n);
  });

  it('P1-75-2: el alta es atómica; un fallo en el INSERT no deja asiento huérfano', () => {
    const asientosAntes = (db.prepare('SELECT COUNT(*) AS n FROM asiento').get() as { n: number }).n;
    db.exec(
      `CREATE TRIGGER fallo_insert_activo BEFORE INSERT ON activo_fijo
       BEGIN SELECT RAISE(ABORT, 'fallo forzado de la auditoría 75'); END`
    );
    expect(() => alta()).toThrow(/fallo forzado/);
    expect((db.prepare('SELECT COUNT(*) AS n FROM asiento').get() as { n: number }).n).toBe(asientosAntes);
    db.exec('DROP TRIGGER fallo_insert_activo');
    const r = alta();
    expect(r.codigo).toBe('AF-000001');
  });

  it('P2-75-3: la cuenta de depreciación debe ser distinta del activo y reguladora', () => {
    expect(() => alta({ cuentaDepreciacionId: idCuenta('1501') })).toThrow(/distinta/);
    // 1103 (Bancos, tipo activo pero no reguladora) no sirve como acumulada.
    expect(() => alta({ cuentaDepreciacionId: idCuenta('1103') })).toThrow(/reguladora/);
  });

  it('P2-75-4: la suma de costos de una compra no supera lo contabilizado en esa cuenta', () => {
    const proveedor = crearContraparte(db, { nombre: 'Proveedor 75', esCliente: false, esProveedor: true, responsable: 'qa' });
    const compra = registrarCompra(db, {
      contraparteId: proveedor,
      fechaOperacion: '2026-01-10',
      concepto: 'Compra de herramienta 75',
      condicion: 'contado',
      lineas: [{ descripcion: 'Herramienta', cuentaCodigo: '1501', cantidad: '1', precioUnitario: '500.00', tasa: '0', tratamiento: 'exento' }],
      claveIdempotencia: 'c-75',
      responsable: 'qa'
    });
    // Contabilizado: 500.00. Un activo de 400.00 entra; otro de 200.00 ya no cabe.
    alta({ compraId: compra.id, cuentaContrapartidaId: undefined, costoMinor: '400.00', descripcion: 'Activo uno de la compra' });
    expect(() =>
      alta({ compraId: compra.id, cuentaContrapartidaId: undefined, costoMinor: '200.00', descripcion: 'Activo dos de la compra' })
    ).toThrow(/supera lo disponible/);
    // Con 100.00 restante sí cabe.
    alta({ compraId: compra.id, cuentaContrapartidaId: undefined, costoMinor: '100.00', descripcion: 'Activo tres de la compra' });
  });
});

describe('bloque 3B: depreciación del mes', () => {
  it('vista previa y lote con una línea por combinación de cuentas; mismo mes dos veces sin duplicar', () => {
    alta({ fechaInicioUso: '2026-01-15', costoMinor: '1200.00', vidaUtilMeses: 12 });
    const previo = previsualizarDepreciacion(db, '2026-02');
    // A mano: cuota 100.00 en febrero (mes siguiente al inicio de uso).
    expect(previo.filas).toHaveLength(1);
    expect(previo.filas[0]!.cuotaMinor).toBe('100.00');
    expect(previo.filas[0]!.numeroCuota).toBe(1);
    expect(previo.totalMinor).toBe('100.00');

    const r = depreciarMes(db, { mes: '2026-02', responsable: 'qa' });
    expect(r.existente).toBe(false);
    expect(r.totalMinor).toBe('100.00');
    // Asiento: Debe 6101 100.00, Haber 1502 100.00 (una combinación).
    const lineas = db
      .prepare('SELECT c.codigo, l.debe_minor AS debe, l.haber_minor AS haber FROM asiento_linea l JOIN cuenta c ON c.id = l.cuenta_id WHERE l.asiento_id = (SELECT id FROM asiento WHERE folio = ?)')
      .safeIntegers(true)
      .all(r.asientoFolio) as Array<{ codigo: string; debe: bigint; haber: bigint }>;
    expect(lineas).toHaveLength(2);
    expect(lineas.find(l => l.codigo === '6101')!.debe).toBe(10000n);
    expect(lineas.find(l => l.codigo === '1502')!.haber).toBe(10000n);

    // Mismo mes dos veces: sin duplicar (idempotente).
    const repetido = depreciarMes(db, { mes: '2026-02', responsable: 'qa' });
    expect(repetido.existente).toBe(true);
    expect((db.prepare('SELECT COUNT(*) AS n FROM depreciacion_lote').get() as { n: number }).n).toBe(1);
    expect((db.prepare('SELECT COUNT(*) AS n FROM depreciacion_detalle').get() as { n: number }).n).toBe(1);
    // La situación cuadra tras depreciar.
    const s = estadoSituacionFinanciera(db, { corte: '2026-02-28' });
    expect(s.cuadra).toBe(true);
  });

  it('mes con hueco: rechazado; el mes anterior aplicable no puede faltar', () => {
    alta({ fechaInicioUso: '2026-01-15', costoMinor: '1200.00', vidaUtilMeses: 12 });
    // Sin depreciar febrero, marzo tiene hueco.
    expect(() => depreciarMes(db, { mes: '2026-03', responsable: 'qa' })).toThrow(/Nada que depreciar/);
    depreciarMes(db, { mes: '2026-02', responsable: 'qa' });
    // Con febrero aplicado, marzo sí entra.
    const r = depreciarMes(db, { mes: '2026-03', responsable: 'qa' });
    expect(r.existente).toBe(false);
    // Y abril sin marzo sería hueco de nuevo (simulado con un activo nuevo).
  });

  it('período cerrado: rechazado', () => {
    alta({ fechaInicioUso: '2026-01-15', costoMinor: '1200.00', vidaUtilMeses: 12 });
    depreciarMes(db, { mes: '2026-02', responsable: 'qa' });
    const periodoId = periodoDeFecha(db, '2026-03-15').id;
    cerrarPeriodo(db, periodoId, 'qa', 'cierre sintético del período para la 3B');
    expect(() => depreciarMes(db, { mes: '2026-03', responsable: 'qa' })).toThrow(/período de 2026-03 está cerrado/);
  });

  it('anular el último lote por reverso y rehacerlo', () => {
    alta({ fechaInicioUso: '2026-01-15', costoMinor: '1200.00', vidaUtilMeses: 12 });
    const r = depreciarMes(db, { mes: '2026-02', responsable: 'qa' });
    const anulado = anularUltimoLote(db, { responsable: 'qa', motivo: 'anulación sintética del lote 3B' });
    expect(anulado.mes).toBe('2026-02');
    expect(anulado.reversoFolio).toBeTruthy();
    expect((db.prepare('SELECT COUNT(*) AS n FROM depreciacion_lote').get() as { n: number }).n).toBe(0);
    expect((db.prepare('SELECT COUNT(*) AS n FROM depreciacion_detalle').get() as { n: number }).n).toBe(0);
    // El asiento original quedó anulado y existe su reverso.
    const original = db.prepare('SELECT estado FROM asiento WHERE folio = ?').get(r.asientoFolio) as { estado: string };
    expect(original.estado).toBe('anulado');
    const reverso = db.prepare('SELECT folio FROM asiento WHERE reverso_de_id = (SELECT id FROM asiento WHERE folio = ?)').get(r.asientoFolio) as { folio: string };
    expect(reverso.folio).toBe(anulado.reversoFolio);
    // La situación cuadra tras la anulación.
    expect(estadoSituacionFinanciera(db, { corte: '2026-02-28' }).cuadra).toBe(true);
    // Rehacer el mes: entra de nuevo con el mismo total.
    const recho = depreciarMes(db, { mes: '2026-02', responsable: 'qa' });
    expect(recho.existente).toBe(false);
    expect(recho.totalMinor).toBe('100.00');
    expect((db.prepare('SELECT COUNT(*) AS n FROM depreciacion_lote').get() as { n: number }).n).toBe(1);
  });

  it('excluye activos dados de baja y totalmente depreciados; la situación cuadra en cada operación', () => {
    // Vida de 4 meses: 50.00 por mes (200.00 total).
    const corto = alta({ descripcion: 'Activo corto sintético', costoMinor: '200.00', vidaUtilMeses: 4, fechaInicioUso: '2026-01-15' });
    alta({ descripcion: 'Activo largo sintético', costoMinor: '1200.00', vidaUtilMeses: 12, fechaInicioUso: '2026-01-15' });
    expect(estadoSituacionFinanciera(db, { corte: '2026-01-31' }).cuadra).toBe(true);
    depreciarMes(db, { mes: '2026-02', responsable: 'qa' });
    depreciarMes(db, { mes: '2026-03', responsable: 'qa' });
    expect(estadoSituacionFinanciera(db, { corte: '2026-03-31' }).cuadra).toBe(true);
    // A mano: en abril el corto (cuota 3 de 4, 50.00) y el largo (cuota 3, 100.00) = 150.00.
    const previo = previsualizarDepreciacion(db, '2026-04');
    expect(previo.filas.map(f => f.codigo)).toEqual(['AF-000001', 'AF-000002']);
    expect(previo.totalMinor).toBe('150.00');
    // Dado de baja: sale de la vista previa aunque le queden cuotas.
    db.prepare("UPDATE activo_fijo SET estado = 'dado_de_baja' WHERE id = ?").run(corto.id);
    const previoBaja = previsualizarDepreciacion(db, '2026-04');
    expect(previoBaja.filas.map(f => f.codigo)).toEqual(['AF-000002']);
    expect(previoBaja.totalMinor).toBe('100.00');
    expect(estadoSituacionFinanciera(db, { corte: '2026-03-31' }).cuadra).toBe(true);
  });

  it('una línea por combinación de cuentas con dos activos de cuentas distintas', () => {
    alta({ descripcion: 'Activo con gasto admin', costoMinor: '1200.00', vidaUtilMeses: 12, fechaInicioUso: '2026-01-15' });
    alta({
      descripcion: 'Activo con gasto comercialización',
      costoMinor: '600.00',
      vidaUtilMeses: 12,
      fechaInicioUso: '2026-01-15',
      cuentaGastoId: idCuenta('6201')
    });
    const r = depreciarMes(db, { mes: '2026-02', responsable: 'qa' });
    // A mano: 100.00 de admin + 50.00 de comercialización = 150.00.
    expect(r.totalMinor).toBe('150.00');
    const lineas = db
      .prepare('SELECT c.codigo, l.debe_minor AS debe, l.haber_minor AS haber FROM asiento_linea l JOIN cuenta c ON c.id = l.cuenta_id WHERE l.asiento_id = (SELECT id FROM asiento WHERE folio = ?) ORDER BY c.codigo')
      .safeIntegers(true)
      .all(r.asientoFolio) as Array<{ codigo: string; debe: bigint; haber: bigint }>;
    // 1502 al haber por 150.00 (una línea por combinación: 100.00 + 50.00); 6101 y 6201 al debe.
    expect(lineas.filter(l => l.codigo === '1502').reduce((s2, l) => s2 + l.haber, 0n)).toBe(15000n);
    expect(lineas.find(l => l.codigo === '6101')!.debe).toBe(10000n);
    expect(lineas.find(l => l.codigo === '6201')!.debe).toBe(5000n);
    expect(estadoSituacionFinanciera(db, { corte: '2026-02-28' }).cuadra).toBe(true);
  });
});
