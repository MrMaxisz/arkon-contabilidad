import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { entornoPrueba, idCuenta, type EntornoPrueba } from './utilidades';
import { migraciones } from '../src/main/db/migraciones';
import { aplicarMigraciones } from '../src/main/db/aplicarMigraciones';
import { sembrarCatalogoBase } from '../src/main/servicios/cuentas';
import { anularAsiento, cerrarPeriodo, contabilizarAsiento, periodoDeFecha } from '../src/main/servicios/motorAsientos';
import { estadoResultadosEstructurado, estadoSituacionFinanciera } from '../src/main/servicios/estadosFinancieros';
import {
  anularBajaActivoFijo, anularUltimoLote, darAltaActivoFijo, darBajaActivoFijo,
  depreciarMes, previsualizarDepreciacion
} from '../src/main/servicios/activosFijos';

let entorno: EntornoPrueba;
let db: Database.Database;
const cuenta = (codigo: string): number => idCuenta(db, codigo);

beforeEach(() => { entorno = entornoPrueba(); db = entorno.db; });
afterEach(() => entorno.limpiar());

function alta(extra: Partial<Parameters<typeof darAltaActivoFijo>[1]> = {}) {
  return darAltaActivoFijo(db, {
    descripcion: 'Equipo sintético 3C', categoria: 'Equipos', ubicacion: 'Bodega sintética', responsable: 'qa',
    fechaAdquisicion: '2026-01-10', fechaInicioUso: '2026-01-31',
    costoMinor: '1200.00', residualMinor: '0.00', vidaUtilMeses: 12,
    cuentaActivoId: cuenta('1501'), cuentaDepreciacionId: cuenta('1502'),
    cuentaGastoId: cuenta('6101'), cuentaContrapartidaId: cuenta('3101'), ...extra
  });
}

function venta(activoId: number, extra: Partial<Parameters<typeof darBajaActivoFijo>[1]> = {}) {
  return darBajaActivoFijo(db, {
    activoId, tipo: 'venta', fechaOperacion: '2026-07-15', importeMinor: '900.00',
    cuentaCobroId: cuenta('1101'), responsable: 'qa', motivo: 'Venta sintética 3C', ...extra
  });
}

function situacion(corte: string, activo: string, resultado: string, patrimonio: string) {
  const s = estadoSituacionFinanciera(db, { corte });
  expect(s.activo.totalMinor).toBe(activo);
  expect(s.pasivo.totalMinor).toBe('0.00');
  expect(s.patrimonio.resultadoEjercicioMinor).toBe(resultado);
  expect(s.patrimonio.totalMinor).toBe(patrimonio);
  expect(s.cuadra).toBe(true);
}

function saldo(codigo: string): bigint {
  return (db.prepare(`SELECT COALESCE(SUM(l.debe_minor - l.haber_minor), 0) AS total
    FROM asiento_linea l JOIN asiento a ON a.id = l.asiento_id
    WHERE l.cuenta_id = ? AND a.ambito_id = 'administrativo' AND a.estado IN ('contabilizado','anulado')`)
    .safeIntegers(true).get(cuenta(codigo)) as { total: bigint }).total;
}

function estadoPersistido() {
  return ['asiento', 'asiento_linea', 'activo_fijo', 'depreciacion_lote', 'depreciacion_detalle',
    'baja_activo_fijo', 'bitacora_evento', 'periodo'].map(tabla =>
    db.prepare(`SELECT * FROM ${tabla} ORDER BY id`).safeIntegers(true).all());
}

describe('3C: baja y venta con cifras calculadas a mano', () => {
  it('venta a medio camino: seis cuotas de 100.00, libros 600.00, cobro 900.00, ganancia 300.00', () => {
    situacion('2026-01-01', '0.00', '0.00', '0.00');
    const activo = alta();
    situacion('2026-01-31', '1200.00', '0.00', '1200.00');
    depreciarMes(db, { mes: '2026-03', responsable: 'qa' });
    situacion('2026-03-31', '1000.00', '-200.00', '1000.00');
    const baja = venta(activo.id);
    expect(baja).toMatchObject({ depreciacionPendienteMinor: '400.00', acumuladaMinor: '600.00',
      valorLibrosMinor: '600.00', resultadoMinor: '300.00' });
    expect(saldo('1501')).toBe(0n);
    expect(saldo('1502')).toBe(0n);
    expect(saldo('6101')).toBe(60000n);
    expect(saldo('1101')).toBe(90000n);
    expect(saldo('4202')).toBe(-30000n);
    expect(db.prepare('SELECT estado FROM activo_fijo WHERE id = ?').get(activo.id)).toEqual({ estado: 'vendido' });
    expect(db.prepare('SELECT mes FROM depreciacion_detalle ORDER BY mes').all()).toEqual(
      ['02', '03', '04', '05', '06', '07'].map(m => ({ mes: `2026-${m}` })));
    expect(db.prepare('SELECT fecha_operacion FROM asiento WHERE id = ?').get(baja.asientoId))
      .toEqual({ fecha_operacion: '2026-07-15' });
    const evento = db.prepare("SELECT actor, detalle FROM bitacora_evento WHERE tipo = 'activo_fijo_baja'")
      .get() as { actor: string; detalle: string };
    expect(evento.actor).toBe('qa');
    expect(JSON.parse(evento.detalle)).toMatchObject({ bajaId: baja.bajaId, resultadoMinor: '300.00' });
    expect(estadoResultadosEstructurado(db, { desde: '2026-01-01', hasta: '2026-07-31' }).otrosIngresos)
      .toContainEqual({ codigo: '4202', nombre: 'Ganancia en venta de activos fijos', importeMinor: '300.00' });
    situacion('2026-07-14', '1000.00', '-200.00', '1000.00');
    situacion('2026-07-15', '900.00', '-300.00', '900.00');
    expect(previsualizarDepreciacion(db, '2026-08').filas).toEqual([]);
  });

  it('baja con pérdida: febrero a abril 300.00, libros y pérdida 900.00, activos netos cero', () => {
    const activo = alta();
    situacion('2026-01-31', '1200.00', '0.00', '1200.00');
    const baja = venta(activo.id, { tipo: 'baja', fechaOperacion: '2026-04-10', importeMinor: '0' });
    expect(baja).toMatchObject({ depreciacionPendienteMinor: '300.00', acumuladaMinor: '300.00',
      valorLibrosMinor: '900.00', resultadoMinor: '-900.00' });
    expect(saldo('1501')).toBe(0n);
    expect(saldo('1502')).toBe(0n);
    expect(saldo('6402')).toBe(90000n);
    expect(db.prepare('SELECT estado FROM activo_fijo WHERE id = ?').get(activo.id)).toEqual({ estado: 'dado_de_baja' });
    const resultados = estadoResultadosEstructurado(db, { desde: '2026-01-01', hasta: '2026-04-30' });
    expect(resultados.otrosGastos).toContainEqual({ codigo: '6402', nombre: 'Pérdida en baja o venta de activos fijos', importeMinor: '900.00' });
    expect(resultados.gastosFinancieros).toEqual([]);
    situacion('2026-04-10', '0.00', '-1200.00', '0.00');
    anularBajaActivoFijo(db, { bajaId: baja.bajaId, responsable: 'qa', motivo: 'Reverso sintético' });
    situacion('2026-04-10', '1200.00', '0.00', '1200.00');
  });

  it('anulación restaura el activo, conserva cuotas previas y permite rehacer sin duplicar', () => {
    const activo = alta();
    depreciarMes(db, { mes: '2026-03', responsable: 'qa' });
    situacion('2026-03-31', '1000.00', '-200.00', '1000.00');
    const baja = venta(activo.id);
    situacion('2026-07-15', '900.00', '-300.00', '900.00');
    const reverso = anularBajaActivoFijo(db, { bajaId: baja.bajaId, responsable: 'revisor', motivo: 'Corregir venta sintética' });
    expect(db.prepare('SELECT estado FROM asiento WHERE id = ?').get(baja.asientoId)).toEqual({ estado: 'anulado' });
    expect(db.prepare('SELECT folio FROM asiento WHERE reverso_de_id = ?').get(baja.asientoId))
      .toEqual({ folio: reverso.reversoFolio });
    expect(db.prepare('SELECT estado FROM activo_fijo WHERE id = ?').get(activo.id)).toEqual({ estado: 'activo' });
    expect(db.prepare('SELECT mes FROM depreciacion_detalle ORDER BY mes').all())
      .toEqual([{ mes: '2026-02' }, { mes: '2026-03' }]);
    expect(previsualizarDepreciacion(db, '2026-07').totalMinor).toBe('400.00');
    expect(db.prepare("SELECT actor FROM bitacora_evento WHERE tipo = 'activo_fijo_baja_anulada'").get())
      .toEqual({ actor: 'revisor' });
    situacion('2026-07-15', '1000.00', '-200.00', '1000.00');
    expect(() => anularBajaActivoFijo(db, { bajaId: baja.bajaId, responsable: 'qa', motivo: 'Repetir' })).toThrow(/vigente/);
    const nueva = venta(activo.id);
    expect(nueva.bajaId).not.toBe(baja.bajaId);
    expect(nueva.resultadoMinor).toBe('300.00');
    situacion('2026-07-15', '900.00', '-300.00', '900.00');
  });

  it('la baja solo deprecia su activo y los movimientos de otro activo no impiden el reverso', () => {
    const primero = alta();
    const segundo = alta({ costoMinor: '600.00' });
    situacion('2026-01-31', '1800.00', '0.00', '1800.00');
    const baja = venta(primero.id);
    situacion('2026-07-15', '1500.00', '-300.00', '1500.00');
    expect(previsualizarDepreciacion(db, '2026-07').filas.every(f => f.activoId === segundo.id)).toBe(true);
    depreciarMes(db, { mes: '2026-07', responsable: 'qa' }); // segundo: 6 x 50 = 300.
    situacion('2026-07-31', '1200.00', '-600.00', '1200.00');
    anularBajaActivoFijo(db, { bajaId: baja.bajaId, responsable: 'qa', motivo: 'Solo primer activo' });
    situacion('2026-07-31', '1500.00', '-300.00', '1500.00');
  });

  it('rechaza el reverso si hay un movimiento posterior del mismo activo', () => {
    const activo = alta();
    const baja = venta(activo.id);
    situacion('2026-07-15', '900.00', '-300.00', '900.00');
    contabilizarAsiento(db, {
      fechaOperacion: '2026-08-01', concepto: 'Ajuste posterior sintético del activo', responsable: 'qa',
      ambitoId: 'administrativo', origenTipo: 'activo_fijo', origenId: String(activo.id),
      lineas: [{ cuentaId: cuenta('6101'), debeMinor: '1.00', haberMinor: '' },
        { cuentaId: cuenta('1101'), debeMinor: '', haberMinor: '1.00' }]
    });
    situacion('2026-08-01', '899.00', '-301.00', '899.00');
    const antes = estadoPersistido();
    expect(() => anularBajaActivoFijo(db, { bajaId: baja.bajaId, responsable: 'qa', motivo: 'No permitido' }))
      .toThrow(/movimientos posteriores/);
    expect(estadoPersistido()).toEqual(antes);
  });

  it('no permite anular por separado el asiento de baja ni los lotes usados por una baja vigente', () => {
    const activo = alta();
    depreciarMes(db, { mes: '2026-07', responsable: 'qa' });
    const baja = venta(activo.id, { fechaOperacion: '2026-08-01' });
    expect(() => anularAsiento(db, baja.asientoId, 'qa', 'Ruta genérica')).toThrow(/documento/);
    expect(() => anularUltimoLote(db, { responsable: 'qa', motivo: 'Lote de baja' })).toThrow(/baja/);
    anularBajaActivoFijo(db, { bajaId: baja.bajaId, responsable: 'qa', motivo: 'Restaurar activo' });
    // Se conservan las seis cuotas hasta julio; el lote pendiente de agosto se liberó.
    expect(() => anularUltimoLote(db, { responsable: 'qa', motivo: 'Ahora sí' })).not.toThrow();
    situacion('2026-08-01', '1200.00', '0.00', '1200.00');
  });

  it('un fallo de bitácora revierte asiento, cuotas, baja y estado; también al anular', () => {
    const activo = alta();
    const antes = estadoPersistido();
    db.exec(`CREATE TRIGGER fallo_baja BEFORE INSERT ON bitacora_evento
      WHEN NEW.tipo = 'activo_fijo_baja' BEGIN SELECT RAISE(ABORT, 'fallo sintético baja'); END`);
    expect(() => venta(activo.id)).toThrow(/fallo sintético baja/);
    expect(estadoPersistido()).toEqual(antes);
    situacion('2026-07-15', '1200.00', '0.00', '1200.00');
    db.exec('DROP TRIGGER fallo_baja');
    const baja = venta(activo.id);
    const antesReverso = estadoPersistido();
    db.exec(`CREATE TRIGGER fallo_reverso BEFORE INSERT ON bitacora_evento
      WHEN NEW.tipo = 'activo_fijo_baja_anulada' BEGIN SELECT RAISE(ABORT, 'fallo sintético reverso'); END`);
    expect(() => anularBajaActivoFijo(db, { bajaId: baja.bajaId, responsable: 'qa', motivo: 'Prueba rollback' }))
      .toThrow(/fallo sintético reverso/);
    expect(estadoPersistido()).toEqual(antesReverso);
    situacion('2026-07-15', '900.00', '-300.00', '900.00');
  });

  it('respeta períodos cerrados al vender y anular y rechaza depreciación posterior a la baja', () => {
    const activo = alta();
    const periodo = periodoDeFecha(db, '2026-07-15');
    cerrarPeriodo(db, periodo.id, 'qa', 'Cierre sintético');
    const antes = estadoPersistido();
    expect(() => venta(activo.id)).toThrow(/cerrado/);
    expect(estadoPersistido()).toEqual(antes);
    // La depreciación existente al fin de agosto impide una venta retroactiva de julio.
    depreciarMes(db, { mes: '2026-08', responsable: 'qa' });
    expect(() => venta(activo.id)).toThrow(/posterior/);
    const baja = venta(activo.id, { fechaOperacion: '2026-09-01' });
    cerrarPeriodo(db, periodoDeFecha(db, '2026-09-01').id, 'qa', 'Cierre septiembre');
    const antesReverso = estadoPersistido();
    expect(() => anularBajaActivoFijo(db, { bajaId: baja.bajaId, responsable: 'qa', motivo: 'Reverso cerrado' }))
      .toThrow(/cerrado/);
    expect(estadoPersistido()).toEqual(antesReverso);
    situacion('2026-09-01', '900.00', '-300.00', '900.00');
  });

  it('residual y último redondeo: 1000.00 menos residual 100.00 a tres meses, baja neta 100.00', () => {
    const activo = alta({ costoMinor: '1000.00', residualMinor: '100.00', vidaUtilMeses: 3 });
    const baja = venta(activo.id, { tipo: 'baja', fechaOperacion: '2026-06-15', importeMinor: '0' });
    expect(baja).toMatchObject({ acumuladaMinor: '900.00', valorLibrosMinor: '100.00', resultadoMinor: '-100.00' });
    situacion('2026-06-15', '0.00', '-1000.00', '0.00');
    anularBajaActivoFijo(db, { bajaId: baja.bajaId, responsable: 'qa', motivo: 'Deshacer baja con residual' });
    situacion('2026-06-15', '1000.00', '0.00', '1000.00');
    const redondeo = alta({ costoMinor: '1000.00', vidaUtilMeses: 3 });
    const ventaFinal = venta(redondeo.id, { fechaOperacion: '2026-04-15', importeMinor: '10.00' });
    expect(ventaFinal).toMatchObject({ acumuladaMinor: '1000.00', valorLibrosMinor: '0.00', resultadoMinor: '10.00' });
    expect(db.prepare('SELECT cuota_minor AS cuota FROM depreciacion_detalle WHERE activo_fijo_id = ? ORDER BY mes')
      .safeIntegers(true).all(redondeo.id)).toEqual([{ cuota: 33333n }, { cuota: 33333n }, { cuota: 33334n }]);
    situacion('2026-04-15', '1010.00', '-990.00', '1010.00');
  });

  it('el reverso conserva centavos por encima del límite de precisión de Number', () => {
    const activo = alta({ costoMinor: '90071992547409.93' });
    const baja = venta(activo.id, { fechaOperacion: '2026-01-20', importeMinor: '90071992547409.94' });
    expect(baja.resultadoMinor).toBe('0.01');
    situacion('2026-01-20', '90071992547409.94', '0.01', '90071992547409.94');
    anularBajaActivoFijo(db, { bajaId: baja.bajaId, responsable: 'qa', motivo: 'Reverso exacto' });
    expect(saldo('1101')).toBe(0n);
    expect(saldo('1501')).toBe(9007199254740993n);
    situacion('2026-01-20', '90071992547409.93', '0.00', '90071992547409.93');
  });

  it('valida fecha, responsable, motivo, importe, cuenta de cobro, ámbito y doble baja sin efectos parciales', () => {
    const activo = alta();
    const antes = estadoPersistido();
    for (const extra of [
      { fechaOperacion: '2026-01-01' }, { responsable: '' }, { motivo: '' },
      { importeMinor: '-1.00' }, { tipo: 'baja' as const },
      { cuentaCobroId: cuenta('1501') }, { cuentaCobroId: cuenta('6101') }, { cuentaCobroId: undefined }
    ]) {
      expect(() => venta(activo.id, extra)).toThrow();
      expect(estadoPersistido()).toEqual(antes);
    }
    db.prepare("INSERT INTO ambito (id, nombre, tipo) VALUES ('juridico', 'Ámbito sintético', 'juridico')").run();
    db.prepare("UPDATE activo_fijo SET ambito_id = 'juridico' WHERE id = ?").run(activo.id);
    expect(() => venta(activo.id)).toThrow(/administrativo/);
    db.prepare("UPDATE activo_fijo SET ambito_id = 'administrativo' WHERE id = ?").run(activo.id);
    venta(activo.id);
    const despues = estadoPersistido();
    expect(() => venta(activo.id)).toThrow(/ya está de baja/);
    expect(estadoPersistido()).toEqual(despues);
    situacion('2026-07-15', '900.00', '-300.00', '900.00');
  });

  it('v20 añade las cuentas bajo 42 y 64 tanto en instalación nueva como al migrar v19', () => {
    const cuentasResultado = (base: Database.Database) => base.prepare(`SELECT c.codigo, c.tipo, p.codigo AS padre
      FROM cuenta c JOIN cuenta p ON p.id = c.padre_id WHERE c.codigo IN ('4202','6402') ORDER BY c.codigo`).all();
    const esperado = [{ codigo: '4202', tipo: 'ingreso', padre: '42' }, { codigo: '6402', tipo: 'gasto', padre: '64' }];
    expect(cuentasResultado(db)).toEqual(esperado);
    const anterior = new Database(':memory:');
    try {
      anterior.pragma('foreign_keys = ON');
      anterior.exec('CREATE TABLE _migracion (version INTEGER PRIMARY KEY, nombre TEXT NOT NULL)');
      for (const m of migraciones.filter(m => m.version < 20)) {
        anterior.exec(m.sql);
        anterior.prepare('INSERT INTO _migracion VALUES (?, ?)').run(m.version, m.nombre);
      }
      sembrarCatalogoBase(anterior);
      anterior.prepare("DELETE FROM cuenta WHERE codigo IN ('4202','6402','64')").run();
      aplicarMigraciones(anterior);
      expect(cuentasResultado(anterior)).toEqual(esperado);
      expect(anterior.prepare("SELECT p.codigo FROM cuenta c JOIN cuenta p ON p.id = c.padre_id WHERE c.codigo = '64'").get())
        .toEqual({ codigo: '6' });
    } finally { anterior.close(); }
  });
});
