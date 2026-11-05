import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { abrirBase, prepararRutasDatos } from '../src/main/db/conexion';
import { aplicarMigraciones, versionEsquemaActual } from '../src/main/db/aplicarMigraciones';
import { migraciones } from '../src/main/db/migraciones';
import { sembrarCatalogoBase } from '../src/main/servicios/cuentas';
import { crearContraparte, editarContraparte, registrarCompra } from '../src/main/servicios/operacion';
import { registrarAdjunto } from '../src/main/servicios/adjuntos';
import { crearRespaldo, descubrirRespaldos } from '../src/main/servicios/respaldo';
import { crearContextoBase, manejarRestauracion } from '../src/main/servicios/restauracion';
import { despachar } from '../src/main/comandos';
import { crearCotizacion, aprobarCotizacion, generarHtmlCotizacion } from '../src/main/servicios/cotizaciones';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arkon-rev21-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function baseV9(ruta: string): ReturnType<typeof abrirBase> {
  const db = abrirBase(ruta);
  db.exec('CREATE TABLE IF NOT EXISTS _migracion (version INTEGER PRIMARY KEY, nombre TEXT NOT NULL, aplicada_en TEXT NOT NULL DEFAULT (datetime(\'now\')))');
  for (const m of migraciones.filter(m => m.version <= 9)) {
    db.exec(m.sql);
    db.prepare('INSERT INTO _migracion (version, nombre) VALUES (?, ?)').run(m.version, m.nombre);
  }
  db.prepare("INSERT INTO ambito (id, nombre, tipo) VALUES ('administrativo', 'Prueba rev21', 'administrativo')").run();
  sembrarCatalogoBase(db, 'prueba');
  return db;
}

describe('vigesimaprimera revisión: recuperación desde los flujos reales', () => {
  it('la copia previa a migración se descubre y se restaura por el flujo de la aplicación', async () => {
    const ruta = path.join(dir, 'operativa.db');
    const db = baseV9(ruta);
    const proveedor = crearContraparte(db, { nombre: 'Prov R21', esCliente: false, esProveedor: true, responsable: 'p' });
    registrarCompra(db, {
      contraparteId: proveedor,
      fechaOperacion: '2026-12-01',
      concepto: 'Compra antes de migrar',
      condicion: 'credito',
      lineas: [{ descripcion: 'Material', cuentaCodigo: '5101', cantidad: '1', precioUnitario: '7.00', tasa: '0', tratamiento: 'exento' }],
      claveIdempotencia: 'c-r21',
      responsable: 'p'
    });
    db.close();

    const rutas = prepararRutasDatos(path.join(dir, 'datos'));
    const ctx = await crearContextoBase(rutas, ruta, 'prueba');
    const copias = descubrirRespaldos(rutas.respaldos);
    expect(copias.length).toBeGreaterThanOrEqual(1);
    const previa = copias.find(c => c.nombre.startsWith('respaldo-previo-migracion-'));
    expect(previa).toBeTruthy();
    const manifiesto = JSON.parse(fs.readFileSync(path.join(rutas.respaldos, `${previa?.nombre}.manifest.json`), 'utf8')) as { hashSha256: string; versionEsquema: number };
    expect(manifiesto.hashSha256).toHaveLength(64);
    expect(manifiesto.versionEsquema).toBe(9);

    const ctxRestauracion = await crearContextoBase(rutas, ruta, 'prueba');
    const resultado = manejarRestauracion(ctxRestauracion, previa!.nombre);
    expect(resultado.ok).toBe(true);
    const compraPrevia = ctxRestauracion.db
      .prepare("SELECT COUNT(*) AS n FROM compra WHERE clave_idempotencia = 'c-r21'")
      .get() as { n: number };
    expect(compraPrevia.n).toBe(1);
    ctxRestauracion.db.close();
    ctx.db.close();
  });

  it('el comando respaldo:crear incluye adjuntos y manejarRestauracion recupera base y adjuntos; paquete alterado se rechaza íntegro', async () => {
    const ruta = path.join(dir, 'operativa2.db');
    const db = abrirBase(ruta);
    aplicarMigraciones(db);
    db.prepare("INSERT INTO ambito (id, nombre, tipo) VALUES ('administrativo', 'Prueba rev21b', 'administrativo')").run();
    sembrarCatalogoBase(db, 'prueba');
    const rutas = prepararRutasDatos(path.join(dir, 'datos2'));

    const origen = path.join(dir, 'factura-sintetica.txt');
    fs.writeFileSync(origen, 'contenido sintético verificable', 'utf8');
    const adjunto = registrarAdjunto(db, rutas.adjuntos, {
      entidad: 'compra',
      entidadId: 'CMP-000001',
      nombreOriginal: 'factura-sintetica.txt',
      rutaOrigen: origen,
      responsable: 'p'
    });
    const ctx = { db, rutas, versionApp: 'prueba', rutaDb: ruta, reabrirBase() { this.db = abrirBase(ruta); } };
    await despachar(ctx, 'respaldo:crear', undefined) as { nombre: string };
    const copias = descubrirRespaldos(rutas.respaldos);
    expect(copias.length).toBe(1);
    const manifiesto = JSON.parse(fs.readFileSync(path.join(rutas.respaldos, `${copias[0].nombre}.manifest.json`), 'utf8')) as { adjuntos: Array<{ rutaRelativa: string }> };
    expect(manifiesto.adjuntos).toHaveLength(1);
    db.close();

    const rutasDestino = prepararRutasDatos(path.join(dir, 'perfil-limpio'));
    const rutaDestinoDb = path.join(rutasDestino.datos, 'operativa2.db');
    const dbDestino = abrirBase(rutaDestinoDb);
    aplicarMigraciones(dbDestino);
    dbDestino.close();
    const ctxLimpio = {
      db: abrirBase(rutaDestinoDb),
      rutas: { ...rutasDestino, respaldos: rutas.respaldos },
      versionApp: 'prueba',
      rutaDb: rutaDestinoDb,
      reabrirBase() {
        if (this.db.open) {
          this.db.close();
        }
        this.db = abrirBase(rutaDestinoDb);
      }
    };
    const resultado = manejarRestauracion(ctxLimpio, copias[0].nombre);
    expect(resultado.ok).toBe(true);
    const adjuntosRestaurados = ctxLimpio.db.prepare('SELECT COUNT(*) AS n FROM adjunto').get() as { n: number };
    expect(adjuntosRestaurados.n).toBe(1);
    const archivoRestaurado = fs.readFileSync(path.join(rutasDestino.adjuntos, adjunto.rutaRelativa), 'utf8');
    expect(archivoRestaurado).toBe('contenido sintético verificable');
    ctxLimpio.db.close();

    fs.appendFileSync(path.join(rutas.respaldos, `${copias[0].nombre}-adjuntos`, adjunto.rutaRelativa), 'alterado');
    const rutasDestino2 = prepararRutasDatos(path.join(dir, 'perfil-limpio-2'));
    const rutaDestinoDb2 = path.join(rutasDestino2.datos, 'operativa2.db');
    const dbDestino2 = abrirBase(rutaDestinoDb2);
    aplicarMigraciones(dbDestino2);
    dbDestino2.close();
    const ctxLimpio2 = {
      db: abrirBase(rutaDestinoDb2),
      rutas: { ...rutasDestino2, respaldos: rutas.respaldos },
      versionApp: 'prueba',
      rutaDb: rutaDestinoDb2,
      reabrirBase() {
        if (this.db.open) {
          this.db.close();
        }
        this.db = abrirBase(rutaDestinoDb2);
      }
    };
    const adjuntosAntes = fs.existsSync(rutasDestino2.adjuntos) ? fs.readdirSync(rutasDestino2.adjuntos) : [];
    expect(() => manejarRestauracion(ctxLimpio2, copias[0].nombre)).toThrow(/no coincide con el hash/);
    const adjuntosDespues = fs.readdirSync(rutasDestino2.adjuntos);
    expect(adjuntosDespues).toEqual(adjuntosAntes);
    ctxLimpio2.db.close();
  });

  it('la retención cuenta paquetes completos y se aplica tras la copia previa', async () => {
    const rutas = prepararRutasDatos(path.join(dir, 'datos3'));
    for (let i = 1; i <= 4; i++) {
      const nombre = `respaldo-previo-migracion-2026-11-04T00-00-0${i}Z.db`;
      const ruta = path.join(rutas.respaldos, nombre);
      fs.writeFileSync(ruta, `base sintetica ${i}`);
      fs.writeFileSync(`${ruta}.manifest.json`, JSON.stringify({ nombre, hashSha256: 'x'.repeat(64) }));
      fs.mkdirSync(`${ruta}-adjuntos`);
    }
    const rutaDb = path.join(rutas.datos, 'operativa3.db');
    const db = baseV9(rutaDb);
    db.prepare("INSERT INTO configuracion (clave, valor) VALUES ('respaldo_retencion_automatica', '2')").run();
    db.close();
    const ctx = await crearContextoBase(rutas, rutaDb, 'prueba');
    const bases = fs.readdirSync(rutas.respaldos).filter(f => f.startsWith('respaldo-previo-migracion-') && f.endsWith('.db'));
    expect(bases.length).toBeLessThanOrEqual(3);
    for (const base of bases) {
      expect(fs.existsSync(path.join(rutas.respaldos, `${base}.manifest.json`))).toBe(true);
    }
    ctx.db.close();
  });
});

describe('vigesimaprimera revisión: documentos heredados', () => {
  it('una cotización aprobada en v9 recibe instantánea al migrar y no cambia al editar el cliente', () => {
    const ruta = path.join(dir, 'operativa4.db');
    const db = baseV9(ruta);
    const cliente = crearContraparte(db, { nombre: 'Cliente heredado sintético', esCliente: true, esProveedor: false, responsable: 'p' });
    const cot = crearCotizacion(db, {
      contraparteId: cliente,
      fecha: '2026-12-01',
      responsable: 'p',
      lineas: [
        { tipo: 'servicio', descripcion: 'Servicio heredado', cantidad: '1', precioUnitario: '40.00', precioConIva: false, tasa: '0' }
      ]
    });
    db.prepare("UPDATE cotizacion SET estado = 'aprobada', congelada = 1 WHERE id = ?").run(cot.id);
    db.close();

    const dbMigrada = abrirBase(ruta);
    aplicarMigraciones(dbMigrada);
    aplicarMigraciones(dbMigrada);
    const snapshot = dbMigrada
      .prepare('SELECT cliente_snapshot FROM cotizacion WHERE id = ?')
      .get(cot.id) as { cliente_snapshot: string | null };
    expect(snapshot.cliente_snapshot).toBe('Cliente heredado sintético');
    editarContraparte(dbMigrada, cliente, { nombre: 'Cliente heredado renombrado', responsable: 'p' });
    const html = generarHtmlCotizacion(dbMigrada, cot.id);
    expect(html).toContain('Cliente heredado sintético');
    expect(html).not.toContain('Cliente heredado renombrado');
    dbMigrada.close();
  });
});
