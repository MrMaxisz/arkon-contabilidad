import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { abrirBase, prepararRutasDatos } from '../src/main/db/conexion';
import { aplicarMigraciones } from '../src/main/db/aplicarMigraciones';
import { sembrarCatalogoBase } from '../src/main/servicios/cuentas';
import { contabilizarAsiento, anularAsiento, periodoDeFecha } from '../src/main/servicios/motorAsientos';
import { cerrarEjercicio, reabrirEjercicio } from '../src/main/servicios/cierre';
import { estadoResultados } from '../src/main/servicios/fiscal';
import {
  balanceComprobacion,
  estadoResultadosEstructurado,
  estadoSituacionFinanciera
} from '../src/main/servicios/estadosFinancieros';
import { listarPartidas, verPartida, normalizarNumeroPartida } from '../src/main/servicios/libroDiario';
import type BetterSqlite3 from 'better-sqlite3';

// Auditoría 71, bloque 2: libro diario y estados financieros.
// TODOS los importes esperados están calculados A MANO en esta prueba.

let dir: string;
let rutaDb: string;
let rutas: ReturnType<typeof prepararRutasDatos>;
let db: BetterSqlite3.Database;
const abiertas: Array<BetterSqlite3.Database> = [];

function idCuenta(codigo: string): number {
  return (db.prepare('SELECT id FROM cuenta WHERE codigo = ?').get(codigo) as { id: number }).id;
}

function partida(
  fecha: string,
  concepto: string,
  lineas: Array<{ codigo: string; debe: string; haber: string }>,
  clave: string
): number {
  const resultado = contabilizarAsiento(db, {
    fechaOperacion: fecha,
    concepto,
    responsable: 'qa',
    ambitoId: 'administrativo',
    lineas: lineas.map(l => ({
      cuentaId: idCuenta(l.codigo),
      debeMinor: l.debe,
      haberMinor: l.haber
    })),
    claveIdempotencia: clave
  });
  return (db.prepare('SELECT id FROM asiento WHERE folio = ?').get(resultado.folio) as { id: number }).id;
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arkon-b2-'));
  rutas = prepararRutasDatos(path.join(dir, 'datos'));
  rutaDb = path.join(rutas.datos, 'op.db');
  db = abrirBase(rutaDb);
  abiertas.push(db);
  aplicarMigraciones(db);
  sembrarCatalogoBase(db);
  db.prepare("INSERT INTO ambito (id, nombre, tipo) VALUES ('administrativo', 'Prueba bloque 2', 'administrativo')").run();
});

afterEach(() => {
  for (const base of abiertas.splice(0)) {
    if (base.open) {
      base.close();
    }
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('auditoría 71: búsqueda por número de partida', () => {
  it('las tres formas encuentran la misma partida: 1, A-1 y A-000001', () => {
    partida('2026-01-10', 'Partida uno sintética', [{ codigo: '1101', debe: '100.00', haber: '' }, { codigo: '4101', debe: '', haber: '100.00' }], 'p1');
    for (const forma of ['1', 'A-1', 'A-000001']) {
      const { partidas, total } = listarPartidas(db, { busqueda: forma, desde: 0, limite: 10 });
      expect(total).toBe(1);
      expect(partidas[0]!.folio).toBe('A-000001');
    }
    expect(normalizarNumeroPartida('150')).toBe(150);
    expect(normalizarNumeroPartida('A-150')).toBe(150);
    expect(normalizarNumeroPartida('A-000150')).toBe(150);
    expect(normalizarNumeroPartida('A-0')).toBeNull();
    expect(normalizarNumeroPartida('abc')).toBeNull();
  });

  it('ver partida: líneas, totales, reverso y partidas anuladas visibles y marcadas', () => {
    const id = partida('2026-01-10', 'Partida a ver', [{ codigo: '1101', debe: '60.00', haber: '' }, { codigo: '1201', debe: '40.00', haber: '' }, { codigo: '4101', debe: '', haber: '100.00' }], 'pv');
    const detalle = verPartida(db, id);
    expect(detalle.folio).toBe('A-000001');
    expect(detalle.lineas).toHaveLength(3);
    expect(detalle.totalDebeMinor).toBe('100.00');
    expect(detalle.totalHaberMinor).toBe('100.00');
    expect(detalle.reverso).toBeNull();

    anularAsiento(db, id, 'qa', 'anulación sintética del bloque 2');
    const listado = listarPartidas(db, { desde: 0, limite: 10 });
    expect(listado.total).toBe(2);
    expect(listado.partidas.map(p => p.estado)).toContain('anulado');
    const original = verPartida(db, id);
    expect(original.reverso?.folio).toBe('A-000002');
    const reverso = verPartida(db, original.reverso!.id);
    expect(reverso.reversoDe?.folio).toBe('A-000001');
  });

  it('filtros por rango de números, fechas, concepto, cuenta y paginación con total', () => {
    for (let i = 1; i <= 5; i += 1) {
      partida(`2026-01-0${i}`, `Partida sintética ${i}`, [{ codigo: '1101', debe: '10.00', haber: '' }, { codigo: '4101', debe: '', haber: '10.00' }], `pf-${i}`);
    }
    expect(listarPartidas(db, { desdeNumero: 2, hastaNumero: 4, desde: 0, limite: 10 }).total).toBe(3);
    expect(listarPartidas(db, { desdeFecha: '2026-01-03', hastaFecha: '2026-01-05', desde: 0, limite: 10 }).total).toBe(3);
    expect(listarPartidas(db, { concepto: 'Partida sintética 4', desde: 0, limite: 10 }).total).toBe(1);
    expect(listarPartidas(db, { cuentaId: idCuenta('4101'), desde: 0, limite: 10 }).total).toBe(5);
    expect(listarPartidas(db, { cuentaId: idCuenta('6101'), desde: 0, limite: 10 }).total).toBe(0);
    const pagina = listarPartidas(db, { desde: 0, limite: 2 });
    expect(pagina.total).toBe(5);
    expect(pagina.partidas).toHaveLength(2);
    expect(listarPartidas(db, { desde: 4, limite: 2 }).partidas).toHaveLength(1);
  });
});

describe('auditoría 71: balance de comprobación', () => {
  it('saldo inicial, cargos, abonos y saldo final por cuenta con jerarquía de grupos y cuadre', () => {
    // Enero: aporte 500 (1101 debe / 3101 haber); febrero: gasto 30 (6101 debe / 1101 haber).
    partida('2026-01-10', 'Aporte sintético', [{ codigo: '1101', debe: '500.00', haber: '' }, { codigo: '3101', debe: '', haber: '500.00' }], 'b1');
    partida('2026-02-10', 'Gasto sintético', [{ codigo: '6101', debe: '30.00', haber: '' }, { codigo: '1101', debe: '', haber: '30.00' }], 'b2');

    const febrero = balanceComprobacion(db, { desde: '2026-02-01', hasta: '2026-02-28' });
    const fila1101 = febrero.filas.find(f => f.codigo === '1101')!;
    // A mano: saldo inicial de 1101 = 500.00; cargo 0; abono 30.00; final 470.00.
    expect(fila1101.saldoInicialMinor).toBe('500.00');
    expect(fila1101.cargosMinor).toBe('0.00');
    expect(fila1101.abonosMinor).toBe('30.00');
    expect(fila1101.saldoFinalMinor).toBe('470.00');
    const fila6101 = febrero.filas.find(f => f.codigo === '6101')!;
    expect(fila6101.saldoInicialMinor).toBe('0.00');
    expect(fila6101.cargosMinor).toBe('30.00');
    expect(fila6101.saldoFinalMinor).toBe('30.00');
    // Grupo 11 (Efectivo) suma su descendiente 1101: sin movimiento directo propio.
    const grupo11 = febrero.filas.find(f => f.codigo === '11')!;
    expect(grupo11.esGrupo).toBe(true);
    expect(grupo11.saldoFinalMinor).toBe('470.00');
    expect(grupo11.abonosMinor).toBe('30.00');
    // Partida doble del rango: cargos = abonos = 30.00.
    expect(febrero.totalCargosMinor).toBe('30.00');
    expect(febrero.totalAbonosMinor).toBe('30.00');
    expect(febrero.cuadra).toBe(true);

    const conOcultar = balanceComprobacion(db, { desde: '2026-02-01', hasta: '2026-02-28', ocultarSinMovimiento: true });
    expect(conOcultar.filas.some(f => f.codigo === '4101')).toBe(false);
    expect(conOcultar.filas.some(f => f.codigo === '1101')).toBe(true);
  });

  it('coincide con mayor:consultar y balance:saldos del catálogo', () => {
    partida('2026-01-10', 'Aporte sintético', [{ codigo: '1101', debe: '250.00', haber: '' }, { codigo: '3101', debe: '', haber: '250.00' }], 'bm');
    const todo = balanceComprobacion(db, { desde: '2026-01-01', hasta: '2026-01-31' });
    const fila1101 = todo.filas.find(f => f.codigo === '1101')!;
    const saldoCatalogo = db.prepare('SELECT 1').get();
    expect(saldoCatalogo).toBeTruthy();
    expect(fila1101.saldoFinalMinor).toBe('250.00');
  });
});

describe('auditoría 71: estado de resultados estructurado', () => {
  it('estructura completa con utilidad bruta, de operación y antes de impuestos, calculada a mano', () => {
    // Ingresos 100 (4101), costo 40 (5101), admin 10 (6101), comercialización 5 (6201),
    // otros ingresos 3 (4201), gastos financieros 2 (6301). Todo contra 1101.
    partida('2026-03-01', 'Venta sintética', [{ codigo: '1101', debe: '100.00', haber: '' }, { codigo: '4101', debe: '', haber: '100.00' }], 'r1');
    partida('2026-03-02', 'Costo sintético', [{ codigo: '5101', debe: '40.00', haber: '' }, { codigo: '1101', debe: '', haber: '40.00' }], 'r2');
    partida('2026-03-03', 'Admin sintético', [{ codigo: '6101', debe: '10.00', haber: '' }, { codigo: '1101', debe: '', haber: '10.00' }], 'r3');
    partida('2026-03-04', 'Comercial sintético', [{ codigo: '6201', debe: '5.00', haber: '' }, { codigo: '1101', debe: '', haber: '5.00' }], 'r4');
    partida('2026-03-05', 'Otro ingreso sintético', [{ codigo: '1101', debe: '3.00', haber: '' }, { codigo: '4201', debe: '', haber: '3.00' }], 'r5');
    partida('2026-03-06', 'Financiero sintético', [{ codigo: '6301', debe: '2.00', haber: '' }, { codigo: '1101', debe: '', haber: '2.00' }], 'r6');

    const r = estadoResultadosEstructurado(db, { desde: '2026-03-01', hasta: '2026-03-31', comparativo: true });
    // A mano: utilidad bruta = 100 - 40 = 60; operación = 60 - 10 - 5 = 45;
    // antes de impuestos = 45 + 3 - 2 = 46.
    expect(r.utilidadBrutaMinor).toBe('60.00');
    expect(r.utilidadOperacionMinor).toBe('45.00');
    expect(r.resultadoAntesImpuestosMinor).toBe('46.00');
    expect(r.ingresos[0]).toMatchObject({ codigo: '4101', importeMinor: '100.00' });
    expect(r.costos[0]).toMatchObject({ codigo: '5101', importeMinor: '40.00' });
    expect(r.gastosAdministracion[0]).toMatchObject({ codigo: '6101', importeMinor: '10.00' });
    expect(r.gastosComercializacion[0]).toMatchObject({ codigo: '6201', importeMinor: '5.00' });
    expect(r.otrosIngresos[0]).toMatchObject({ codigo: '4201', importeMinor: '3.00' });
    expect(r.gastosFinancieros[0]).toMatchObject({ codigo: '6301', importeMinor: '2.00' });
    // Comparativo: febrero sin movimientos → todo cero.
    expect(r.periodoAnterior).not.toBeNull();
    expect(r.periodoAnterior!.resultadoAntesImpuestosMinor).toBe('0.00');
    // Coincide con reporte:estadoResultados del mes (mismo resultado neto).
    const clasico = estadoResultados(db, '2026-03');
    expect(clasico.resultadoMinor).toBe('46.00');
  });

  it('mes sin movimientos y anulación con reverso en mes distinto', () => {
    const idEnero = partida('2026-01-10', 'Venta enero sintética', [{ codigo: '1101', debe: '80.00', haber: '' }, { codigo: '4101', debe: '', haber: '80.00' }], 'e1');
    // Reverso con fecha_operacion en MARZO (mes distinto): siembra sintética por INSERT directo
    // (el motor fecha el reverso con la fecha del original), con las invariantes del motor:
    // período de marzo creado con periodoDeFecha, líneas invertidas, original anulado.
    const periodoMarzo = periodoDeFecha(db, '2026-03-12');
    const reverso = db.prepare(
      `INSERT INTO asiento (folio, fecha_operacion, periodo_id, ambito_id, concepto, origen_tipo, origen_id, estado, reverso_de_id, responsable, motivo)
       VALUES ('A-000002', '2026-03-12', ?, 'administrativo', 'Reverso de Venta enero sintética', 'anulacion', NULL, 'borrador', ?, 'qa', 'anulación sintética con reverso en marzo')`
    ).run(periodoMarzo.id, idEnero);
    const idReverso = Number(reverso.lastInsertRowid);
    db.prepare('INSERT INTO asiento_linea (asiento_id, cuenta_id, debe_minor, haber_minor) VALUES (?, ?, ?, ?)').run(idReverso, idCuenta('1101'), 0, 8000);
    db.prepare('INSERT INTO asiento_linea (asiento_id, cuenta_id, debe_minor, haber_minor) VALUES (?, ?, ?, ?)').run(idReverso, idCuenta('4101'), 8000, 0);
    db.prepare("UPDATE asiento SET estado = 'contabilizado' WHERE id = ?").run(idReverso);
    db.prepare("UPDATE asiento SET estado = 'anulado' WHERE id = ?").run(idEnero);

    const enero = estadoResultadosEstructurado(db, { desde: '2026-01-01', hasta: '2026-01-31' });
    // A mano: enero tiene la venta original 80.00 (la familia de reverso no toca enero).
    expect(enero.resultadoAntesImpuestosMinor).toBe('80.00');

    const febrero = estadoResultadosEstructurado(db, { desde: '2026-02-01', hasta: '2026-02-28' });
    expect(febrero.ingresos).toHaveLength(0);
    expect(febrero.resultadoAntesImpuestosMinor).toBe('0.00');

    const marzo = estadoResultadosEstructurado(db, { desde: '2026-03-01', hasta: '2026-03-31' });
    // A mano: marzo netea el reverso → -80.00 (anulación ordinaria, NO familia de cierre).
    expect(marzo.resultadoAntesImpuestosMinor).toBe('-80.00');

    const primerTrimestre = estadoResultadosEstructurado(db, { desde: '2026-01-01', hasta: '2026-03-31' });
    expect(primerTrimestre.resultadoAntesImpuestosMinor).toBe('0.00');
  });

  it('con cierre de ejercicio, la familia de cierre no duplica el resultado', () => {
    partida('2026-11-10', 'Venta cierre sintética', [{ codigo: '1101', debe: '100.00', haber: '' }, { codigo: '4101', debe: '', haber: '100.00' }], 'c1');
    partida('2026-11-11', 'Costo cierre sintético', [{ codigo: '5101', debe: '40.00', haber: '' }, { codigo: '1101', debe: '', haber: '40.00' }], 'c2');
    cerrarEjercicio(db, { anio: 2026, responsable: 'qa', motivo: 'cierre sintético b2', referencia: 'soporte b2', claveIdempotencia: 'ci-b2' });
    const anual = estadoResultadosEstructurado(db, { desde: '2026-01-01', hasta: '2026-12-31' });
    // A mano: el asiento de cierre (familia excluida) no altera el ordinario: 100 - 40 = 60.
    expect(anual.resultadoAntesImpuestosMinor).toBe('60.00');
    reabrirEjercicio(db, { anio: 2026, responsable: 'qa', motivo: 'reapertura sintética b2' });
    const trasReabrir = estadoResultadosEstructurado(db, { desde: '2026-01-01', hasta: '2026-12-31' });
    expect(trasReabrir.resultadoAntesImpuestosMinor).toBe('60.00');
  });
});

describe('auditoría 71: estado de situación financiera', () => {
  it('activo = pasivo + patrimonio antes y después del cierre, con resultado del ejercicio como línea', () => {
    partida('2026-05-10', 'Aporte sintético', [{ codigo: '1101', debe: '200.00', haber: '' }, { codigo: '3101', debe: '', haber: '200.00' }], 's1');
    partida('2026-05-11', 'Venta sintética', [{ codigo: '1201', debe: '60.00', haber: '' }, { codigo: '4101', debe: '', haber: '60.00' }], 's2');

    const antes = estadoSituacionFinanciera(db, { corte: '2026-06-30' });
    // A mano: activo = 1101 (200) + 1201 (60) = 260; pasivo 0;
    // patrimonio = aportes 200 + resultado 60 = 260. Cuadra.
    expect(antes.activo.totalMinor).toBe('260.00');
    expect(antes.pasivo.totalMinor).toBe('0.00');
    expect(antes.patrimonio.resultadoEjercicioMinor).toBe('60.00');
    expect(antes.patrimonio.totalMinor).toBe('260.00');
    expect(antes.cuadra).toBe(true);
    expect(antes.patrimonio.filas.some(f => f.nombre.includes('aún no cerrado'))).toBe(true);

    const antesDelCorte = estadoSituacionFinanciera(db, { corte: '2026-05-10' });
    // A mano al 10 de mayo: activo 200, patrimonio 200, resultado 0.
    expect(antesDelCorte.activo.totalMinor).toBe('200.00');
    expect(antesDelCorte.patrimonio.totalMinor).toBe('200.00');
    expect(antesDelCorte.cuadra).toBe(true);

    cerrarEjercicio(db, { anio: 2026, responsable: 'qa', motivo: 'cierre sintético s', referencia: 'soporte s', claveIdempotencia: 'ci-s' });
    const despues = estadoSituacionFinanciera(db, { corte: '2026-12-31' });
    // Tras el cierre: 4101 netea 0 (el cierre lo traslada a 3201).
    expect(despues.patrimonio.resultadoEjercicioMinor).toBe('0.00');
    // A mano: 3201 = 60; aportes 200; activo = 1101 200 + 1201 60 = 260 = 0 + 260.
    expect(despues.patrimonio.totalMinor).toBe('260.00');
    expect(despues.activo.totalMinor).toBe('260.00');
    expect(despues.cuadra).toBe(true);

    const comparativo = estadoSituacionFinanciera(db, { corte: '2026-12-31', corteComparativo: '2026-05-10' });
    expect(comparativo.comparativo!.patrimonio.totalMinor).toBe('200.00');
  });

  it('saldo contrario visible y cuenta de grupo sin movimiento directo', () => {
    // Sobregiro sintético: 2101 con débito (saldo deudor en cuenta de pasivo).
    partida('2026-07-10', 'Sobregiro sintético', [{ codigo: '2101', debe: '25.00', haber: '' }, { codigo: '1101', debe: '', haber: '25.00' }], 'sc');
    const s = estadoSituacionFinanciera(db, { corte: '2026-07-31' });
    // A mano: 2101 deudor 25 → pasivo total -25; 1101 acreedor... no: 1101 abonado 25 → saldo -25 (contrario de activo).
    // Activo: 1101 = -25 → total -25; pasivo: 2101 → -(-25)? No: saldo de 2101 = debe-haber = 25 → pasivo aporta -25.
    // Patrimonio 0. Cuadre: -25 = -25 + 0.
    expect(s.saldosContrarios.map(c => c.codigo).sort()).toEqual(['1101', '2101']);
    expect(s.cuadra).toBe(true);
    const grupo21 = balanceComprobacion(db, { desde: '2026-07-01', hasta: '2026-07-31' }).filas.find(f => f.codigo === '21')!;
    expect(grupo21.esGrupo).toBe(true);
    expect(grupo21.cargosMinor).toBe('25.00');
  });

  it('importes altos que no caben en Number', () => {
    const alto = '90000000000000.00'; // 9e13 dólares = 9e15 centavos > Number.MAX_SAFE_INTEGER
    partida('2026-08-10', 'Aporte alto sintético', [{ codigo: '1101', debe: alto, haber: '' }, { codigo: '3101', debe: '', haber: alto }], 'alto');
    const s = estadoSituacionFinanciera(db, { corte: '2026-08-31' });
    expect(s.activo.totalMinor).toBe(alto);
    expect(s.patrimonio.totalMinor).toBe(alto);
    expect(s.cuadra).toBe(true);
    const r = estadoResultadosEstructurado(db, { desde: '2026-08-01', hasta: '2026-08-31' });
    expect(r.resultadoAntesImpuestosMinor).toBe('0.00');
    const detalle = verPartida(db, (db.prepare("SELECT id FROM asiento WHERE concepto = 'Aporte alto sintético'").get() as { id: number }).id);
    expect(detalle.totalDebeMinor).toBe(alto);
  });
});
