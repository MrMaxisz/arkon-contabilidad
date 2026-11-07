import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { abrirBase, prepararRutasDatos } from '../src/main/db/conexion';
import { aplicarMigraciones } from '../src/main/db/aplicarMigraciones';
import { sembrarCatalogoBase } from '../src/main/servicios/cuentas';
import { contabilizarAsiento, periodoDeFecha } from '../src/main/servicios/motorAsientos';
import { estadoSituacionFinanciera, type BalanceResumen, type SaldoCuenta } from '../src/main/servicios/estadosFinancieros';
import { construirHtmlReporte } from '../src/main/servicios/reportesPdf';
import type { PartidaResumen, PartidaDetalle } from '../src/main/servicios/libroDiario';
import { despachar, type ContextoApp } from '../src/main/comandos';
import type BetterSqlite3 from 'better-sqlite3';

// Cierre del bloque 2: correcciones sobre la base 5194955.
// TODOS los importes esperados están calculados A MANO en esta prueba.

let dir: string;
let rutaDb: string;
let rutas: ReturnType<typeof prepararRutasDatos>;
let db: BetterSqlite3.Database;
let ctx: ContextoApp;
const abiertas: Array<BetterSqlite3.Database> = [];

function idCuenta(codigo: string): number {
  return (db.prepare('SELECT id FROM cuenta WHERE codigo = ?').get(codigo) as { id: number }).id;
}

function partida(
  fecha: string,
  concepto: string,
  lineas: Array<{ codigo: string; debe: string; haber: string }>,
  clave: string
): number {
  const resultado = contabilizarAsiento(db, {
    fechaOperacion: fecha,
    concepto,
    responsable: 'qa',
    ambitoId: 'administrativo',
    lineas: lineas.map(l => ({
      cuentaId: idCuenta(l.codigo),
      debeMinor: l.debe,
      haberMinor: l.haber
    })),
    claveIdempotencia: clave
  });
  return (db.prepare('SELECT id FROM asiento WHERE folio = ?').get(resultado.folio) as { id: number }).id;
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arkon-cb2-'));
  rutas = prepararRutasDatos(path.join(dir, 'datos'));
  rutaDb = path.join(rutas.datos, 'op.db');
  db = abrirBase(rutaDb);
  abiertas.push(db);
  aplicarMigraciones(db);
  sembrarCatalogoBase(db);
  db.prepare("INSERT INTO ambito (id, nombre, tipo) VALUES ('administrativo', 'Prueba cierre bloque 2', 'administrativo')").run();
  ctx = {
    db,
    rutas,
    versionApp: 'prueba',
    rutaDb,
    reabrirBase() {
      return;
    }
  };
});

afterEach(() => {
  for (const base of abiertas.splice(0)) {
    if (base.open) {
      base.close();
    }
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('cierre bloque 2, P1: Ver en libro diario funciona (identificadores number por IPC)', () => {
  it('el id de la partida llega como number y el canal libro:partida lo acepta de ida y vuelta', () => {
    const id = partida(
      '2026-01-10',
      'Partida a ver sintética',
      [
        { codigo: '1101', debe: '60.00', haber: '' },
        { codigo: '1201', debe: '40.00', haber: '' },
        { codigo: '4101', debe: '', haber: '100.00' }
      ],
      'p1-cb2'
    );
    const listado = despachar(ctx, 'libro:partidas', { desde: 0, limite: 10 }) as {
      partidas: PartidaResumen[];
      total: number;
    };
    expect(listado.total).toBe(1);
    // Con safeIntegers el id crudo es bigint; por IPC debe viajar como number (P1).
    expect(typeof listado.partidas[0]!.id).toBe('number');
    expect(listado.partidas[0]!.id).toBe(id);
    // Recorrido de ida y vuelta como el del renderer: Ver reenvía el mismo id recibido.
    const detalle = despachar(ctx, 'libro:partida', { partidaId: listado.partidas[0]!.id }) as PartidaDetalle;
    expect(detalle.id).toBe(id);
    expect(typeof detalle.id).toBe('number');
    expect(detalle.folio).toBe('A-000001');
    // A mano: 60 + 40 = 100 de debe y 100 de haber.
    expect(detalle.totalDebeMinor).toBe('100.00');
    expect(detalle.totalHaberMinor).toBe('100.00');
  });

  it('ningún otro canal del bloque expone bigint: cuentaId de comprobación y de saldos como number', () => {
    partida(
      '2026-01-10',
      'Aporte sintético',
      [
        { codigo: '1101', debe: '25.00', haber: '' },
        { codigo: '3101', debe: '', haber: '25.00' }
      ],
      'p1b-cb2'
    );
    const balance = despachar(ctx, 'balance:comprobacion', { desde: '2026-01-01', hasta: '2026-01-31' }) as {
      filas: Array<{ cuentaId: unknown; codigo: string }>;
    };
    expect(balance.filas.length).toBeGreaterThan(0);
    for (const fila of balance.filas) {
      expect(typeof fila.cuentaId).toBe('number');
    }
    expect(balance.filas.find(f => f.codigo === '1101')!.cuentaId).toBe(idCuenta('1101'));
    const saldos = despachar(ctx, 'balance:saldos', undefined) as SaldoCuenta[];
    expect(saldos.length).toBeGreaterThan(0);
    for (const saldo of saldos) {
      expect(typeof saldo.cuentaId).toBe('number');
    }
    expect(saldos.find(s => s.codigo === '1101')!.saldoMinor).toBe('25.00');
  });
});

describe('cierre bloque 2, P2: saldosCrudos con safeIntegers (resumen y situación coinciden)', () => {
  it('9007199254740993 centavos: resumen, saldos y situación financiera coinciden sin perder precisión', () => {
    // 90071992547409.93 USD = 9007199254740993 centavos > Number.MAX_SAFE_INTEGER.
    // Siembra sintética por INSERT directo (patrón de la auditoría 72).
    const asiento = db
      .prepare(
        `INSERT INTO asiento (folio, fecha_operacion, periodo_id, ambito_id, concepto, estado, responsable) VALUES ('A-000001', '2026-09-10', ?, 'administrativo', 'Aporte enorme sintético', 'borrador', 'qa')`
      )
      .run(periodoDeFecha(db, '2026-09-10').id);
    const idAsiento = Number(asiento.lastInsertRowid);
    const monto = 9007199254740993n;
    db.prepare('INSERT INTO asiento_linea (asiento_id, cuenta_id, debe_minor, haber_minor) VALUES (?, ?, ?, ?)').run(idAsiento, idCuenta('1101'), monto, 0n);
    db.prepare('INSERT INTO asiento_linea (asiento_id, cuenta_id, debe_minor, haber_minor) VALUES (?, ?, ?, ?)').run(idAsiento, idCuenta('3101'), 0n, monto);
    db.prepare("UPDATE asiento SET estado = 'contabilizado' WHERE id = ?").run(idAsiento);

    const resumen = despachar(ctx, 'balance:resumen', undefined) as BalanceResumen;
    // A mano: 9007199254740993 centavos = 90071992547409.93 exactos (antes salía ...92).
    expect(resumen.totalActivoMinor).toBe('90071992547409.93');
    expect(resumen.totalPatrimonioMinor).toBe('90071992547409.93');
    expect(resumen.totalPasivoMinor).toBe('0.00');
    expect(resumen.cuadra).toBe(true);

    const saldos = despachar(ctx, 'balance:saldos', undefined) as SaldoCuenta[];
    expect(saldos.find(s => s.codigo === '1101')!.saldoMinor).toBe('90071992547409.93');

    // El resumen y la situación financiera coinciden con el mismo importe.
    const s = estadoSituacionFinanciera(db, { corte: '2026-09-30' });
    expect(s.activo.totalMinor).toBe(resumen.totalActivoMinor);
    expect(s.patrimonio.totalMinor).toBe(resumen.totalPatrimonioMinor);
    expect(s.cuadra).toBe(true);
  });
});

describe('cierre bloque 2, P3: clasificación corriente/no corriente por padre_id', () => {
  it('una cuenta 1199 colgada bajo el grupo 15 es NO corriente aunque su prefijo sea 11', () => {
    db.prepare(
      "INSERT INTO cuenta (codigo, nombre, tipo, es_grupo, padre_id) VALUES ('1199', 'Herramienta menor sintética', 'activo', 0, (SELECT id FROM cuenta WHERE codigo = '15'))"
    ).run();
    partida(
      '2026-06-10',
      'Herramienta menor sintética',
      [
        { codigo: '1199', debe: '80.00', haber: '' },
        { codigo: '3101', debe: '', haber: '80.00' }
      ],
      'p3-cb2'
    );
    const s = estadoSituacionFinanciera(db, { corte: '2026-06-30' });
    // El grupo sale del padre_id (15 → no corriente), no del prefijo propio (11 → corriente).
    expect(s.activo.noCorriente.map(f => f.codigo)).toContain('1199');
    expect(s.activo.corriente.map(f => f.codigo)).not.toContain('1199');
    expect(s.activo.noCorriente.find(f => f.codigo === '1199')!.saldoMinor).toBe('80.00');
    // Las cuentas colgadas bajo su grupo natural siguen corrientes (1101 bajo 11).
    expect(s.activo.corriente.map(f => f.codigo)).toContain('1101');
    // A mano: activo 80 = patrimonio 80. Cuadra.
    expect(s.activo.totalMinor).toBe('80.00');
    expect(s.cuadra).toBe(true);
  });
});

describe('cierre bloque 2, P4: reguladoras con saldo deudor sí son saldo contrario', () => {
  it('1502 con saldo deudor se reporta como contrario; el abonador natural no', () => {
    // Corrección sintética inusual: 1502 queda con saldo DEUDOR (20.00).
    partida(
      '2026-05-10',
      'Corrección depreciación sintética',
      [
        { codigo: '1502', debe: '20.00', haber: '' },
        { codigo: '6101', debe: '', haber: '20.00' }
      ],
      'p4-cb2'
    );
    const s = estadoSituacionFinanciera(db, { corte: '2026-05-31' });
    // El signo natural de la reguladora está invertido: el deudor SÍ es contrario (antes nunca se reportaba).
    expect(s.saldosContrarios.map(c => c.codigo)).toEqual(['1502']);
    expect(s.saldosContrarios[0]!.saldoMinor).toBe('20.00');
    const fila1502 = s.activo.noCorriente.find(f => f.codigo === '1502')!;
    expect(fila1502.saldoMinor).toBe('20.00');
    expect(s.cuadra).toBe(true);
  });

  it('el saldo abonador natural de 1502 sigue sin reportarse como contrario', () => {
    partida(
      '2026-05-10',
      'Depreciación sintética',
      [
        { codigo: '6101', debe: '20.00', haber: '' },
        { codigo: '1502', debe: '', haber: '20.00' }
      ],
      'p4b-cb2'
    );
    const s = estadoSituacionFinanciera(db, { corte: '2026-05-31' });
    expect(s.saldosContrarios).toHaveLength(0);
    expect(s.activo.noCorriente.find(f => f.codigo === '1502')!.saldoMinor).toBe('-20.00');
  });
});

describe('cierre bloque 2, P5: ámbito respetado y rotulado', () => {
  it('libro:partida respeta el ámbito: otro ámbito no ve la partida administrativa', () => {
    const id = partida(
      '2026-07-10',
      'Partida administrativa sintética',
      [
        { codigo: '1101', debe: '10.00', haber: '' },
        { codigo: '4101', debe: '', haber: '10.00' }
      ],
      'p5-cb2'
    );
    db.prepare("INSERT INTO ambito (id, nombre, tipo) VALUES ('juridico', 'Ámbito jurídico sintético', 'juridico')").run();
    // Con el ámbito jurídico la partida administrativa no existe (antes el ámbito se ignoraba).
    expect(() => despachar(ctx, 'libro:partida', { partidaId: id, ambitoId: 'juridico' })).toThrow(/No existe la partida/);
    const detalle = despachar(ctx, 'libro:partida', { partidaId: id, ambitoId: 'administrativo' }) as PartidaDetalle;
    expect(detalle.folio).toBe('A-000001');
    // Sin ámbito se conserva el administrativo por defecto.
    const porDefecto = despachar(ctx, 'libro:partida', { partidaId: id }) as PartidaDetalle;
    expect(porDefecto.folio).toBe('A-000001');
  });

  it('el PDF rotula el ámbito real del reporte, no uno fijo', () => {
    const base = { titulo: 'Reporte sintético', tablas: [{ encabezados: ['Código'], filas: [['1']] }] };
    const porDefecto = construirHtmlReporte({ ...base }, '<svg></svg>', '');
    expect(porDefecto).toContain('Ámbito administrativo.');
    const juridico = construirHtmlReporte({ ...base, ambito: 'juridico' }, '<svg></svg>', '');
    expect(juridico).toContain('Ámbito juridico.');
    expect(juridico).not.toContain('Ámbito administrativo');
  });
});

describe('cierre bloque 2, P8: filas de total del PDF con cifras alineadas a la derecha', () => {
  it('la fila de total recibe class="numero" en las columnas de cifra, igual que las filas', () => {
    const html = construirHtmlReporte(
      {
        titulo: 'Reporte sintético',
        tablas: [
          {
            encabezados: ['Cuenta', 'Nombre', 'Importe'],
            filas: [['5101', 'Costo sintético', '40.00']],
            total: ['Utilidad bruta', '', '60.00']
          }
        ]
      },
      '<svg></svg>',
      ''
    );
    expect(html).toContain('<tfoot><tr class="total"><td>Utilidad bruta</td><td></td><td class="numero">60.00</td></tr></tfoot>');
    expect(html).toContain('<td class="numero">40.00</td>');
    // La columna textual del total no toma la clase de cifra.
    expect(html).toContain('<td>Utilidad bruta</td>');
  });
});
