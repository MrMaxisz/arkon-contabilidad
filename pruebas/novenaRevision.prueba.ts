import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { abrirBase } from '../src/main/db/conexion';
import { migraciones } from '../src/main/db/migraciones';
import { aplicarMigraciones } from '../src/main/db/aplicarMigraciones';
import { sembrarCatalogoBase } from '../src/main/servicios/cuentas';
import { contabilizarAsiento, anularAsiento } from '../src/main/servicios/motorAsientos';
import { conciliarIva } from '../src/main/servicios/fiscal';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arkon-rev9-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function baseV5(): ReturnType<typeof abrirBase> {
  const db = abrirBase(path.join(dir, 'v5.db'));
  db.exec('CREATE TABLE IF NOT EXISTS _migracion (version INTEGER PRIMARY KEY, nombre TEXT NOT NULL, aplicada_en TEXT NOT NULL DEFAULT (datetime(\'now\')))');
  for (const m of migraciones.filter(m => m.version <= 5)) {
    db.exec(m.sql);
    db.prepare('INSERT INTO _migracion (version, nombre) VALUES (?, ?)').run(m.version, m.nombre);
  }
  db.prepare(
    "INSERT INTO ambito (id, nombre, tipo) VALUES ('administrativo', 'Prueba v5', 'administrativo')"
  ).run();
  sembrarCatalogoBase(db, 'prueba');
  return db;
}

function idCuenta(db: ReturnType<typeof abrirBase>, codigo: string): number {
  return (db.prepare('SELECT id FROM cuenta WHERE codigo = ?').get(codigo) as { id: number }).id;
}

function compraV5Sintetica(
  db: ReturnType<typeof abrirBase>,
  contraparteId: number,
  opts: { conCredito: boolean; ivaMinor: number; totalMinor: number; anular?: boolean }
): number {
  const folio = `CMP-OLD-${Math.floor(Math.random() * 1000000)}`;
  const cuentaCosto = idCuenta(db, '5101');
  const cuentaIva = idCuenta(db, '1203');
  const cuentaProveedores = idCuenta(db, '2101');
  const lineas = [
    {
      cuentaId: cuentaCosto,
      debeMinor: `${(opts.conCredito ? opts.totalMinor - opts.ivaMinor : opts.totalMinor) / 100}`,
      haberMinor: ''
    }
  ];
  if (opts.conCredito) {
    lineas.push({ cuentaId: cuentaIva, debeMinor: `${opts.ivaMinor / 100}`, haberMinor: '' });
  }
  lineas.push({ cuentaId: cuentaProveedores, debeMinor: '', haberMinor: `${opts.totalMinor / 100}` });
  const asiento = contabilizarAsiento(db, {
    fechaOperacion: '2026-08-05',
    concepto: 'Compra v5 sintética',
    lineas,
    origenTipo: 'compra',
    origenId: folio,
    claveIdempotencia: `v5-${Math.random()}`,
    responsable: 'p',
    ambitoId: 'administrativo'
  });
  const info = db
    .prepare(
      `INSERT INTO compra (folio, contraparte_id, fecha_operacion, concepto, condicion,
        base_minor, iva_minor, total_minor, asiento_id, estado, clave_idempotencia, responsable)
       VALUES (?, ?, '2026-08-05', 'Compra v5 sintética', 'credito', ?, ?, ?, ?, 'registrada', ?, 'p')`
    )
    .run(folio, contraparteId, (opts.totalMinor - opts.ivaMinor) * 1, opts.ivaMinor, opts.totalMinor, asiento.asientoId, `v5c-${Math.random()}`);
  const compraId = Number(info.lastInsertRowid);
  if (opts.anular) {
    anularAsiento(db, asiento.asientoId, 'p', 'anulación sintética v5', true);
    db.prepare("UPDATE compra SET estado = 'anulada' WHERE id = ?").run(compraId);
  }
  return compraId;
}

describe('novena revisión: migración v5 → v7 del crédito fiscal', () => {
  it('el crédito fiscal de compras v5 se recupera desde el asiento original, sin usar la política actual', () => {
    const db = baseV5();
    const contraparte = (
      db
        .prepare("INSERT INTO contraparte (nombre, es_cliente, es_proveedor) VALUES ('Prov Y', 0, 1)")
        .run()
    );
    const contraparteId = Number(contraparte.lastInsertRowid);
    compraV5Sintetica(db, contraparteId, { conCredito: true, ivaMinor: 130, totalMinor: 1130 });
    compraV5Sintetica(db, contraparteId, { conCredito: false, ivaMinor: 130, totalMinor: 1130 });
    compraV5Sintetica(db, contraparteId, { conCredito: true, ivaMinor: 130, totalMinor: 1130, anular: true });
    db.close();

    const dbMigrada = abrirBase(path.join(dir, 'v5.db'));
    aplicarMigraciones(dbMigrada);
    aplicarMigraciones(dbMigrada);
    const filas = dbMigrada
      .prepare('SELECT folio, estado, iva_credito_minor FROM compra ORDER BY id')
      .all() as Array<{ folio: string; estado: string; iva_credito_minor: number }>;
    expect(filas).toHaveLength(3);
    expect(filas[0]?.iva_credito_minor).toBe(130);
    expect(filas[1]?.iva_credito_minor).toBe(0);
    expect(filas[2]?.iva_credito_minor).toBe(130);
    expect(filas[2]?.estado).toBe('anulada');
    const conciliacion = conciliarIva(dbMigrada, '2026-08');
    expect(conciliacion.creditoAcreditableLibroMinor).toBe('1.30');
    expect(conciliacion.creditoMayorMinor).toBe('1.30');
    expect(conciliacion.conciliaCredito).toBe(true);
    dbMigrada.close();
  });

  it('una base nueva y una actualizada desde v5 concilian igual tras el cambio de política', () => {
    const db = baseV5();
    const contraparte = db.prepare("INSERT INTO contraparte (nombre, es_cliente, es_proveedor) VALUES ('Prov Z', 0, 1)").run();
    compraV5Sintetica(db, Number(contraparte.lastInsertRowid), { conCredito: true, ivaMinor: 260, totalMinor: 2260 });
    db.close();
    const dbMigrada = abrirBase(path.join(dir, 'v5.db'));
    aplicarMigraciones(dbMigrada);
    const conciliacionMigrada = conciliarIva(dbMigrada, '2026-08');
    expect(conciliacionMigrada.conciliaCredito).toBe(true);
    expect(conciliacionMigrada.creditoAcreditableLibroMinor).toBe('2.60');
    dbMigrada.close();
  });
});
