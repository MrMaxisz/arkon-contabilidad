import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { entornoPrueba, idCuenta, type EntornoPrueba } from './utilidades';
import { crearRespaldo, restaurarRespaldo, ErrorRespaldo } from '../src/main/servicios/respaldo';
import { contabilizarAsiento } from '../src/main/servicios/motorAsientos';
import { abrirBase } from '../src/main/db/conexion';
import { aplicarMigraciones } from '../src/main/db/aplicarMigraciones';
import { listarAsientos } from '../src/main/servicios/motorAsientos';

let ent: EntornoPrueba;

beforeEach(() => {
  ent = entornoPrueba();
});

afterEach(() => {
  ent.limpiar();
});

describe('respaldo y restauración', () => {
  it('crea un respaldo verificable con hash e integridad y lo registra', async () => {
    contabilizarAsiento(ent.db, {
      fechaOperacion: '2026-02-05',
      concepto: 'Aporte sintético',
      responsable: 'prueba',
      ambitoId: 'administrativo',
      lineas: [
        { cuentaId: idCuenta(ent.db, '1103'), debeMinor: '500.00', haberMinor: '' },
        { cuentaId: idCuenta(ent.db, '3101'), debeMinor: '', haberMinor: '500.00' }
      ]
    });
    const dirRespaldos = path.join(ent.dir, 'respaldos');
    const info = await crearRespaldo(ent.db, dirRespaldos, '0.1.0-prueba');
    expect(info.estado).toBe('disponible');
    expect(fs.existsSync(path.join(dirRespaldos, info.nombre))).toBe(true);
    expect(info.hashSha256).toHaveLength(64);
  });

  it('restaura en un entorno limpio y recupera documentos y bitácora', async () => {
    contabilizarAsiento(ent.db, {
      fechaOperacion: '2026-02-05',
      concepto: 'Aporte sintético a restaurar',
      responsable: 'prueba',
      ambitoId: 'administrativo',
      lineas: [
        { cuentaId: idCuenta(ent.db, '1103'), debeMinor: '250.00', haberMinor: '' },
        { cuentaId: idCuenta(ent.db, '3101'), debeMinor: '', haberMinor: '250.00' }
      ]
    });
    const dirRespaldos = path.join(ent.dir, 'respaldos');
    const info = await crearRespaldo(ent.db, dirRespaldos, '0.1.0-prueba');

    const rutaBaseLimpia = path.join(ent.dir, 'limpia', 'arkon.db');
    fs.mkdirSync(path.dirname(rutaBaseLimpia), { recursive: true });
    const dbDestino = abrirBase(rutaBaseLimpia);
    aplicarMigraciones(dbDestino);

    const rutaRespaldo = path.join(dirRespaldos, info.nombre);
    dbDestino.close();
    restaurarRespaldo(abrirBase(rutaBaseLimpia), rutaRespaldo, rutaBaseLimpia);

    const dbRestaurada = abrirBase(rutaBaseLimpia);
    aplicarMigraciones(dbRestaurada);
    const asientos = listarAsientos(dbRestaurada);
    expect(asientos).toHaveLength(1);
    expect(asientos[0]?.concepto).toBe('Aporte sintético a restaurar');
    const bitacora = dbRestaurada.prepare('SELECT COUNT(*) AS n FROM bitacora_evento').get() as { n: number };
    expect(bitacora.n).toBeGreaterThan(0);
    dbRestaurada.close();
  });

  it('rechaza un respaldo cuyo hash fue alterado, sin dañar la base activa', async () => {
    const dirRespaldos = path.join(ent.dir, 'respaldos');
    const info = await crearRespaldo(ent.db, dirRespaldos, '0.1.0-prueba');
    const ruta = path.join(dirRespaldos, info.nombre);
    fs.appendFileSync(ruta, 'corrupcion');
    const rutaBaseLimpia = path.join(ent.dir, 'limpia2', 'arkon.db');
    fs.mkdirSync(path.dirname(rutaBaseLimpia), { recursive: true });
    const dbDestino = abrirBase(rutaBaseLimpia);
    aplicarMigraciones(dbDestino);
    expect(() => restaurarRespaldo(dbDestino, ruta, rutaBaseLimpia)).toThrow(ErrorRespaldo);
    expect(fs.existsSync(`${rutaBaseLimpia}.antes-restauracion`)).toBe(false);
    dbDestino.close();
  });
});
