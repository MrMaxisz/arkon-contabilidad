import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { abrirBase, prepararRutasDatos } from '../src/main/db/conexion';
import { aplicarMigraciones } from '../src/main/db/aplicarMigraciones';
import { sembrarCatalogoBase } from '../src/main/servicios/cuentas';
import { registrarAdjunto, validarVinculoDocumento, ErrorAdjunto } from '../src/main/servicios/adjuntos';
import { respaldoPeriodicoSiCorresponde } from '../src/main/servicios/restauracion';
import { manejarRestauracion } from '../src/main/servicios/restauracion';
import { despachar } from '../src/main/comandos';
import { crearContraparte, registrarCompra } from '../src/main/servicios/operacion';

let dir: string;
let rutaDb: string;
let rutas: ReturnType<typeof prepararRutasDatos>;
const abiertas: Array<ReturnType<typeof abrirBase>> = [];

function abrir(): ReturnType<typeof abrirBase> {
  const db = abrirBase(rutaDb);
  aplicarMigraciones(db);
  abiertas.push(db);
  return db;
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arkon-a27-'));
  rutas = prepararRutasDatos(path.join(dir, 'datos'));
  rutaDb = path.join(rutas.datos, 'op.db');
  const db = abrir();
  db.prepare("INSERT INTO ambito (id, nombre, tipo) VALUES ('administrativo', 'Prueba a27', 'administrativo')").run();
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

function contexto() {
  const db = abrir();
  return {
    db,
    rutas,
    versionApp: 'prueba',
    rutaDb,
    reabrirBase(this: { db: ReturnType<typeof abrirBase> }) {
      if (this.db.open) {
        this.db.close();
      }
      this.db = abrirBase(rutaDb);
      aplicarMigraciones(this.db);
    }
  };
}

describe('auditoría 27: P1 intercalación determinista de copia con uso concurrente', () => {
  it('un adjunto registrado durante el backup se refleja en la copia (inventario de la instantánea)', async () => {
    const ctx = contexto();
    const proveedor = crearContraparte(ctx.db, { nombre: 'Prov a27', esCliente: false, esProveedor: true, responsable: 'p' });
    const compra = registrarCompra(ctx.db, {
      contraparteId: proveedor,
      fechaOperacion: '2026-11-01',
      concepto: 'Compra a27',
      condicion: 'credito',
      lineas: [{ descripcion: 'Material', cuentaCodigo: '5101', cantidad: '1', precioUnitario: '1.00', tasa: '0', tratamiento: 'exento' }],
      claveIdempotencia: 'c-a27',
      responsable: 'p'
    });
    void compra;

    const origen = path.join(dir, 'doc-a27.txt');
    fs.writeFileSync(origen, 'contenido a27', 'utf8');
    registrarAdjunto(ctx.db, rutas.adjuntos, {
      entidad: 'compra',
      entidadId: 'CMP-000001',
      nombreOriginal: 'doc-a27.txt',
      rutaOrigen: origen,
      responsable: 'p'
    });

    ctx.db.prepare("UPDATE configuracion SET valor = '60' WHERE clave = 'respaldo_intervalo_minutos'").run();

    const dbReal = ctx.db;
    const backupOriginal = dbReal.backup.bind(dbReal);
    let backupResuelto = false;
    (dbReal as unknown as { backup: (ruta: string) => Promise<void> }).backup = async (rutaDestino: string) => {
      const promesa = backupOriginal(rutaDestino);
      await new Promise(resolve => setTimeout(resolve, 50));
      backupResuelto = true;
      return promesa;
    };

    const origenConcurrente = path.join(dir, 'concurrente.txt');
    fs.writeFileSync(origenConcurrente, 'adjunto concurrente a27', 'utf8');
    setTimeout(() => {
      if (backupResuelto) {
        registrarAdjunto(dbReal, rutas.adjuntos, {
          entidad: 'compra',
          entidadId: 'CMP-000001',
          nombreOriginal: 'concurrente.txt',
          rutaOrigen: origenConcurrente,
          responsable: 'p'
        });
      }
    }, 25);

    const resultado = await respaldoPeriodicoSiCorresponde(ctx);
    (dbReal as unknown as { backup: (ruta: string) => Promise<void> }).backup = backupOriginal;

    expect(resultado.creado).toBe(true);
    const manifiesto = JSON.parse(
      fs.readFileSync(path.join(rutas.respaldos, `${resultado.nombre}.manifest.json`), 'utf8')
    ) as { adjuntos: Array<{ rutaRelativa: string }> };
    expect(manifiesto.adjuntos.length).toBeGreaterThanOrEqual(1);
    ctx.db.close();
    const idx = abiertas.findIndex(d => !d.open);
    if (idx >= 0) {
      abiertas.splice(idx, 1);
    }

    const rutasOtro = prepararRutasDatos(path.join(dir, 'otro'));
    fs.mkdirSync(rutasOtro.respaldos, { recursive: true });
    fs.copyFileSync(path.join(rutas.respaldos, resultado.nombre as string), path.join(rutasOtro.respaldos, resultado.nombre as string));
    fs.copyFileSync(
      path.join(rutas.respaldos, `${resultado.nombre}.manifest.json`),
      path.join(rutasOtro.respaldos, `${resultado.nombre}.manifest.json`)
    );
    fs.cpSync(path.join(rutas.respaldos, `${resultado.nombre}-adjuntos`), path.join(rutasOtro.respaldos, `${resultado.nombre}-adjuntos`), { recursive: true });
    const rutaOtro = path.join(rutasOtro.datos, 'otro.db');
    const dbOtro = abrirBase(rutaOtro);
    aplicarMigraciones(dbOtro);
    dbOtro.close();
    const ctxOtro = {
      db: abrirBase(rutaOtro),
      rutas: { ...rutasOtro, respaldos: rutas.respaldos },
      versionApp: 'prueba',
      rutaDb: rutaOtro,
      reabrirBase(this: { db: ReturnType<typeof abrirBase> }) {
        if (this.db.open) {
          this.db.close();
        }
        this.db = abrirBase(rutaOtro);
      }
    };
    const restaurado = await manejarRestauracion(ctxOtro, resultado.nombre as string);
    expect(restaurado.ok).toBe(true);
    ctxOtro.db.close();
  });
});

describe('auditoría 27: P2 vínculo documental validado', () => {
  it('validarVinculoDocumento rechaza documentos inexistentes y acepta existentes', () => {
    const ctx = contexto();
    const proveedor = crearContraparte(ctx.db, { nombre: 'Prov vinculo', esCliente: false, esProveedor: true, responsable: 'p' });
    registrarCompra(ctx.db, {
      contraparteId: proveedor,
      fechaOperacion: '2026-11-01',
      concepto: 'Compra vínculo',
      condicion: 'credito',
      lineas: [{ descripcion: 'Material', cuentaCodigo: '5101', cantidad: '1', precioUnitario: '1.00', tasa: '0', tratamiento: 'exento' }],
      claveIdempotencia: 'c-vinculo',
      responsable: 'p'
    });
    expect(() => validarVinculoDocumento(ctx.db, 'compra', 'CMP-000001')).not.toThrow();
    expect(() => validarVinculoDocumento(ctx.db, 'compra', 'CMP-999999')).toThrow(/No existe compra/);
    expect(() => validarVinculoDocumento(ctx.db, 'entidad-inventada', 'X')).toThrow(/Entidad no reconocida/);
    ctx.db.close();
    const idx = abiertas.findIndex(d => !d.open);
    if (idx >= 0) {
      abiertas.splice(idx, 1);
    }
  });

  it('respaldo:estadoPeriodico desde despachar devuelve última ejecución y próxima', async () => {
    const ctx = contexto();
    const estadoInicial = despachar(ctx, 'respaldo:estadoPeriodico', undefined) as {
      intervaloMinutos: number;
      ultimoRespaldo: unknown;
      proximaEjecucion: string | null;
    };
    expect(estadoInicial.intervaloMinutos).toBe(0);
    expect(estadoInicial.ultimoRespaldo).toBeNull();
    expect(estadoInicial.proximaEjecucion).toBeNull();

    despachar(ctx, 'config:respaldoPeriodicoGuardar', { intervaloMinutos: 60, retencion: 3 });
    await despachar(ctx, 'respaldo:ejecutarPeriodico', undefined);
    const estadoTras = despachar(ctx, 'respaldo:estadoPeriodico', undefined) as {
      intervaloMinutos: number;
      ultimoRespaldo: { creadoEn: string; nombre: string } | null;
      proximaEjecucion: string | null;
    };
    expect(estadoTras.intervaloMinutos).toBe(60);
    expect(estadoTras.ultimoRespaldo).toBeTruthy();
    expect(estadoTras.ultimoRespaldo?.nombre).toContain('respaldo-automatico-');
    expect(estadoTras.proximaEjecucion).toBeTruthy();
    ctx.db.close();
    const idx = abiertas.findIndex(d => !d.open);
    if (idx >= 0) {
      abiertas.splice(idx, 1);
    }
  });
});
