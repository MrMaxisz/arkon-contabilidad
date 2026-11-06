import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { abrirBase } from '../src/main/db/conexion';
import { aplicarMigraciones } from '../src/main/db/aplicarMigraciones';
import { sembrarCatalogoBase } from '../src/main/servicios/cuentas';
import { crearContraparte, registrarVenta, registrarCompra, listarVentas, listarCompras } from '../src/main/servicios/operacion';
import { actualizarCotizacionBorrador, crearCotizacion, crearRevision, lineasDeCotizacion, listarCotizaciones } from '../src/main/servicios/cotizaciones';

let dir: string;
let rutaDb: string;
const abiertas: Array<ReturnType<typeof abrirBase>> = [];

function abrir(): ReturnType<typeof abrirBase> {
  const db = abrirBase(rutaDb);
  aplicarMigraciones(db);
  abiertas.push(db);
  return db;
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arkon-rev5-'));
  rutaDb = path.join(dir, 'operativa.db');
  const db = abrir();
  db.prepare(
    "INSERT INTO ambito (id, nombre, tipo) VALUES ('administrativo', 'Prueba rev5', 'administrativo')"
  ).run();
  sembrarCatalogoBase(db, 'prueba');
});

afterEach(() => {
  for (const db of abiertas) {
    if (db.open) {
      db.close();
    }
  }
  abiertas.length = 0;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('quinta revisión', () => {
  it('editar una revisión sin tocar las condiciones las conserva', () => {
    const db = abrir();
    const cliente = crearContraparte(db, { nombre: 'Cliente J', esCliente: true, esProveedor: false, responsable: 'p' });
    const original = crearCotizacion(db, {
      contraparteId: cliente,
      fecha: '2026-05-01',
      condiciones: 'Condiciones valiosas sintéticas',
      responsable: 'p',
      lineas: [
        { tipo: 'servicio', descripcion: 'Servicio', cantidad: '1', precioUnitario: '100.00', precioConIva: false, tasa: '0' }
      ]
    });
    const revision = crearRevision(db, original.id, 'p');
    actualizarCotizacionBorrador(db, revision.id, {
      lineas: [
        { tipo: 'servicio', descripcion: 'Servicio editado', cantidad: '1', precioUnitario: '110.00', precioConIva: false, tasa: '0' }
      ],
      responsable: 'p'
    });
    const fila = db
      .prepare('SELECT condiciones FROM cotizacion WHERE id = ?')
      .get(revision.id) as { condiciones: string | null };
    expect(fila.condiciones).toBe('Condiciones valiosas sintéticas');
    actualizarCotizacionBorrador(db, revision.id, {
      condiciones: 'Condiciones nuevas',
      lineas: [
        { tipo: 'servicio', descripcion: 'Servicio editado', cantidad: '1', precioUnitario: '110.00', precioConIva: false, tasa: '0' }
      ],
      responsable: 'p'
    });
    const fila2 = db
      .prepare('SELECT condiciones FROM cotizacion WHERE id = ?')
      .get(revision.id) as { condiciones: string | null };
    expect(fila2.condiciones).toBe('Condiciones nuevas');
    const lineasRevision = lineasDeCotizacion(db, revision.id);
    expect(lineasRevision[0]?.descripcion).toBe('Servicio editado');
    const listadas = listarCotizaciones(db);
    expect(listadas.find(c => c.id === revision.id)?.condiciones).toBe('Condiciones nuevas');
    db.close();
  });

  it('los listados de ventas y compras identifican a la contraparte por id, no por nombre', () => {
    const db = abrir();
    const cliente1 = crearContraparte(db, { nombre: 'Homónimo', esCliente: true, esProveedor: true, responsable: 'p' });
    const cliente2 = crearContraparte(db, { nombre: 'Homónimo', esCliente: true, esProveedor: true, responsable: 'p' });
    const venta1 = registrarVenta(db, {
      contraparteId: cliente1,
      fechaOperacion: '2026-05-01',
      concepto: 'Venta a homónimo 1',
      tipoIngreso: 'instalaciones',
      base: '10.00',
      tasa: '0',
      claveIdempotencia: 'v-h1',
      responsable: 'p'
    });
    const venta2 = registrarVenta(db, {
      contraparteId: cliente2,
      fechaOperacion: '2026-05-01',
      concepto: 'Venta a homónimo 2',
      tipoIngreso: 'instalaciones',
      base: '20.00',
      tasa: '0',
      claveIdempotencia: 'v-h2',
      responsable: 'p'
    });
    const compra1 = registrarCompra(db, {
      contraparteId: cliente1,
      fechaOperacion: '2026-05-02',
      concepto: 'Compra a homónimo 1',
      condicion: 'credito',
      lineas: [{ descripcion: 'Material', cuentaCodigo: '5101', cantidad: '1', precioUnitario: '5.00', tasa: '0', tratamiento: 'exento' }],
      claveIdempotencia: 'c-h1',
      responsable: 'p'
    });
    const ventas = listarVentas(db);
    const ventaFila1 = ventas.find(v => v.id === venta1.id);
    const ventaFila2 = ventas.find(v => v.id === venta2.id);
    expect(ventaFila1?.contraparteId).toBe(cliente1);
    expect(ventaFila2?.contraparteId).toBe(cliente2);
    expect(ventas.filter(v => v.contraparteId === cliente1)).toHaveLength(1);
    expect(ventas.filter(v => v.contraparteId === cliente2)).toHaveLength(1);
    const compras = listarCompras(db);
    expect(compras.find(c => c.id === compra1.id)?.contraparteId).toBe(cliente1);
    db.close();
  });
});
