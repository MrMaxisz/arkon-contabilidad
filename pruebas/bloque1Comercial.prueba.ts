import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { abrirBase } from '../src/main/db/conexion';
import { aplicarMigraciones } from '../src/main/db/aplicarMigraciones';
import { sembrarCatalogoBase } from '../src/main/servicios/cuentas';
import { contabilizarAsiento } from '../src/main/servicios/motorAsientos';
import { crearItem, editarItem, desactivarItem, activarItem, listarItems } from '../src/main/servicios/catalogo';
import {
  crearCotizacion,
  crearRevision,
  aprobarCotizacion,
  lineasDeCotizacion,
  listarCotizaciones,
  generarHtmlCotizacion
} from '../src/main/servicios/cotizaciones';
import {
  crearContraparte,
  editarContraparte,
  cambiarEstadoContraparte,
  crearProyecto,
  registrarCompra,
  desactivarCuenta
} from '../src/main/servicios/operacion';

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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arkon-bloque1-'));
  rutaDb = path.join(dir, 'operativa.db');
  const db = abrir();
  db.prepare(
    "INSERT INTO ambito (id, nombre, tipo) VALUES ('administrativo', 'Prueba bloque 1', 'administrativo')"
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

describe('bloque 1: catálogo de servicios y materiales', () => {
  it('crea ítems sin precios inventados, edita, desactiva y reactiva sin borrar identidad', () => {
    const db = abrir();
    const item = crearItem(db, {
      tipo: 'servicio',
      codigo: 'SRV-001',
      nombre: 'Servicio sintético de instalación',
      unidad: 'jornada',
      responsable: 'p'
    });
    const listados = listarItems(db);
    expect(listados).toHaveLength(1);
    expect(listados[0]?.precioVentaMinor).toBeNull();
    expect(listados[0]?.precioCostoMinor).toBeNull();
    expect(listados[0]?.activo).toBe(true);

    editarItem(db, item, { nombre: 'Servicio sintético editado', precioVenta: '120.00', responsable: 'p' });
    const editado = listarItems(db)[0];
    expect(editado?.nombre).toBe('Servicio sintético editado');
    expect(editado?.precioVentaMinor).toBe('120.00');

    desactivarItem(db, item, 'p');
    expect(listarItems(db, true)).toHaveLength(0);
    expect(listarItems(db)).toHaveLength(1);
    expect(() => desactivarItem(db, item, 'p')).toThrow(/ya está inactivo/);
    activarItem(db, item, 'p');
    expect(listarItems(db, true)).toHaveLength(1);
    db.close();
  });

  it('cambiar un ítem del catálogo no modifica cotizaciones históricas', () => {
    const db = abrir();
    const cliente = crearContraparte(db, { nombre: 'Cliente Bloque1', esCliente: true, esProveedor: false, responsable: 'p' });
    const item = crearItem(db, { tipo: 'material', codigo: 'MAT-001', nombre: 'Material original', responsable: 'p' });
    const cot = crearCotizacion(db, {
      contraparteId: cliente,
      fecha: '2026-12-01',
      responsable: 'p',
      lineas: [
        { tipo: 'material', descripcion: 'Material original', cantidad: '2', precioUnitario: '10.00', precioConIva: false, tasa: '0', itemId: item }
      ]
    });
    editarItem(db, item, { nombre: 'Material renombrado', precioVenta: '99.00', responsable: 'p' });
    const lineas = lineasDeCotizacion(db, cot.id);
    expect(lineas[0]?.descripcion).toBe('Material original');
    expect(lineas[0]?.precioUnitarioMinor).toBe('10.00');
    expect(lineas[0]?.itemId).toBe(item);
    desactivarItem(db, item, 'p');
    const lineasTrasDesactivar = lineasDeCotizacion(db, cot.id);
    expect(lineasTrasDesactivar[0]?.itemId).toBe(item);
    db.close();
  });
});

describe('bloque 1: contrapartes y cuentas', () => {
  it('editar y desactivar contrapartes sin borrar identidades; bloqueo con documentos activos', () => {
    const db = abrir();
    const cliente = crearContraparte(db, { nombre: 'Cliente Original', esCliente: true, esProveedor: false, responsable: 'p' });
    editarContraparte(db, cliente, { nombre: 'Cliente Editado', nrc: '', nit: '', notas: 'nota sintética', responsable: 'p' });
    const fila = db.prepare('SELECT nombre, notas FROM contraparte WHERE id = ?').get(cliente) as { nombre: string; notas: string };
    expect(fila.nombre).toBe('Cliente Editado');
    expect(fila.notas).toBe('nota sintética');
    cambiarEstadoContraparte(db, cliente, false, 'p');
    const inactiva = db.prepare('SELECT activa FROM contraparte WHERE id = ?').get(cliente) as { activa: number };
    expect(inactiva.activa).toBe(0);
    cambiarEstadoContraparte(db, cliente, true, 'p');
    expect(() => cambiarEstadoContraparte(db, cliente, true, 'p')).toThrow(/ya está activa/);
    db.close();
  });

  it('desactivar cuentas sin movimientos se permite y con movimientos se rechaza', () => {
    const db = abrir();
    const id1101 = (db.prepare("SELECT id FROM cuenta WHERE codigo = '1101'").get() as { id: number }).id;
    contabilizarAsiento(db, {
      fechaOperacion: '2026-12-01',
      concepto: 'Movimiento sintético para bloquear desactivación',
      lineas: [
        { cuentaId: id1101, debeMinor: '10.00', haberMinor: '' },
        { cuentaId: (db.prepare("SELECT id FROM cuenta WHERE codigo = '3101'").get() as { id: number }).id, debeMinor: '', haberMinor: '10.00' }
      ],
      claveIdempotencia: 'asiento-bloqueo',
      responsable: 'p',
      ambitoId: 'administrativo'
    });
    const cuentaNueva = db
      .prepare("INSERT INTO cuenta (codigo, nombre, tipo, es_grupo) VALUES ('9999', 'Cuenta de prueba sintética', 'gasto', 0)")
      .run();
    desactivarCuenta(db, Number(cuentaNueva.lastInsertRowid), 'p');
    const fila = db.prepare('SELECT activa FROM cuenta WHERE codigo = ?').get('9999') as { activa: number };
    expect(fila.activa).toBe(0);
    const cuentaUsada = (db.prepare("SELECT id FROM cuenta WHERE codigo = '1101'").get() as { id: number }).id;
    expect(() => desactivarCuenta(db, cuentaUsada, 'p')).toThrow(/movimientos contables/);
    db.close();
  });
});

describe('bloque 1: aceptación de principio a fin (recorrido sintético persistente)', () => {
  it('cliente + ítem → cotizar → persistir → revisión → aprobar → documento → proyecto', () => {
    let db = abrir();
    const cliente = crearContraparte(db, { nombre: 'Cliente Aceptación', esCliente: true, esProveedor: false, responsable: 'p' });
    const item = crearItem(db, { tipo: 'servicio', codigo: 'SRV-ACE', nombre: 'Servicio de aceptación sintético', unidad: 'visita', responsable: 'p' });

    const cotOriginal = crearCotizacion(db, {
      contraparteId: cliente,
      fecha: '2026-12-01',
      condiciones: 'Condiciones sintéticas v1',
      responsable: 'p',
      lineas: [
        { tipo: 'servicio', descripcion: 'Servicio de aceptación sintético', cantidad: '1', precioUnitario: '100.00', precioConIva: false, tasa: '0', itemId: item }
      ]
    });
    expect(cotOriginal.numero).toBe('C-000001');

    db.close();
    db = abrir();

    const revision = crearRevision(db, cotOriginal.id, 'p');
    expect(revision.revision).toBe(2);
    aprobarCotizacion(db, revision.id, 'p');

    const listadas = listarCotizaciones(db);
    const aprobada = listadas.find(c => c.id === revision.id);
    const original = listadas.find(c => c.id === cotOriginal.id);
    expect(aprobada?.estado).toBe('aprobada');
    expect(aprobada?.congelada).toBe(true);
    expect(original?.estado).toBe('borrador');
    const lineasOriginal = lineasDeCotizacion(db, cotOriginal.id);
    expect(lineasOriginal[0]?.descripcion).toBe('Servicio de aceptación sintético');
    expect(lineasOriginal[0]?.totalMinor).toBe('100.00');

    const proyecto = crearProyecto(db, {
      codigo: 'PRJ-ACE',
      nombre: 'Proyecto de aceptación sintético',
      contraparteId: cliente,
      cotizacionId: revision.id,
      responsable: 'p'
    });
    expect(proyecto).toBeGreaterThan(0);

    const proveedor = crearContraparte(db, { nombre: 'Prov Aceptación', esCliente: false, esProveedor: true, responsable: 'p' });
    registrarCompra(db, {
      contraparteId: proveedor,
      proyectoId: proyecto,
      fechaOperacion: '2026-12-05',
      concepto: 'Compra con ítem del catálogo',
      condicion: 'credito',
      lineas: [
        { descripcion: 'Material de aceptación sintético', cuentaCodigo: '5101', cantidad: '1', precioUnitario: '5.00', tasa: '0', tratamiento: 'exento' }
      ],
      claveIdempotencia: 'c-ace',
      responsable: 'p'
    });

    const html = generarHtmlCotizacion(db, revision.id);
    expect(html).toContain('Cotización C-000002 · revisión 2');
    expect(html).toContain('Cliente Aceptación');
    expect(html).toContain('Servicio de aceptación sintético');
    expect(html).toContain('100.00');
    expect(html).toContain('Documento interno de control administrativo');
    expect(html).toContain('No es un documento tributario electrónico');
    expect(html).not.toContain('costo');
    expect(html).not.toContain('margen');

    const htmlOriginal = generarHtmlCotizacion(db, cotOriginal.id);
    expect(htmlOriginal).toContain('revisión 1');
    expect(htmlOriginal).toContain('Condiciones sintéticas v1');

    db.close();
    db = abrir();
    const bitacora = db
      .prepare("SELECT COUNT(*) AS n FROM bitacora_evento WHERE entidad IN ('cotizacion','item_catalogo','proyecto','compra')")
      .get() as { n: number };
    expect(bitacora.n).toBeGreaterThan(0);
    const proyectoPersistido = db.prepare('SELECT codigo FROM proyecto WHERE id = ?').get(proyecto) as { codigo: string };
    expect(proyectoPersistido.codigo).toBe('PRJ-ACE');
    db.close();
  });
});
