import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { entornoPrueba, idCuenta, type EntornoPrueba } from './utilidades';
import {
  contabilizarAsiento,
  anularAsiento,
  listarAsientos,
  mayorDeCuenta,
  cerrarPeriodo,
  reabrirPeriodo,
  periodoDeFecha,
  ErrorContable
} from '../src/main/servicios/motorAsientos';
import { balanceResumen } from '../src/main/servicios/estadosFinancieros';

let ent: EntornoPrueba;

beforeEach(() => {
  ent = entornoPrueba();
});

afterEach(() => {
  ent.limpiar();
});

function entradaBase(overrides: Partial<Parameters<typeof contabilizarAsiento>[1]> = {}) {
  return {
    fechaOperacion: '2026-01-10',
    concepto: 'Aporte inicial sintético',
    responsable: 'prueba',
    ambitoId: 'administrativo',
    lineas: [
      { cuentaId: idCuenta(ent.db, '1101'), debeMinor: '100.00', haberMinor: '' },
      { cuentaId: idCuenta(ent.db, '3101'), debeMinor: '', haberMinor: '100.00' }
    ],
    ...overrides
  };
}

describe('motor de partida doble', () => {
  it('contabiliza un asiento cuadrado y lo refleja en el mayor', () => {
    const r = contabilizarAsiento(ent.db, entradaBase());
    expect(r.duplicado).toBe(false);
    expect(r.folio).toBe('A-000001');
    const mayor = mayorDeCuenta(ent.db, idCuenta(ent.db, '1101'));
    expect(mayor.movimientos).toHaveLength(1);
    expect(mayor.saldoMinor).toBe('100.00');
    expect(balanceResumen(ent.db).cuadra).toBe(true);
  });

  it('rechaza un asiento descuadrado antes de escribir algo', () => {
    expect(() =>
      contabilizarAsiento(ent.db, entradaBase({
        lineas: [
          { cuentaId: idCuenta(ent.db, '1101'), debeMinor: '100.00', haberMinor: '' },
          { cuentaId: idCuenta(ent.db, '3101'), debeMinor: '', haberMinor: '90.00' }
        ]
      }))
    ).toThrow(ErrorContable);
    expect(listarAsientos(ent.db)).toHaveLength(0);
  });

  it('rechaza líneas con importe en dos lados, sin importe o en cuenta de grupo', () => {
    expect(() =>
      contabilizarAsiento(ent.db, entradaBase({
        lineas: [
          { cuentaId: idCuenta(ent.db, '1101'), debeMinor: '10.00', haberMinor: '10.00' },
          { cuentaId: idCuenta(ent.db, '3101'), debeMinor: '', haberMinor: '20.00' }
        ]
      }))
    ).toThrow(ErrorContable);
    expect(() =>
      contabilizarAsiento(ent.db, entradaBase({
        lineas: [
          { cuentaId: idCuenta(ent.db, '1101'), debeMinor: '0.00', haberMinor: '' },
          { cuentaId: idCuenta(ent.db, '3101'), debeMinor: '', haberMinor: '10.00' }
        ]
      }))
    ).toThrow(ErrorContable);
    expect(() =>
      contabilizarAsiento(ent.db, entradaBase({
        lineas: [
          { cuentaId: idCuenta(ent.db, '11'), debeMinor: '10.00', haberMinor: '' },
          { cuentaId: idCuenta(ent.db, '3101'), debeMinor: '', haberMinor: '10.00' }
        ]
      }))
    ).toThrow(/agrupación/);
    expect(listarAsientos(ent.db)).toHaveLength(0);
  });

  it('idempotencia: la misma clave devuelve el mismo asiento sin duplicar', () => {
    const clave = 'evento-001';
    const a = contabilizarAsiento(ent.db, entradaBase({ claveIdempotencia: clave }));
    const b = contabilizarAsiento(ent.db, entradaBase({ claveIdempotencia: clave }));
    expect(b.duplicado).toBe(true);
    expect(b.asientoId).toBe(a.asientoId);
    expect(listarAsientos(ent.db)).toHaveLength(1);
  });

  it('atomicidad: un fallo dentro de la transacción no deja asientos ni líneas parciales', () => {
    expect(() =>
      contabilizarAsiento(ent.db, entradaBase({
        lineas: [
          { cuentaId: idCuenta(ent.db, '1101'), debeMinor: '50.00', haberMinor: '' },
          { cuentaId: 99999, debeMinor: '', haberMinor: '50.00' }
        ]
      }))
    ).toThrow(/No existe la cuenta/);
    const n = (ent.db.prepare('SELECT COUNT(*) AS n FROM asiento').get() as { n: number }).n;
    const nl = (ent.db.prepare('SELECT COUNT(*) AS n FROM asiento_linea').get() as { n: number }).n;
    expect(n).toBe(0);
    expect(nl).toBe(0);
  });

  it('período cerrado rechaza nuevos asientos; la reapertura exige motivo y se registra', () => {
    contabilizarAsiento(ent.db, entradaBase());
    const periodo = periodoDeFecha(ent.db, '2026-01-10');
    cerrarPeriodo(ent.db, periodo.id, 'prueba', 'cierre mensual');
    expect(() => contabilizarAsiento(ent.db, entradaBase({ claveIdempotencia: 'otra' }))).toThrow(/cerrado/);
    reabrirPeriodo(ent.db, periodo.id, 'prueba', 'corrección documentada');
    const r = contabilizarAsiento(ent.db, entradaBase({ claveIdempotencia: 'otra' }));
    expect(r.duplicado).toBe(false);
  });

  it('anulación crea reverso trazable, conserva el original y cancela el efecto contable', () => {
    const r = contabilizarAsiento(ent.db, entradaBase());
    const reverso = anularAsiento(ent.db, r.asientoId, 'prueba', 'error de registro');
    const asientos = listarAsientos(ent.db);
    expect(asientos).toHaveLength(2);
    const original = asientos.find(a => a.id === r.asientoId);
    expect(original?.estado).toBe('anulado');
    const reversoFila = asientos.find(a => a.id === reverso.asientoId);
    expect(reversoFila?.reversoDeId).toBe(r.asientoId);
    const mayor = mayorDeCuenta(ent.db, idCuenta(ent.db, '1101'));
    expect(mayor.saldoMinor).toBe('0.00');
    expect(() => anularAsiento(ent.db, r.asientoId, 'prueba', 'segunda anulación')).toThrow(/ya tiene reverso/);
  });

  it('el balance cumple la ecuación patrimonial tras varias operaciones sintéticas', () => {
    contabilizarAsiento(ent.db, entradaBase());
    contabilizarAsiento(ent.db, entradaBase({
      concepto: 'Reconocimiento sintético de servicio',
      claveIdempotencia: 'srv-1',
      lineas: [
        { cuentaId: idCuenta(ent.db, '1201'), debeMinor: '226.00', haberMinor: '' },
        { cuentaId: idCuenta(ent.db, '4101'), debeMinor: '', haberMinor: '200.00' },
        { cuentaId: idCuenta(ent.db, '2201'), debeMinor: '', haberMinor: '26.00' }
      ]
    }));
    contabilizarAsiento(ent.db, entradaBase({
      concepto: 'Compra sintética a crédito',
      claveIdempotencia: 'com-1',
      lineas: [
        { cuentaId: idCuenta(ent.db, '5101'), debeMinor: '100.00', haberMinor: '' },
        { cuentaId: idCuenta(ent.db, '2201'), debeMinor: '13.00', haberMinor: '' },
        { cuentaId: idCuenta(ent.db, '2101'), debeMinor: '', haberMinor: '113.00' }
      ]
    }));
    const balance = balanceResumen(ent.db);
    expect(balance.cuadra).toBe(true);
    expect(balance.totalActivoMinor).toBe('326.00');
    expect(balance.totalResultadoMinor).toBe('100.00');
  });
});
