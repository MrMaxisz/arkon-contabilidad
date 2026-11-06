import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import type BetterSqlite3 from 'better-sqlite3';
import { entornoPrueba, idCuenta, type EntornoPrueba } from './utilidades';
import {
  darAltaActivoFijo,
  depreciarMes,
  cuadroGeneralActivosFijos,
  conciliacionActivosFijos,
  csvCuadroGeneralActivosFijos
} from '../src/main/servicios/activosFijos';
import { estadoEjercicio } from '../src/main/servicios/cierre';
import { contabilizarAsiento } from '../src/main/servicios/motorAsientos';
import { despachar, type ContextoApp } from '../src/main/comandos';
import { COMANDOS_PERMITIDOS } from '../src/preload/comandosPermitidos';

// Bloque 3, tarea 3D: reportes de activos fijos. Todas las cifras están calculadas A MANO.
// A: 1,200.00 a 12 meses, inicio 15/ene/2026 → 100.00 desde febrero.
// B: 1,000.00 a 3 meses, inicio 31/ene/2026 → 333.33, 333.33, 333.34 desde febrero.
// Al 30/jun/2026: A lleva 5 cuotas (500.00) y B las 3 (1,000.00).

let entorno: EntornoPrueba;
let db: BetterSqlite3.Database;
let activoA: number;
let activoB: number;

function alta(entrada: Record<string, unknown>): { id: number; codigo: string } {
  return darAltaActivoFijo(db, {
    descripcion: 'Herramienta sintética',
    categoria: 'Herramientas',
    ubicacion: 'Bodega sintética',
    responsable: 'qa',
    fechaAdquisicion: '2026-01-10',
    fechaInicioUso: '2026-01-15',
    costoMinor: '1200.00',
    residualMinor: '0.00',
    vidaUtilMeses: 12,
    cuentaActivoId: idCuenta(db, '1501'),
    cuentaDepreciacionId: idCuenta(db, '1502'),
    cuentaGastoId: idCuenta(db, '6101'),
    cuentaContrapartidaId: idCuenta(db, '1101'),
    ...entrada
  });
}

beforeEach(() => {
  entorno = entornoPrueba();
  db = entorno.db;
  const a = alta({ descripcion: 'Herramienta, "especial"', categoria: 'Herramientas' });
  const b = alta({
    descripcion: 'Equipo sintético',
    categoria: 'Equipos',
    fechaInicioUso: '2026-01-31',
    costoMinor: '1000.00',
    vidaUtilMeses: 3
  });
  activoA = a.id;
  activoB = b.id;
  // Un solo lote recupera todas las cuotas pendientes hasta junio.
  const lote = depreciarMes(db, { mes: '2026-06', responsable: 'qa' });
  expect(lote.totalMinor).toBe('1500.00');
});

afterEach(() => {
  entorno.limpiar();
});

describe('bloque 3D: cuadro general de activos fijos', () => {
  it('costo, acumulada, valor en libros y gasto del período por activo y categoría, con totales', () => {
    const cuadro = cuadroGeneralActivosFijos(db, '2026-06-30');
    expect(cuadro.periodoDesde).toBe('2026-01-01');
    expect(cuadro.periodoHasta).toBe('2026-06-30');

    const a = cuadro.filas.find(f => f.activoId === activoA)!;
    expect(a.costoMinor).toBe('1200.00');
    expect(a.acumuladaMinor).toBe('500.00');
    expect(a.valorLibrosMinor).toBe('700.00');
    expect(a.gastoPeriodoMinor).toBe('500.00');

    const b = cuadro.filas.find(f => f.activoId === activoB)!;
    expect(b.costoMinor).toBe('1000.00');
    expect(b.acumuladaMinor).toBe('1000.00');
    expect(b.valorLibrosMinor).toBe('0.00');
    expect(b.gastoPeriodoMinor).toBe('1000.00');

    // A mano: 1,200.00 + 1,000.00 = 2,200.00; acumulada 500.00 + 1,000.00 = 1,500.00;
    // valor en libros 700.00 + 0.00 = 700.00; gasto del ejercicio 500.00 + 1,000.00 = 1,500.00.
    expect(cuadro.totales).toEqual({
      costoMinor: '2200.00',
      acumuladaMinor: '1500.00',
      valorLibrosMinor: '700.00',
      gastoPeriodoMinor: '1500.00'
    });
    expect(cuadro.categorias).toEqual([
      {
        categoria: 'Equipos',
        costoMinor: '1000.00',
        acumuladaMinor: '1000.00',
        valorLibrosMinor: '0.00',
        gastoPeriodoMinor: '1000.00'
      },
      {
        categoria: 'Herramientas',
        costoMinor: '1200.00',
        acumuladaMinor: '500.00',
        valorLibrosMinor: '700.00',
        gastoPeriodoMinor: '500.00'
      }
    ]);
  });

  it('a un corte anterior a la adquisición no hay activos ni cifras', () => {
    const cuadro = cuadroGeneralActivosFijos(db, '2025-12-31');
    expect(cuadro.filas).toEqual([]);
    expect(cuadro.categorias).toEqual([]);
    expect(cuadro.totales).toEqual({
      costoMinor: '0.00',
      acumuladaMinor: '0.00',
      valorLibrosMinor: '0.00',
      gastoPeriodoMinor: '0.00'
    });
  });

  it('un corte a mitad de mes no incluye la depreciación contabilizada al cierre de ese mes', () => {
    // El lote se contabilizó el 30/jun/2026; al 15/jun todavía no existe en el mayor.
    const cuadro = cuadroGeneralActivosFijos(db, '2026-06-15');
    expect(cuadro.totales).toEqual({
      costoMinor: '2200.00',
      acumuladaMinor: '0.00',
      valorLibrosMinor: '2200.00',
      gastoPeriodoMinor: '0.00'
    });
    expect(conciliacionActivosFijos(db, '2026-06-15').cuadra).toBe(true);
  });
});

describe('bloque 3D: conciliación contra el mayor', () => {
  it('cuadra contra las cuentas de activo y acumulada', () => {
    const conciliacion = conciliacionActivosFijos(db, '2026-06-30');
    expect(conciliacion.cuadra).toBe(true);
    expect(conciliacion.totalDiferenciaMinor).toBe('0.00');
    expect(conciliacion.filas).toEqual([
      {
        cuentaId: idCuenta(db, '1501'),
        codigo: '1501',
        nombre: 'Herramientas y equipos',
        tipo: 'activo',
        saldoMayorMinor: '2200.00',
        saldoReporteMinor: '2200.00',
        diferenciaMinor: '0.00'
      },
      {
        cuentaId: idCuenta(db, '1502'),
        codigo: '1502',
        nombre: 'Depreciación acumulada',
        tipo: 'acumulada',
        saldoMayorMinor: '1500.00',
        saldoReporteMinor: '1500.00',
        diferenciaMinor: '0.00'
      }
    ]);
  });

  it('una diferencia provocada solo se informa: no se ajusta sola', () => {
    // Diferencia provocada a mano: se debita 1502 por 25.00 (reduce la acumulada del mayor).
    contabilizarAsiento(db, {
      fechaOperacion: '2026-06-15',
      concepto: 'Diferencia sintética para la conciliación',
      responsable: 'qa',
      ambitoId: 'administrativo',
      lineas: [
        { cuentaId: idCuenta(db, '1502'), debeMinor: '25.00', haberMinor: '' },
        { cuentaId: idCuenta(db, '1101'), debeMinor: '', haberMinor: '25.00' }
      ],
      claveIdempotencia: 'diferencia-3d'
    });
    const asientosAntes = (db.prepare('SELECT COUNT(*) AS n FROM asiento').get() as { n: number }).n;
    const conciliacion = conciliacionActivosFijos(db, '2026-06-30');
    expect(conciliacion.cuadra).toBe(false);
    expect(conciliacion.totalDiferenciaMinor).toBe('25.00');
    const acumulada = conciliacion.filas.find(f => f.codigo === '1502')!;
    expect(acumulada.saldoMayorMinor).toBe('1475.00');
    expect(acumulada.saldoReporteMinor).toBe('1500.00');
    expect(acumulada.diferenciaMinor).toBe('25.00');
    // Volver a consultar no registra asientos: la conciliación nunca corrige sola.
    const segunda = conciliacionActivosFijos(db, '2026-06-30');
    expect(segunda.totalDiferenciaMinor).toBe('25.00');
    expect((db.prepare('SELECT COUNT(*) AS n FROM asiento').get() as { n: number }).n).toBe(asientosAntes);
  });
});

describe('bloque 3D: CSV y canales de reporte', () => {
  it('CSV con saneamiento de comas y comillas, y totales', () => {
    const salida = csvCuadroGeneralActivosFijos(db, '2026-06-30');
    expect(salida.version).toBe('cuadro-activos-fijos-v1');
    expect(salida.filas).toBe(2);
    const lineas = salida.csv.split('\n');
    expect(lineas[0]).toBe('categoria,codigo,descripcion,estado,costo,acumulada,valor_libros,gasto_periodo');
    // La descripción contiene coma y comillas: se sanea como en el paquete del contador.
    expect(salida.csv).toContain('Herramientas,AF-000001,"Herramienta, ""especial""",activo,1200.00,500.00,700.00,500.00');
    expect(lineas[lineas.length - 1]).toBe('TOTAL,,,,2200.00,1500.00,700.00,1500.00');
  });

  it('los canales están permitidos y despachan el cuadro, la conciliación y el CSV', () => {
    for (const comando of [
      'reporte:activosFijosCuadro',
      'reporte:activosFijosConciliacion',
      'reporte:activosFijosCsv'
    ]) {
      expect(COMANDOS_PERMITIDOS.has(comando)).toBe(true);
    }
    const ctx = { db } as ContextoApp;
    const cuadro = despachar(ctx, 'reporte:activosFijosCuadro', { corte: '2026-06-30' }) as ReturnType<typeof cuadroGeneralActivosFijos>;
    expect(cuadro.totales.valorLibrosMinor).toBe('700.00');
    const conciliacion = despachar(ctx, 'reporte:activosFijosConciliacion', { corte: '2026-06-30' }) as ReturnType<typeof conciliacionActivosFijos>;
    expect(conciliacion.cuadra).toBe(true);
    const csv = despachar(ctx, 'reporte:activosFijosCsv', { corte: '2026-06-30' }) as ReturnType<typeof csvCuadroGeneralActivosFijos>;
    expect(csv.filas).toBe(2);
  });
});

describe('bloque 3D: aviso de depreciación pendiente en Cierre', () => {
  it('avisa las cuotas del ejercicio que faltan y deja de avisar cuando se deprecian', () => {
    // Al 30/jun/2026: A tiene pendientes julio a diciembre (6 × 100.00 = 600.00).
    // B ya está totalmente depreciado y no tiene cuotas del ejercicio pendientes.
    const pendiente = estadoEjercicio(db, 2026).depreciacionPendiente;
    expect(pendiente).toEqual({
      anio: 2026,
      hayPendientes: true,
      activos: 1,
      meses: 6,
      importeMinor: '600.00'
    });
    // Al depreciar diciembre se recuperan las 6 cuotas de A; la de enero/2027 queda fuera del ejercicio.
    depreciarMes(db, { mes: '2026-12', responsable: 'qa' });
    expect(estadoEjercicio(db, 2026).depreciacionPendiente).toEqual({
      anio: 2026,
      hayPendientes: false,
      activos: 0,
      meses: 0,
      importeMinor: '0.00'
    });
  });
});
