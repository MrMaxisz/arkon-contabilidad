import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { abrirBase, prepararRutasDatos } from '../src/main/db/conexion';
import { aplicarMigraciones } from '../src/main/db/aplicarMigraciones';
import { sembrarCatalogoBase } from '../src/main/servicios/cuentas';
import { despachar } from '../src/main/comandos';
import { generarPaqueteContador } from '../src/main/servicios/paqueteContador';
import { crearContraparte, registrarVenta } from '../src/main/servicios/operacion';
import { registrarCobro } from '../src/main/servicios/tesoreria';
import type BetterSqlite3 from 'better-sqlite3';

let dir: string;
let rutaDb: string;
let rutas: ReturnType<typeof prepararRutasDatos>;
const abiertas: Array<BetterSqlite3.Database> = [];

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arkon-a35p-'));
  rutas = prepararRutasDatos(path.join(dir, 'datos'));
  rutaDb = path.join(rutas.datos, 'op.db');
  fs.mkdirSync(rutas.datos, { recursive: true });
  const db = abrirBase(rutaDb);
  aplicarMigraciones(db);
  sembrarCatalogoBase(db);
  db.prepare("INSERT INTO ambito (id, nombre, tipo) VALUES ('administrativo', 'Prueba a35p', 'administrativo')").run();
  abiertas.push(db);
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

function idCuenta(db: BetterSqlite3.Database, codigo: string): number {
  return (db.prepare('SELECT id FROM cuenta WHERE codigo = ?').get(codigo) as { id: number }).id;
}

describe('auditoría 35: paquete del contador coherente al corte', () => {
  it('el universo se toma al corte: un cobro TOTAL posterior no vacía el auxiliar ni falsea la conciliación', () => {
    const db = abiertas[0];
    const ctx = contexto(db);
    const cliente = crearContraparte(db, { nombre: 'Cliente Corte A35', esCliente: true, esProveedor: false, responsable: 'p' });
    const venta = registrarVenta(db, {
      contraparteId: cliente,
      fechaOperacion: '2026-11-01',
      concepto: 'Venta corte sintética',
      tipoIngreso: 'instalaciones',
      base: '100.00',
      tasa: '0',
      claveIdempotencia: 'v-a35p',
      responsable: 'p'
    });
    registrarCobro(db, {
      fechaOperacion: '2026-12-05',
      contraparteId: cliente,
      cuentaDestinoId: idCuenta(db, '1101'),
      monto: '100.00',
      concepto: 'Cobro total sintético',
      aplicaciones: [{ documentoTipo: 'venta', documentoId: venta.id, monto: '100.00' }],
      claveIdempotencia: 'cob-a35p',
      responsable: 'p'
    });

    const paquete = generarPaqueteContador(db, '2026-11-01', '2026-11-30');
    expect(paquete.version).toBe('paquete-contador-v2');

    const clientes = paquete.archivos.find(a => a.nombre === 'auxiliar-clientes.csv')!;
    expect(clientes.contenido).toContain('V-000001,2026-11-01');
    expect(clientes.contenido).toContain('TOTAL,,,,,100.00');
    expect(paquete.conciliaciones.clientesMayor).toBe(true);

    const conciliaciones = paquete.archivos.find(a => a.nombre === 'conciliaciones.csv')!;
    expect(conciliaciones.contenido).toContain('auxiliar-clientes-al-corte-vs-mayor-1201,ok');
    expect(conciliaciones.contenido).toContain('total-clientes-al-corte,100.00');
    expect(conciliaciones.contenido).toContain('mayor-1201-al-corte,100.00');

    const paqueteActual = generarPaqueteContador(db, '2026-11-01', '2026-12-31');
    const clientesActual = paqueteActual.archivos.find(a => a.nombre === 'auxiliar-clientes.csv')!;
    expect(clientesActual.contenido).toContain('TOTAL,,,,,0.00');
    void ctx;
    db.close();
  });

  it('rango parcial: resultados y asientos del rango exacto, saldos acumulados al corte', () => {
    const db = abiertas[0];
    const ctx = contexto(db);
    const cliente = crearContraparte(db, { nombre: 'Cliente Rango A35', esCliente: true, esProveedor: false, responsable: 'p' });
    registrarVenta(db, {
      contraparteId: cliente,
      fechaOperacion: '2026-11-01',
      concepto: 'Venta fuera de rango',
      tipoIngreso: 'instalaciones',
      base: '40.00',
      tasa: '0',
      claveIdempotencia: 'v-a35p-fuera',
      responsable: 'p'
    });
    registrarVenta(db, {
      contraparteId: cliente,
      fechaOperacion: '2026-11-15',
      concepto: 'Venta dentro de rango',
      tipoIngreso: 'instalaciones',
      base: '60.00',
      tasa: '0',
      claveIdempotencia: 'v-a35p-dentro',
      responsable: 'p'
    });

    const paquete = generarPaqueteContador(db, '2026-11-10', '2026-11-20');
    const resultados = paquete.archivos.find(a => a.nombre === 'estado-resultados.csv')!;
    expect(resultados.contenido).toContain('2026-11-10,2026-11-20,4101');
    expect(resultados.contenido).toContain('2026-11-10,2026-11-20,TOTAL,,,60.00');
    expect(resultados.contenido).not.toContain('40.00');

    const asientos = paquete.archivos.find(a => a.nombre === 'asientos.csv')!;
    expect(asientos.contenido).toContain('A-000002,2026-11-15');
    expect(asientos.contenido).not.toContain('A-000001,2026-11-01');

    const cuentas = paquete.archivos.find(a => a.nombre === 'cuentas.csv')!;
    expect(cuentas.contenido).toContain('1201,Clientes,activo,100.00');
    expect(paquete.conciliaciones.balanceCuadra).toBe(true);
    void ctx;
    db.close();
  });

  it('un anticipo aplicado después del corte no reduce la deuda al corte', () => {
    const db = abiertas[0];
    const ctx = contexto(db);
    const cliente = crearContraparte(db, { nombre: 'Cliente Anticipo A35', esCliente: true, esProveedor: false, responsable: 'p' });
    const venta = registrarVenta(db, {
      contraparteId: cliente,
      fechaOperacion: '2026-11-01',
      concepto: 'Venta anticipo sintética',
      tipoIngreso: 'instalaciones',
      base: '80.00',
      tasa: '0',
      claveIdempotencia: 'v-a35p-ant',
      responsable: 'p'
    });
    const cobro = registrarCobro(db, {
      fechaOperacion: '2026-12-10',
      contraparteId: cliente,
      cuentaDestinoId: idCuenta(db, '1101'),
      monto: '80.00',
      concepto: 'Cobro anticipo sintético',
      aplicaciones: [],
      claveIdempotencia: 'cob-a35p-ant',
      responsable: 'p'
    });
    despachar(ctx, 'anticipo:aplicar', {
      tipo: 'cliente',
      contraparteId: cliente,
      documentoTipo: 'venta',
      documentoId: venta.id,
      fechaOperacion: '2026-12-11',
      monto: '80.00',
      claveIdempotencia: 'ap-a35p',
      responsable: 'p'
    });
    void cobro;

    const paquete = generarPaqueteContador(db, '2026-11-01', '2026-11-30');
    const clientes = paquete.archivos.find(a => a.nombre === 'auxiliar-clientes.csv')!;
    expect(clientes.contenido).toContain('TOTAL,,,,,80.00');
    db.close();
  });

  it('rechaza rangos inválidos y fechas imposibles', () => {
    const db = abiertas[0];
    const ctx = contexto(db);
    expect(() => generarPaqueteContador(db, '2026-12-01', '2026-11-01')).toThrow(/posterior/);
    expect(() => generarPaqueteContador(db, '2026-11-31', '2026-12-01')).toThrow(/inexistente/);
    expect(() => despachar(ctx, 'paquete:generar', { desde: '2026-11-01', hasta: '2027-02-30' })).toThrow(/inexistente/);
    db.close();
  });
});
