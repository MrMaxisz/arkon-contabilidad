import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { abrirBase, prepararRutasDatos } from '../src/main/db/conexion';
import { aplicarMigraciones } from '../src/main/db/aplicarMigraciones';
import { sembrarCatalogoBase } from '../src/main/servicios/cuentas';
import { despachar } from '../src/main/comandos';
import { crearContraparte, registrarVenta } from '../src/main/servicios/operacion';
import { registrarCobro } from '../src/main/servicios/tesoreria';
import type BetterSqlite3 from 'better-sqlite3';

let dir: string;
let rutaDb: string;
let rutas: ReturnType<typeof prepararRutasDatos>;
const abiertas: Array<BetterSqlite3.Database> = [];

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arkon-a34p-'));
  rutas = prepararRutasDatos(path.join(dir, 'datos'));
  rutaDb = path.join(rutas.datos, 'op.db');
  fs.mkdirSync(rutas.datos, { recursive: true });
  const db = abrirBase(rutaDb);
  aplicarMigraciones(db);
  sembrarCatalogoBase(db);
  db.prepare("INSERT INTO ambito (id, nombre, tipo) VALUES ('administrativo', 'Prueba a34p', 'administrativo')").run();
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

describe('auditoría 34: paquete interno para el contador', () => {
  it('genera archivos coherentes con el corte, conciliaciones y límites declarados', () => {
    const db = abiertas[0];
    const ctx = contexto(db);
    const cliente = crearContraparte(db, { nombre: 'Cliente Paquete A34', esCliente: true, esProveedor: false, responsable: 'p' });
    const venta = registrarVenta(db, {
      contraparteId: cliente,
      fechaOperacion: '2026-11-01',
      concepto: 'Venta paquete sintética',
      tipoIngreso: 'instalaciones',
      base: '100.00',
      tasa: '0',
      claveIdempotencia: 'v-paq34',
      responsable: 'p'
    });
    registrarCobro(db, {
      fechaOperacion: '2026-12-05',
      contraparteId: cliente,
      cuentaDestinoId: idCuenta(db, '1101'),
      monto: '60.00',
      concepto: 'Cobro paquete sintético',
      aplicaciones: [{ documentoTipo: 'venta', documentoId: venta.id, monto: '60.00' }],
      claveIdempotencia: 'cob-paq34',
      responsable: 'p'
    });

    const paquete = despachar(ctx, 'paquete:generar', { desde: '2026-11-01', hasta: '2026-11-30' }) as {
      version: string;
      archivos: Array<{ nombre: string; contenido: string }>;
      conciliaciones: { clientesMayor: boolean; efectivoMayor: boolean; balanceCuadra: boolean };
      limitaciones: string[];
    };

    expect(paquete.version).toBe('paquete-contador-v1');
    const nombres = paquete.archivos.map(a => a.nombre);
    for (const esperado of [
      'LEEME.txt',
      'cuentas.csv',
      'auxiliar-clientes.csv',
      'auxiliar-proveedores.csv',
      'auxiliar-efectivo.csv',
      'estado-resultados.csv',
      'asientos.csv',
      'conciliaciones.csv'
    ]) {
      expect(nombres).toContain(esperado);
    }

    const clientes = paquete.archivos.find(a => a.nombre === 'auxiliar-clientes.csv')!;
    expect(clientes.contenido).toContain('V-000001,2026-11-01');
    expect(clientes.contenido).toContain('TOTAL,,,,,100.00');
    expect(clientes.contenido).not.toContain('60.00');

    const resultados = paquete.archivos.find(a => a.nombre === 'estado-resultados.csv')!;
    expect(resultados.contenido).toContain('2026-11,4101');
    expect(resultados.contenido).toContain('2026-11,TOTAL,,,100.00');

    const asientos = paquete.archivos.find(a => a.nombre === 'asientos.csv')!;
    expect(asientos.contenido).toContain('A-000001,2026-11-01');
    expect(asientos.contenido).not.toContain('2026-12-05');

    const leeme = paquete.archivos.find(a => a.nombre === 'LEEME.txt')!;
    expect(leeme.contenido).toContain('paquete-contador-v1');
    expect(leeme.contenido).toContain('2026-11-01 a 2026-11-30');
    expect(leeme.contenido).toContain('NO es un anexo ni declaración oficial');
    expect(leeme.contenido).toContain('no está constituida');

    expect(paquete.conciliaciones.clientesMayor).toBe(true);
    expect(paquete.limitaciones.length).toBeGreaterThan(0);
  });

  it('rechaza rangos inválidos y fechas imposibles', () => {
    const db = abiertas[0];
    const ctx = contexto(db);
    expect(() => despachar(ctx, 'paquete:generar', { desde: '2026-12-01', hasta: '2026-11-01' })).toThrow(/posterior/);
    expect(() => despachar(ctx, 'paquete:generar', { desde: '2026-11-31', hasta: '2026-12-01' })).toThrow(/inexistente/);
    expect(() => despachar(ctx, 'paquete:generar', { desde: '2026-11-01', hasta: '2026-02-30' })).toThrow(/inexistente/);
  });
});
