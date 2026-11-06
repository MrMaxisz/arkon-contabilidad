import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { abrirBase, prepararRutasDatos } from '../src/main/db/conexion';
import { aplicarMigraciones, versionEsquemaActual } from '../src/main/db/aplicarMigraciones';
import { migraciones } from '../src/main/db/migraciones';
import { sembrarCatalogoBase } from '../src/main/servicios/cuentas';
import { crearItem, desactivarItem } from '../src/main/servicios/catalogo';
import {
  crearCotizacion,
  crearRevision,
  aprobarCotizacion,
  lineasDeCotizacion,
  generarHtmlCotizacion,
  actualizarCotizacionBorrador
} from '../src/main/servicios/cotizaciones';
import { crearContraparte, editarContraparte, registrarCompra } from '../src/main/servicios/operacion';
import { registrarAdjunto, listarAdjuntos } from '../src/main/servicios/adjuntos';
import { crearRespaldo } from '../src/main/servicios/respaldo';
import { restaurarAdjuntosDesdeRespaldo } from '../src/main/servicios/restauracion';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arkon-rev20-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function baseConDatos(ruta: string): ReturnType<typeof abrirBase> {
  const db = abrirBase(ruta);
  aplicarMigraciones(db);
  db.prepare(
    "INSERT INTO ambito (id, nombre, tipo) VALUES ('administrativo', 'Prueba rev20', 'administrativo')"
  ).run();
  sembrarCatalogoBase(db, 'prueba');
  return db;
}

describe('vigésima revisión: referencia al catálogo en todas las rutas', () => {
  it('la revisión de una cotización conserva item_id', () => {
    const ruta = path.join(dir, 't1.db');
    const db = baseConDatos(ruta);
    const cliente = crearContraparte(db, { nombre: 'Cliente V20', esCliente: true, esProveedor: false, responsable: 'p' });
    const item = crearItem(db, { tipo: 'material', codigo: 'MAT-V20', nombre: 'Material sintético', responsable: 'p' });
    const cot = crearCotizacion(db, {
      contraparteId: cliente,
      fecha: '2026-12-01',
      responsable: 'p',
      lineas: [
        { tipo: 'material', descripcion: 'Material sintético', cantidad: '1', precioUnitario: '10.00', precioConIva: false, tasa: '0', itemId: item }
      ]
    });
    const rev = crearRevision(db, cot.id, 'p');
    const lineasRev = lineasDeCotizacion(db, rev.id);
    expect(lineasRev[0]?.itemId).toBe(item);
    db.close();
  });

  it('la compra persiste item_id y rechaza ítems inexistentes o inactivos', () => {
    const ruta = path.join(dir, 't2.db');
    const db = baseConDatos(ruta);
    const proveedor = crearContraparte(db, { nombre: 'Prov V20', esCliente: false, esProveedor: true, responsable: 'p' });
    const item = crearItem(db, { tipo: 'material', codigo: 'MAT-C1', nombre: 'Material compra', responsable: 'p' });
    const compra = registrarCompra(db, {
      contraparteId: proveedor,
      fechaOperacion: '2026-12-02',
      concepto: 'Compra con ítem',
      condicion: 'credito',
      lineas: [
        { descripcion: 'Material compra', cuentaCodigo: '5101', cantidad: '1', precioUnitario: '4.00', tasa: '0', tratamiento: 'exento', itemId: item }
      ],
      claveIdempotencia: 'c-v20',
      responsable: 'p'
    });
    const fila = db
      .prepare('SELECT item_id FROM compra_linea WHERE compra_id = ?')
      .get(compra.id) as { item_id: number | null };
    expect(fila.item_id).toBe(item);
    expect(() =>
      registrarCompra(db, {
        contraparteId: proveedor,
        fechaOperacion: '2026-12-03',
        concepto: 'Compra con ítem inexistente',
        condicion: 'credito',
        lineas: [
          { descripcion: 'x', cuentaCodigo: '5101', cantidad: '1', precioUnitario: '1.00', tasa: '0', tratamiento: 'exento', itemId: 999999 }
        ],
        claveIdempotencia: 'c-v20b',
        responsable: 'p'
      })
    ).toThrow(/inexistente o inactivo/);
    desactivarItem(db, item, 'p');
    expect(() =>
      registrarCompra(db, {
        contraparteId: proveedor,
        fechaOperacion: '2026-12-04',
        concepto: 'Compra con ítem inactivo',
        condicion: 'credito',
        lineas: [
          { descripcion: 'x', cuentaCodigo: '5101', cantidad: '1', precioUnitario: '1.00', tasa: '0', tratamiento: 'exento', itemId: item }
        ],
        claveIdempotencia: 'c-v20c',
        responsable: 'p'
      })
    ).toThrow(/inexistente o inactivo/);
    db.close();
  });

  it('abrir y guardar una cotización sin cambiar el ítem conserva la referencia', () => {
    const ruta = path.join(dir, 't3.db');
    const db = baseConDatos(ruta);
    const cliente = crearContraparte(db, { nombre: 'Cliente V20c', esCliente: true, esProveedor: false, responsable: 'p' });
    const item = crearItem(db, { tipo: 'servicio', codigo: 'SRV-C1', nombre: 'Servicio edición', responsable: 'p' });
    const cot = crearCotizacion(db, {
      contraparteId: cliente,
      fecha: '2026-12-01',
      responsable: 'p',
      lineas: [
        { tipo: 'servicio', descripcion: 'Servicio edición', cantidad: '1', precioUnitario: '25.00', precioConIva: false, tasa: '0', itemId: item }
      ]
    });
    const lineas = lineasDeCotizacion(db, cot.id);
    expect(lineas[0]?.itemId).toBe(item);
    actualizarCotizacionBorrador(db, cot.id, {
      lineas: lineas.map(l => ({
        tipo: l.tipo as 'servicio' | 'material',
        descripcion: l.descripcion,
        cantidad: l.cantidad,
        precioUnitario: l.precioUnitarioMinor,
        precioConIva: l.precioConIva,
        tasa: String(l.tasaPuntosBase / 100),
        itemId: l.itemId ?? undefined
      })),
      responsable: 'p'
    });
    const trasEditar = lineasDeCotizacion(db, cot.id);
    expect(trasEditar[0]?.itemId).toBe(item);
    expect(trasEditar[0]?.descripcion).toBe('Servicio edición');
    expect(trasEditar[0]?.precioUnitarioMinor).toBe('25.00');
    db.close();
  });
});

describe('vigésima revisión: documento aprobado inmutable', () => {
  it('editar el cliente después de aprobar no cambia el documento de la cotización aprobada', () => {
    const ruta = path.join(dir, 't4.db');
    const db = baseConDatos(ruta);
    const cliente = crearContraparte(db, { nombre: 'Cliente histórico sintético', esCliente: true, esProveedor: false, responsable: 'p' });
    const cot = crearCotizacion(db, {
      contraparteId: cliente,
      fecha: '2026-12-01',
      responsable: 'p',
      lineas: [
        { tipo: 'servicio', descripcion: 'Servicio sintético', cantidad: '1', precioUnitario: '50.00', precioConIva: false, tasa: '0' }
      ]
    });
    aprobarCotizacion(db, cot.id, 'p');
    const htmlAntes = generarHtmlCotizacion(db, cot.id);
    expect(htmlAntes).toContain('Cliente histórico sintético');
    editarContraparte(db, cliente, { nombre: 'Cliente renombrado sintético', responsable: 'p' });
    const htmlDespues = generarHtmlCotizacion(db, cot.id);
    expect(htmlDespues).toContain('Cliente histórico sintético');
    expect(htmlDespues).not.toContain('Cliente renombrado sintético');
    const nueva = crearCotizacion(db, {
      contraparteId: cliente,
      fecha: '2026-12-05',
      responsable: 'p',
      lineas: [
        { tipo: 'servicio', descripcion: 'Otro servicio', cantidad: '1', precioUnitario: '10.00', precioConIva: false, tasa: '0' }
      ]
    });
    const htmlNueva = generarHtmlCotizacion(db, nueva.id);
    expect(htmlNueva).toContain('Cliente renombrado sintético');
    db.close();
  });
});

describe('bloque 2: adjuntos y respaldo coordinado', () => {
  it('un adjunto se registra con hash, viaja en el respaldo y se restaura en un perfil limpio', async () => {
    const ruta = path.join(dir, 'operativa.db');
    const db = baseConDatos(ruta);
    const rutas = prepararRutasDatos(path.join(dir, 'datos'));

    const origen = path.join(dir, 'soporte-sintetico.txt');
    fs.writeFileSync(origen, 'contenido sintético del documento de respaldo', 'utf8');
    const adjunto = registrarAdjunto(db, rutas.adjuntos, {
      entidad: 'compra',
      entidadId: 'CMP-000001',
      nombreOriginal: 'soporte-sintetico.txt',
      rutaOrigen: origen,
      responsable: 'p'
    });
    expect(adjunto.hashSha256).toHaveLength(64);
    expect(fs.existsSync(path.join(rutas.adjuntos, adjunto.rutaRelativa))).toBe(true);
    const listados = listarAdjuntos(db, 'compra');
    expect(listados).toHaveLength(1);

    const info = await crearRespaldo(db, rutas.respaldos, 'prueba', rutas.adjuntos);
    const manifiesto = JSON.parse(fs.readFileSync(path.join(rutas.respaldos, `${info.nombre}.manifest.json`), 'utf8')) as {
      adjuntos: Array<{ rutaRelativa: string; hashSha256: string }>;
    };
    expect(manifiesto.adjuntos).toHaveLength(1);
    expect(manifiesto.adjuntos[0]?.hashSha256).toBe(adjunto.hashSha256);
    expect(fs.existsSync(path.join(rutas.respaldos, `${info.nombre}-adjuntos`, adjunto.rutaRelativa))).toBe(true);
    db.close();

    const dirDestino = path.join(dir, 'perfil-limpio');
    const rutasDestino = prepararRutasDatos(dirDestino);
    restaurarAdjuntosDesdeRespaldo(
      path.join(rutas.respaldos, info.nombre),
      rutasDestino.adjuntos,
      manifiesto.adjuntos
    );
    const restaurado = fs.readFileSync(path.join(rutasDestino.adjuntos, adjunto.rutaRelativa), 'utf8');
    expect(restaurado).toBe('contenido sintético del documento de respaldo');

    const manifiestoIncompleto = [{ rutaRelativa: 'no-existe.txt', hashSha256: 'x' }];
    expect(() =>
      restaurarAdjuntosDesdeRespaldo(path.join(rutas.respaldos, info.nombre), path.join(dir, 'destino-x'), manifiestoIncompleto)
    ).toThrow();
  });

  it('el respaldo previo a migración se crea al actualizar un esquema antiguo', async () => {
    const ruta = path.join(dir, 'previa.db');
    const dbVieja = abrirBase(ruta);
    dbVieja.exec('CREATE TABLE IF NOT EXISTS _migracion (version INTEGER PRIMARY KEY, nombre TEXT NOT NULL, aplicada_en TEXT NOT NULL DEFAULT (datetime(\'now\')))');
    for (const m of migraciones.filter(m => m.version <= 8)) {
      dbVieja.exec(m.sql);
      dbVieja.prepare('INSERT INTO _migracion (version, nombre) VALUES (?, ?)').run(m.version, m.nombre);
    }
    dbVieja.prepare("INSERT INTO ambito (id, nombre, tipo) VALUES ('administrativo', 'Previo', 'administrativo')").run();
    sembrarCatalogoBase(dbVieja, 'prueba');
    dbVieja.close();

    const rutas = prepararRutasDatos(path.join(dir, 'datos-previa'));
    const { crearContextoBase } = await import('../src/main/servicios/restauracion');
    const ctx = await crearContextoBase(rutas, ruta, 'prueba');
    const automaticos = fs
      .readdirSync(rutas.respaldos)
      .filter(f => f.startsWith('respaldo-previo-migracion-'));
    expect(automaticos.length).toBeGreaterThanOrEqual(1);
    const manifiesto = JSON.parse(
      fs.readFileSync(path.join(rutas.respaldos, `${automaticos[0]}.manifest.json`), 'utf8')
    ) as { versionEsquema: number; nota: string };
    expect(manifiesto.versionEsquema).toBe(8);
    expect(manifiesto.nota).toContain('previo a migración');
    const versionTrasMigrar = ctx.db
      .prepare('SELECT MAX(version) AS v FROM _migracion')
      .get() as { v: number };
    expect(versionTrasMigrar.v).toBe(versionEsquemaActual());
    ctx.db.close();
  });
});
