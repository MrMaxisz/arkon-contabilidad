import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { abrirBase } from '../src/main/db/conexion';
import { aplicarMigraciones } from '../src/main/db/aplicarMigraciones';
import { sembrarCatalogoBase } from '../src/main/servicios/cuentas';
import {
  crearContraparte,
  registrarVenta,
  registrarCompra,
  listarVentas,
  listarCompras,
  completarClasificacionDocumento
} from '../src/main/servicios/operacion';
import { generarCsvLibro } from '../src/main/servicios/fiscal';

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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arkon-rev14-'));
  rutaDb = path.join(dir, 'operativa.db');
  const db = abrir();
  db.prepare(
    "INSERT INTO ambito (id, nombre, tipo) VALUES ('administrativo', 'Prueba rev14', 'administrativo')"
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

describe('decimocuarta revisión: acceso a documentos históricos', () => {
  it('un documento de septiembre fuera de los últimos 100 se localiza por filtro de mes, se clasifica y su mes exporta', () => {
    const db = abrir();
    const cliente = crearContraparte(db, { nombre: 'Cliente HH', esCliente: true, esProveedor: false, responsable: 'p' });
    const ventaAntigua = registrarVenta(db, {
      contraparteId: cliente,
      fechaOperacion: '2026-09-01',
      concepto: 'Venta antigua sin clasificar',
      tipoIngreso: 'instalaciones',
      base: '10.00',
      tasa: '0',
      claveIdempotencia: 'v-hh-antigua',
      responsable: 'p'
    });
    for (let i = 0; i < 101; i++) {
      registrarVenta(db, {
        contraparteId: cliente,
        fechaOperacion: '2026-10-01',
        concepto: `Venta reciente ${i}`,
        tipoIngreso: 'instalaciones',
        base: '1.00',
        tasa: '0',
        clasificacionDocumento: 'contribuyente',
        tipoDocumento: 'factura',
        claveIdempotencia: `v-hh-${i}`,
        responsable: 'p'
      });
    }
    const recientes = listarVentas(db);
    expect(recientes).toHaveLength(100);
    expect(recientes.some(v => v.id === ventaAntigua.id)).toBe(false);
    const deSeptiembre = listarVentas(db, { mes: '2026-09' });
    expect(deSeptiembre).toHaveLength(1);
    expect(deSeptiembre[0]?.id).toBe(ventaAntigua.id);
    completarClasificacionDocumento(db, 'venta', ventaAntigua.id, {
      clasificacionDocumento: 'contribuyente',
      tipoDocumento: 'ccf',
      responsable: 'p',
      motivo: 'clasificación tardía de histórico sintética'
    });
    const csv = generarCsvLibro(db, 'venta', '2026-09');
    expect(csv.csv).toContain('V-000001,2026-09-01,contribuyente,ccf,10.00,0.00,10.00');
    const pagina2 = listarVentas(db, { mes: '2026-10', desde: 100 });
    expect(pagina2).toHaveLength(1);
    db.close();
  });

  it('una compra histórica fuera de los últimos 100 se localiza por mes y se clasifica', () => {
    const db = abrir();
    const proveedor = crearContraparte(db, { nombre: 'Prov II', esCliente: false, esProveedor: true, responsable: 'p' });
    const linea = { descripcion: 'Material', cuentaCodigo: '5101', cantidad: '1', precioUnitario: '2.00', tasa: '0', tratamiento: 'exento' as const };
    const compraAntigua = registrarCompra(db, {
      contraparteId: proveedor,
      fechaOperacion: '2026-09-02',
      concepto: 'Compra antigua sin clasificar',
      condicion: 'credito',
      lineas: [linea],
      claveIdempotencia: 'c-ii-antigua',
      responsable: 'p'
    });
    for (let i = 0; i < 101; i++) {
      registrarCompra(db, {
        contraparteId: proveedor,
        fechaOperacion: '2026-10-02',
        concepto: `Compra reciente ${i}`,
        condicion: 'credito',
        lineas: [linea],
        clasificacionDocumento: 'contribuyente',
        tipoDocumento: 'factura',
        claveIdempotencia: `c-ii-${i}`,
        responsable: 'p'
      });
    }
    const recientes = listarCompras(db);
    expect(recientes).toHaveLength(100);
    expect(recientes.some(c => c.id === compraAntigua.id)).toBe(false);
    const deSeptiembre = listarCompras(db, { mes: '2026-09' });
    expect(deSeptiembre).toHaveLength(1);
    expect(deSeptiembre[0]?.id).toBe(compraAntigua.id);
    completarClasificacionDocumento(db, 'compra', compraAntigua.id, {
      clasificacionDocumento: 'contribuyente',
      tipoDocumento: 'factura',
      responsable: 'p',
      motivo: 'clasificación tardía de histórico sintética'
    });
    const csv = generarCsvLibro(db, 'compra', '2026-09');
    expect(csv.csv).toContain('contribuyente,factura');
    db.close();
  });
});

describe('decimocuarta revisión: atomicidad de la auditoría documental', () => {
  it('un fallo en la bitácora revierte la modificación y no deja eventos parciales', () => {
    const db = abrir();
    const cliente = crearContraparte(db, { nombre: 'Cliente JJ', esCliente: true, esProveedor: false, responsable: 'p' });
    const venta = registrarVenta(db, {
      contraparteId: cliente,
      fechaOperacion: '2026-09-05',
      concepto: 'Venta atómica',
      tipoIngreso: 'instalaciones',
      base: '20.00',
      tasa: '0',
      claveIdempotencia: 'v-jj',
      responsable: 'p'
    });
    db.exec(`CREATE TRIGGER fallo_bitacora BEFORE INSERT ON bitacora_evento
      WHEN NEW.tipo = 'clasificacion_completada'
      BEGIN SELECT RAISE(ABORT, 'Fallo simulado de auditoría'); END;`);
    try {
      expect(() =>
        completarClasificacionDocumento(db, 'venta', venta.id, {
          clasificacionDocumento: 'contribuyente',
          tipoDocumento: 'ccf',
          responsable: 'p',
          motivo: 'intento con auditoría fallida'
        })
      ).toThrow(/Fallo simulado/);
      const fila = db
        .prepare('SELECT clasificacion_documento, tipo_documento FROM venta WHERE id = ?')
        .get(venta.id) as { clasificacion_documento: string | null; tipo_documento: string | null };
      expect(fila.clasificacion_documento).toBeNull();
      expect(fila.tipo_documento).toBeNull();
      const eventos = db
        .prepare("SELECT COUNT(*) AS n FROM bitacora_evento WHERE tipo = 'clasificacion_completada'")
        .get() as { n: number };
      expect(eventos.n).toBe(0);
    } finally {
      db.exec('DROP TRIGGER fallo_bitacora');
    }
    completarClasificacionDocumento(db, 'venta', venta.id, {
      clasificacionDocumento: 'consumidor_final',
      tipoDocumento: 'factura',
      responsable: 'p',
      motivo: 'intento exitoso tras quitar el fallo'
    });
    const filaOk = db
      .prepare('SELECT clasificacion_documento, tipo_documento FROM venta WHERE id = ?')
      .get(venta.id) as { clasificacion_documento: string | null; tipo_documento: string | null };
    expect(filaOk.clasificacion_documento).toBe('consumidor_final');
    const eventosOk = db
      .prepare("SELECT COUNT(*) AS n FROM bitacora_evento WHERE tipo = 'clasificacion_completada'")
      .get() as { n: number };
    expect(eventosOk.n).toBe(1);
    db.close();
  });
});
