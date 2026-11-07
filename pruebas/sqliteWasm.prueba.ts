import { describe, expect, it } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { SqliteWasmDatabaseAdapter } from '../src/plataforma/sqliteWasm';
import { aplicarMigraciones } from '../src/main/db/aplicarMigraciones';
import { sembrarCatalogoBase } from '../src/main/servicios/cuentas';
import { contabilizarAsiento, anularAsiento } from '../src/main/servicios/motorAsientos';
import { crearContraparte, registrarVenta } from '../src/main/servicios/operacion';
import { darAltaActivoFijo, depreciarMes } from '../src/main/servicios/activosFijos';
import { balanceResumen, estadoSituacionFinanciera } from '../src/main/servicios/estadosFinancieros';
import type Database from 'better-sqlite3';

const sqlite3 = await sqlite3InitModule();

function comoServicio(db: BetterSqlite3.Database | SqliteWasmDatabaseAdapter): Database.Database {
  return db as unknown as Database.Database;
}

function preparar(db: BetterSqlite3.Database | SqliteWasmDatabaseAdapter): void {
  const servicio = comoServicio(db);
  aplicarMigraciones(servicio);
  sembrarCatalogoBase(servicio, 'prueba-wasm');
  servicio.prepare("INSERT INTO ambito (id, nombre, tipo) VALUES ('administrativo', 'Prueba Android', 'administrativo')").run();
}

function idCuenta(db: BetterSqlite3.Database | SqliteWasmDatabaseAdapter, codigo: string): number {
  return Number((db.prepare('SELECT id FROM cuenta WHERE codigo = ?').get(codigo) as { id: number }).id);
}

function escenario(db: BetterSqlite3.Database | SqliteWasmDatabaseAdapter) {
  const servicio = comoServicio(db);
  preparar(db);
  const caja = idCuenta(db, '1101');
  const patrimonio = idCuenta(db, '3101');
  const asiento = contabilizarAsiento(servicio, {
    fechaOperacion: '2026-01-10',
    concepto: 'Aporte sintético',
    responsable: 'prueba',
    ambitoId: 'administrativo',
    lineas: [
      { cuentaId: caja, debeMinor: '100.00', haberMinor: '' },
      { cuentaId: patrimonio, debeMinor: '', haberMinor: '100.00' }
    ]
  });
  anularAsiento(servicio, asiento.asientoId, 'prueba', 'Corrección sintética');

  const cliente = crearContraparte(servicio, {
    nombre: 'Cliente sintético',
    esCliente: true,
    esProveedor: false,
    responsable: 'prueba'
  });
  registrarVenta(servicio, {
    contraparteId: cliente,
    fechaOperacion: '2026-01-20',
    concepto: 'Servicio sintético',
    tipoIngreso: 'instalaciones',
    base: '200.00',
    tasa: '0',
    claveIdempotencia: 'venta-wasm-1',
    responsable: 'prueba'
  });

  darAltaActivoFijo(servicio, {
    descripcion: 'Equipo sintético',
    categoria: 'Herramientas',
    ubicacion: 'Bodega sintética',
    responsable: 'prueba',
    fechaAdquisicion: '2026-01-10',
    fechaInicioUso: '2026-01-15',
    costoMinor: '1200.00',
    residualMinor: '0.00',
    vidaUtilMeses: 12,
    cuentaActivoId: idCuenta(db, '1501'),
    cuentaDepreciacionId: idCuenta(db, '1502'),
    cuentaGastoId: idCuenta(db, '6101'),
    cuentaContrapartidaId: caja
  });
  const depreciacion = depreciarMes(servicio, { mes: '2026-02', responsable: 'prueba' });

  return {
    depreciacion,
    balance: balanceResumen(servicio),
    situacion: estadoSituacionFinanciera(servicio, { corte: '2026-02-28' }),
    asientos: servicio.prepare('SELECT COUNT(*) AS n FROM asiento').get() as { n: number }
  };
}

describe('SQLite WASM como base síncrona de servicios Android', () => {
  it('reproduce migraciones, catálogo, operaciones y estados frente a better-sqlite3', () => {
    const nativo = new BetterSqlite3(':memory:');
    const wasm = new SqliteWasmDatabaseAdapter(new sqlite3.oo1.DB(':memory:', 'ct'));
    try {
      const wasmResultado = escenario(wasm);
      const nativoResultado = escenario(nativo);
      expect(wasmResultado).toEqual(nativoResultado);
      // Cifras calculadas a mano: aporte 100.00 y su reverso se cancelan; venta
      // 200.00 a crédito; activo 1200.00 pagado de caja (-1200.00); cuota de
      // depreciación 1200.00 / 12 = 100.00. Activo neto 100.00 = resultado 100.00.
      expect(wasmResultado.depreciacion.totalMinor).toBe('100.00');
      expect(wasmResultado.asientos.n).toBe(5);
      expect(wasmResultado.balance).toEqual({
        totalActivoMinor: '100.00',
        totalPasivoMinor: '0.00',
        totalPatrimonioMinor: '0.00',
        totalResultadoMinor: '100.00',
        cuadra: true
      });
      expect(wasmResultado.situacion.activo.totalMinor).toBe('100.00');
      expect(wasmResultado.situacion.patrimonio.resultadoEjercicioMinor).toBe('100.00');
      expect(wasmResultado.situacion.cuadra).toBe(true);
    } finally {
      wasm.close();
      nativo.close();
    }
  });

  it('preserva enteros grandes con safeIntegers y propaga CHECK y UNIQUE', () => {
    const nativo = new BetterSqlite3(':memory:');
    const wasm = new SqliteWasmDatabaseAdapter(new sqlite3.oo1.DB(':memory:', 'ct'));
    try {
      const consulta = 'SELECT 9007199254740993 AS importe';
      expect(wasm.prepare(consulta).safeIntegers(true).get()).toEqual({ importe: 9007199254740993n });
      expect(wasm.prepare(consulta).safeIntegers(true).get()).toEqual(
        nativo.prepare(consulta).safeIntegers(true).get()
      );
      for (const db of [nativo, wasm]) {
        db.exec('CREATE TEMP TABLE restricciones (codigo TEXT UNIQUE, importe INTEGER CHECK (importe > 0))');
        db.prepare('INSERT INTO restricciones (codigo, importe) VALUES (?, ?)').run('unico', 1);
        expect(() => db.prepare('INSERT INTO restricciones (codigo, importe) VALUES (?, ?)').run('unico', 2)).toThrow();
        expect(() => db.prepare('INSERT INTO restricciones (codigo, importe) VALUES (?, ?)').run('check', 0)).toThrow();
      }
    } finally {
      wasm.close();
      nativo.close();
    }
  });
});
