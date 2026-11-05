import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { abrirBase, prepararRutasDatos } from '../src/main/db/conexion';
import { aplicarMigraciones } from '../src/main/db/aplicarMigraciones';
import { sembrarCatalogoBase } from '../src/main/servicios/cuentas';
import { crearRespaldo, adquirirOperacionRespaldo, liberarOperacionRespaldo } from '../src/main/servicios/respaldo';
import { respaldoPeriodicoSiCorresponde, manejarRestauracion } from '../src/main/servicios/restauracion';
import { despachar } from '../src/main/comandos';
import { registrarAjuste, exportarCsvAuxiliar, auxiliarContraparteDetalle } from '../src/main/servicios/fiscal';
import { crearContraparte, registrarVenta, registrarCompra } from '../src/main/servicios/operacion';
import { registrarCobro } from '../src/main/servicios/tesoreria';

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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arkon-a29-'));
  rutas = prepararRutasDatos(path.join(dir, 'datos'));
  rutaDb = path.join(rutas.datos, 'op.db');
  const db = abrir();
  db.prepare("INSERT INTO ambito (id, nombre, tipo) VALUES ('administrativo', 'Prueba a29', 'administrativo')").run();
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

function idCuenta(db: ReturnType<typeof abrirBase>, codigo: string): number {
  return (db.prepare('SELECT id FROM cuenta WHERE codigo = ?').get(codigo) as { id: number }).id;
}

describe('auditoría 29: coordinador único de respaldo/restauración', () => {
  it('manual en curso bloquea automática y restauración', async () => {
    const ctx = contexto();
    ctx.db.prepare("UPDATE configuracion SET valor = '60' WHERE clave = 'respaldo_intervalo_minutos'").run();
    adquirirOperacionRespaldo();
    const automatico = await respaldoPeriodicoSiCorresponde(ctx);
    expect(automatico.creado).toBe(false);
    expect(automatico.omitidoPor).toContain('en curso');
    await expect(manejarRestauracion(ctx, 'respaldo-inexistente.db')).rejects.toThrow(/en curso/);
    liberarOperacionRespaldo();
    const trasLiberar = await respaldoPeriodicoSiCorresponde(ctx);
    expect(trasLiberar.omitidoPor ?? '').not.toContain('en curso');
    ctx.db.close();
    const idx = abiertas.findIndex(d => !d.open);
    if (idx >= 0) {
      abiertas.splice(idx, 1);
    }
  });

  it('automática en curso bloquea manual', async () => {
    const ctx = contexto();
    ctx.db.prepare("UPDATE configuracion SET valor = '60' WHERE clave = 'respaldo_intervalo_minutos'").run();
    adquirirOperacionRespaldo();
    await expect(crearRespaldo(ctx.db, rutas.respaldos, 'prueba', rutas.adjuntos)).rejects.toThrow(/en curso/);
    liberarOperacionRespaldo();
    const manual = await crearRespaldo(ctx.db, rutas.respaldos, 'prueba', rutas.adjuntos);
    expect(manual.nombre).toBeTruthy();
    ctx.db.close();
    const idx = abiertas.findIndex(d => !d.open);
    if (idx >= 0) {
      abiertas.splice(idx, 1);
    }
  });
});

describe('auditoría 29: ajustes con idempotencia y validación', () => {
  it('registrarAjuste crea asiento cuadrado con idempotencia; descuadrado se rechaza', () => {
    const ctx = contexto();
    const ajuste = registrarAjuste(ctx.db, {
      fechaOperacion: '2026-12-15',
      concepto: 'Ajuste sintético de apertura',
      lineas: [
        { cuentaCodigo: '1101', debeMinor: '50.00', haberMinor: '' },
        { cuentaCodigo: '3101', debeMinor: '', haberMinor: '50.00' }
      ],
      referencia: 'soporte sintético de ajuste',
      claveIdempotencia: 'aj-001',
      responsable: 'p'
    });
    expect(ajuste.folio).toBeTruthy();
    expect(ajuste.duplicado).toBe(false);
    const duplicado = registrarAjuste(ctx.db, {
      fechaOperacion: '2026-12-15',
      concepto: 'Ajuste sintético de apertura',
      lineas: [
        { cuentaCodigo: '1101', debeMinor: '50.00', haberMinor: '' },
        { cuentaCodigo: '3101', debeMinor: '', haberMinor: '50.00' }
      ],
      referencia: 'soporte sintético de ajuste',
      claveIdempotencia: 'aj-001',
      responsable: 'p'
    });
    expect(duplicado.duplicado).toBe(true);
    expect(() =>
      registrarAjuste(ctx.db, {
        fechaOperacion: '2026-12-15',
        concepto: 'Descuadrado',
        lineas: [
          { cuentaCodigo: '1101', debeMinor: '10.00', haberMinor: '' },
          { cuentaCodigo: '3101', debeMinor: '', haberMinor: '5.00' }
        ],
        referencia: 'soporte sintético de ajuste',
        claveIdempotencia: 'aj-002',
        responsable: 'p'
      })
    ).toThrow(/descuadrado/);
    const evento = ctx.db
      .prepare("SELECT COUNT(*) AS n FROM bitacora_evento WHERE tipo = 'ajuste_registrado'")
      .get() as { n: number };
    expect(evento.n).toBe(1);
    ctx.db.close();
    const idx = abiertas.findIndex(d => !d.open);
    if (idx >= 0) {
      abiertas.splice(idx, 1);
    }
  });

  it('ajuste desde despachar persiste tras reabrir y afecta auxiliares', () => {
    const ctx = contexto();
    const resultado = despachar(ctx, 'ajuste:registrar', {
      fechaOperacion: '2026-12-15',
      concepto: 'Ajuste desde despachar',
      lineas: [
        { cuentaCodigo: '1101', debeMinor: '25.00', haberMinor: '' },
        { cuentaCodigo: '3101', debeMinor: '', haberMinor: '25.00' }
      ],
      referencia: 'soporte sintético desde despachar',
      claveIdempotencia: 'aj-desp',
      responsable: 'p'
    }) as { folio: string; duplicado: boolean };
    expect(resultado.duplicado).toBe(false);
    ctx.db.close();
    const idx = abiertas.findIndex(d => !d.open);
    if (idx >= 0) {
      abiertas.splice(idx, 1);
    }
    const ctxReabierto = contexto();
    const caja = ctxReabierto.db
      .prepare("SELECT COALESCE(SUM(l.debe_minor - l.haber_minor), 0) AS s FROM asiento_linea l JOIN asiento a ON a.id = l.asiento_id JOIN cuenta c ON c.id = l.cuenta_id WHERE c.codigo = '1101' AND a.estado IN ('contabilizado','anulado')")
      .get() as { s: number };
    expect(caja.s).toBe(2500);
    const duplicadoDespacho = despachar(ctxReabierto, 'ajuste:registrar', {
      fechaOperacion: '2026-12-15',
      concepto: 'Ajuste desde despachar',
      lineas: [
        { cuentaCodigo: '1101', debeMinor: '25.00', haberMinor: '' },
        { cuentaCodigo: '3101', debeMinor: '', haberMinor: '25.00' }
      ],
      referencia: 'soporte sintético desde despachar',
      claveIdempotencia: 'aj-desp',
      responsable: 'p'
    }) as { duplicado: boolean };
    expect(duplicadoDespacho.duplicado).toBe(true);
    ctxReabierto.db.close();
    const idx2 = abiertas.findIndex(d => !d.open);
    if (idx2 >= 0) {
      abiertas.splice(idx2, 1);
    }
  });
});

describe('auditoría 29: auxiliar con detalle, corte temporal y exportación', () => {
  it('detalle por documento con corte temporal refleja aplicaciones y anticipos', () => {
    const ctx = contexto();
    const cliente = crearContraparte(ctx.db, { nombre: 'Cliente Detalle', esCliente: true, esProveedor: false, responsable: 'p' });
    const venta1 = registrarVenta(ctx.db, {
      contraparteId: cliente,
      fechaOperacion: '2026-12-01',
      concepto: 'Venta uno',
      tipoIngreso: 'instalaciones',
      base: '100.00',
      tasa: '0',
      claveIdempotencia: 'v-det1',
      responsable: 'p'
    });
    const venta2 = registrarVenta(ctx.db, {
      contraparteId: cliente,
      fechaOperacion: '2026-12-10',
      concepto: 'Venta dos',
      tipoIngreso: 'oym',
      base: '50.00',
      tasa: '0',
      claveIdempotencia: 'v-det2',
      responsable: 'p'
    });
    registrarCobro(ctx.db, {
      fechaOperacion: '2026-12-05',
      contraparteId: cliente,
      cuentaDestinoId: idCuenta(ctx.db, '1101'),
      monto: '60.00',
      concepto: 'Cobro parcial',
      aplicaciones: [{ documentoTipo: 'venta', documentoId: venta1.id, monto: '60.00' }],
      claveIdempotencia: 'cob-det',
      responsable: 'p'
    });

    const detalleCompleto = auxiliarContraparteDetalle(ctx.db, 'cliente', cliente);
    expect(detalleCompleto.documentos).toHaveLength(2);
    const doc1 = detalleCompleto.documentos.find(d => d.folio === 'V-000001');
    expect(doc1?.totalMinor).toBe('100.00');
    expect(doc1?.aplicadoMinor).toBe('60.00');
    expect(doc1?.saldoMinor).toBe('40.00');
    const doc2 = detalleCompleto.documentos.find(d => d.folio === 'V-000002');
    expect(doc2?.saldoMinor).toBe('50.00');
    expect(detalleCompleto.saldoMinor).toBe('90.00');

    const detalleCorte = auxiliarContraparteDetalle(ctx.db, 'cliente', cliente, '2026-12-05');
    expect(detalleCorte.documentos).toHaveLength(1);
    expect(detalleCorte.saldoMinor).toBe('40.00');
    ctx.db.close();
    const idx = abiertas.findIndex(d => !d.open);
    if (idx >= 0) {
      abiertas.splice(idx, 1);
    }
  });

  it('exportarCsvAuxiliar produce contenido correcto desde el mismo modelo', () => {
    const ctx = contexto();
    const cliente = crearContraparte(ctx.db, { nombre: 'Cliente Export', esCliente: true, esProveedor: false, responsable: 'p' });
    registrarVenta(ctx.db, {
      contraparteId: cliente,
      fechaOperacion: '2026-12-01',
      concepto: 'Venta export',
      tipoIngreso: 'instalaciones',
      base: '75.00',
      tasa: '0',
      claveIdempotencia: 'v-exp',
      responsable: 'p'
    });
    const csv = exportarCsvAuxiliar(ctx.db, 'cliente');
    expect(csv.version).toBe('auxiliar-interno-v1');
    expect(csv.csv).toContain('cliente,saldo');
    expect(csv.csv).toContain('"Cliente Export",75.00');
    expect(csv.csv).toContain('TOTAL,75.00');

    const csvEfectivo = exportarCsvAuxiliar(ctx.db, 'efectivo');
    expect(csvEfectivo.csv).toContain('cuenta,nombre,saldo');
    ctx.db.close();
    const idx = abiertas.findIndex(d => !d.open);
    if (idx >= 0) {
      abiertas.splice(idx, 1);
    }
  });
});
