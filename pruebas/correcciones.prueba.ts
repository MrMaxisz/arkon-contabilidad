import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { entornoPrueba, idCuenta, type EntornoPrueba } from './utilidades';
import {
  contabilizarAsiento,
  anularAsiento,
  listarAsientos,
  ErrorContable
} from '../src/main/servicios/motorAsientos';
import { balanceResumen } from '../src/main/servicios/estadosFinancieros';
import { listarRespaldos, crearRespaldo, restaurarRespaldo, registrarRestauracion } from '../src/main/servicios/respaldo';
import { abrirBase } from '../src/main/db/conexion';
import { aplicarMigraciones } from '../src/main/db/aplicarMigraciones';
import { validarFechaCalendario, ErrorFecha } from '../src/shared/fechas';
import path from 'path';
import fs from 'fs';

let ent: EntornoPrueba;

beforeEach(() => {
  ent = entornoPrueba();
});

afterEach(() => {
  ent.limpiar();
});

function aporte(lineasExtra: Array<{ codigo: string; debe: string; haber: string }> = []) {
  return {
    fechaOperacion: '2026-01-10',
    concepto: 'Operación sintética',
    responsable: 'prueba',
    ambitoId: 'administrativo',
    claveIdempotencia: `op-${Math.random()}`,
    lineas: [
      { cuentaId: idCuenta(ent.db, '1101'), debeMinor: '100.00', haberMinor: '' },
      { cuentaId: idCuenta(ent.db, '3101'), debeMinor: '', haberMinor: '100.00' },
      ...lineasExtra.map(l => ({
        cuentaId: idCuenta(ent.db, l.codigo),
        debeMinor: l.debe,
        haberMinor: l.haber
      }))
    ]
  };
}

describe('clasificación de anticipos en el balance', () => {
  it('el anticipo recibido de clientes es pasivo y el entregado a proveedores es activo', () => {
    contabilizarAsiento(ent.db, aporte([
      { codigo: '1103', debe: '113.00', haber: '' },
      { codigo: '2102', debe: '', haber: '113.00' }
    ]));
    contabilizarAsiento(ent.db, aporte([
      { codigo: '1202', debe: '50.00', haber: '' },
      { codigo: '2101', debe: '', haber: '50.00' }
    ]));
    const saldoAnticipoClientes = (ent.db
      .prepare("SELECT tipo FROM cuenta WHERE codigo = '2102'")
      .get() as { tipo: string }).tipo;
    const saldoAnticipoProveedores = (ent.db
      .prepare("SELECT tipo FROM cuenta WHERE codigo = '1202'")
      .get() as { tipo: string }).tipo;
    expect(saldoAnticipoClientes).toBe('pasivo');
    expect(saldoAnticipoProveedores).toBe('activo');
    const balance = balanceResumen(ent.db);
    expect(balance.cuadra).toBe(true);
    expect(balance.totalActivoMinor).toBe('363.00');
    expect(balance.totalPasivoMinor).toBe('163.00');
  });
});

describe('protección persistente de asientos contabilizados', () => {
  it('rechaza editar, borrar o insertar líneas de un asiento contabilizado', () => {
    const r = contabilizarAsiento(ent.db, aporte());
    const linea = ent.db
      .prepare('SELECT id FROM asiento_linea WHERE asiento_id = ? LIMIT 1')
      .get(r.asientoId) as { id: number };
    expect(() =>
      ent.db.prepare('UPDATE asiento_linea SET debe_minor = 999 WHERE id = ?').run(linea.id)
    ).toThrow(/no admite editar/);
    expect(() =>
      ent.db.prepare('DELETE FROM asiento_linea WHERE id = ?').run(linea.id)
    ).toThrow(/no admite borrar/);
    expect(() =>
      ent.db
        .prepare('INSERT INTO asiento_linea (asiento_id, cuenta_id, debe_minor, haber_minor) VALUES (?, ?, ?, ?)')
        .run(r.asientoId, idCuenta(ent.db, '1103'), 100, 0)
    ).toThrow(/no admite líneas nuevas/);
  });

  it('rechaza cambiar contenido o borrar un asiento contabilizado; el flujo autorizado sigue funcionando', () => {
    const r = contabilizarAsiento(ent.db, aporte());
    expect(() =>
      ent.db.prepare('UPDATE asiento SET concepto = ? WHERE id = ?').run('cambio ilegal', r.asientoId)
    ).toThrow(/no admite cambios de contenido/);
    expect(() =>
      ent.db.prepare('DELETE FROM asiento WHERE id = ?').run(r.asientoId)
    ).toThrow(/no se borra/);
    const reverso = anularAsiento(ent.db, r.asientoId, 'prueba', 'motivo sintético');
    expect(reverso.duplicado).toBe(false);
    const estados = ent.db
      .prepare('SELECT estado FROM asiento WHERE id IN (?, ?) ORDER BY id')
      .all(r.asientoId, reverso.asientoId) as Array<{ estado: string }>;
    expect(estados.map(e => e.estado)).toEqual(['anulado', 'contabilizado']);
  });
});

describe('atomicidad real con fallo inducido dentro de la transacción', () => {
  it('un fallo tras insertar la cabecera revierte asiento y líneas', () => {
    ent.db.exec(`CREATE TRIGGER fallo_inducido BEFORE INSERT ON asiento_linea
      WHEN NEW.cuenta_id = ${idCuenta(ent.db, '1103')}
      BEGIN SELECT RAISE(ABORT, 'fallo inducido'); END;`);
    try {
      expect(() =>
        contabilizarAsiento(ent.db, {
          fechaOperacion: '2026-01-15',
          concepto: 'Fallo inducido sintético',
          responsable: 'prueba',
          ambitoId: 'administrativo',
          claveIdempotencia: 'fallo-1',
          lineas: [
            { cuentaId: idCuenta(ent.db, '1101'), debeMinor: '10.00', haberMinor: '' },
            { cuentaId: idCuenta(ent.db, '1103'), debeMinor: '', haberMinor: '10.00' }
          ]
        })
      ).toThrow(/fallo inducido/);
      const n = (ent.db.prepare('SELECT COUNT(*) AS n FROM asiento').get() as { n: number }).n;
      const nl = (ent.db.prepare('SELECT COUNT(*) AS n FROM asiento_linea').get() as { n: number }).n;
      expect(n).toBe(0);
      expect(nl).toBe(0);
    } finally {
      ent.db.exec('DROP TRIGGER fallo_inducido');
    }
  });
});

describe('validación de fechas de calendario', () => {
  it('rechaza fechas inexistentes y acepta bisiestos', () => {
    expect(() => validarFechaCalendario('2026-02-30')).toThrow(ErrorFecha);
    expect(() => validarFechaCalendario('2026-13-01')).toThrow(ErrorFecha);
    expect(() => validarFechaCalendario('2026-00-10')).toThrow(ErrorFecha);
    expect(() => validarFechaCalendario('2026-04-31')).toThrow(ErrorFecha);
    expect(() => validarFechaCalendario('2024-02-29')).not.toThrow();
    expect(() => validarFechaCalendario('2023-02-29')).toThrow(ErrorFecha);
  });

  it('el motor rechaza contabilizar con fecha inexistente', () => {
    expect(() =>
      contabilizarAsiento(ent.db, {
        ...aporte(),
        fechaOperacion: '2026-02-30',
        claveIdempotencia: 'fecha-mala'
      })
    ).toThrow(ErrorFecha);
  });
});

describe('contrato de importes entre servicio e interfaz', () => {
  it('listarAsientos entrega importes monetarios, no centavos crudos', () => {
    contabilizarAsiento(ent.db, aporte());
    const lista = listarAsientos(ent.db);
    expect(lista[0]?.totalMinor).toBe('100.00');
  });
});

describe('listado y restauración de respaldos', () => {
  it('listarRespaldos entrega el contrato camelCase completo', async () => {
    const info = await crearRespaldo(ent.db, path.join(ent.dir, 'respaldos'), '0.1.0-prueba');
    const lista = listarRespaldos(ent.db);
    expect(lista).toHaveLength(1);
    expect(lista[0]?.creadoEn).toBeTruthy();
    expect(lista[0]?.versionEsquema).toBe(info.versionEsquema);
    expect(lista[0]?.nombre).toBe(info.nombre);
    expect(lista[0]?.hashSha256).toBe(info.hashSha256);
  });

  it('el evento de restauración queda en la bitácora de la base activa restaurada', async () => {
    const info = await crearRespaldo(ent.db, path.join(ent.dir, 'respaldos'), '0.1.0-prueba');
    const rutaBaseLimpia = path.join(ent.dir, 'limpia', 'arkon.db');
    fs.mkdirSync(path.dirname(rutaBaseLimpia), { recursive: true });
    const dbDestino = abrirBase(rutaBaseLimpia);
    aplicarMigraciones(dbDestino);
    dbDestino.close();
    restaurarRespaldo(abrirBase(rutaBaseLimpia), path.join(ent.dir, 'respaldos', info.nombre), rutaBaseLimpia);
    const dbRestaurada = abrirBase(rutaBaseLimpia);
    aplicarMigraciones(dbRestaurada);
    registrarRestauracion(dbRestaurada, { respaldo: info.nombre, copiaPrevia: 'arkon.db.antes-restauracion' });
    const evento = dbRestaurada
      .prepare("SELECT * FROM bitacora_evento WHERE tipo = 'restauracion_completada'")
      .get() as { entidad_id: string } | undefined;
    expect(evento?.entidad_id).toBe(info.nombre);
    dbRestaurada.close();
  });
});
