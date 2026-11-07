import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { entornoPrueba, idCuenta, type EntornoPrueba } from './utilidades';
import { crearCuenta } from '../src/main/servicios/cuentas';
import { crearContraparte, crearProyecto, registrarCompra, registrarVenta, anularDocumento } from '../src/main/servicios/operacion';
import { contabilizarAsiento, anularAsiento, periodoDeFecha } from '../src/main/servicios/motorAsientos';
import { rentabilidadProyectos } from '../src/main/servicios/fiscal';
import { costosPorProyecto, costosPorTipo, conciliacionCostos, csvCostos } from '../src/main/servicios/costos';
import { despachar, type ContextoApp } from '../src/main/comandos';
import { COMANDOS_PERMITIDOS } from '../src/preload/comandosPermitidos';

let entorno: EntornoPrueba;
let contraparte: number;
let proyectoA: number;
let proyectoB: number;
let secuencia: number;
const rango = { desde: '2026-03-01', hasta: '2026-03-31' };

beforeEach(() => {
  entorno = entornoPrueba();
  secuencia = 0;
  contraparte = crearContraparte(entorno.db, {
    nombre: 'Contraparte sintética', esCliente: true, esProveedor: true, responsable: 'qa'
  });
  proyectoA = crearProyecto(entorno.db, {
    codigo: 'P-A', nombre: 'Proyecto, "A"', contraparteId: contraparte, responsable: 'qa'
  });
  proyectoB = crearProyecto(entorno.db, {
    codigo: 'P-B', nombre: 'Proyecto B', contraparteId: contraparte, responsable: 'qa'
  });
  for (const codigo of ['5199', '5999']) crearCuenta(entorno.db, {
    codigo, nombre: `Otros sintéticos ${codigo}`, tipo: 'costo', esGrupo: false,
    padreId: idCuenta(entorno.db, '5'), responsable: 'qa'
  });
});
afterEach(() => entorno.limpiar());

function compra(proyectoId: number | undefined, cuentas: Array<[string, string]>, fechaOperacion = '2026-03-15') {
  return registrarCompra(entorno.db, {
    contraparteId: contraparte, proyectoId, fechaOperacion, concepto: 'Compra sintética', condicion: 'credito',
    claveIdempotencia: `compra-${++secuencia}`, responsable: 'qa',
    lineas: cuentas.map(([cuentaCodigo, precioUnitario]) => ({
      descripcion: 'Línea sintética', cuentaCodigo, precioUnitario, cantidad: '1', tasa: '0', tratamiento: 'exento' as const
    }))
  });
}
function venta(proyectoId: number, base: string) {
  return registrarVenta(entorno.db, {
    contraparteId: contraparte, proyectoId, fechaOperacion: '2026-03-15', concepto: 'Venta sintética',
    tipoIngreso: 'instalaciones', base, tasa: '0', claveIdempotencia: `venta-${++secuencia}`, responsable: 'qa'
  });
}
function manual(monto: string, cuenta = '5101', fechaOperacion = '2026-03-15', ambitoId = 'administrativo', origenTipo?: string) {
  return contabilizarAsiento(entorno.db, {
    fechaOperacion, ambitoId, origenTipo, concepto: 'Asiento sintético', responsable: 'qa',
    claveIdempotencia: `manual-${++secuencia}`,
    lineas: [
      { cuentaId: idCuenta(entorno.db, cuenta), debeMinor: monto, haberMinor: '' },
      { cuentaId: idCuenta(entorno.db, '1101'), debeMinor: '', haberMinor: monto }
    ]
  });
}
function escenario() {
  venta(proyectoA, '200.00');
  venta(proyectoB, '50.00');
  compra(proyectoA, [['5101', '100.00'], ['5102', '20.00'], ['5103', '10.00'],
    ['5104', '5.00'], ['5999', '7.00'], ['6101', '3.00'], ['1501', '4.00']]);
  compra(proyectoB, [['5101', '40.00']]);
  compra(undefined, [['5101', '8.00']]);
  manual('3.00', '5199');
  manual('12.00', '5101', '2026-02-28');
  manual('900.00', '5101', '2026-04-01');
}

describe('4A: costos contables por proyecto y tipo', () => {
  it('separa las cuatro cuentas y otros, muestra sin proyecto y calcula el margen', () => {
    escenario();
    const reporte = costosPorProyecto(entorno.db, rango);
    // A: 100 + 20 + 10 + 5 + 7 = 142; 200 - 142 = 58; 58 / 200 = 29%.
    expect(reporte.proyectos[0]).toMatchObject({
      proyectoId: proyectoA, materialesMinor: '100.00', personalMinor: '20.00', transporteMinor: '10.00',
      subcontratacionMinor: '5.00', otrosMinor: '7.00', costoMinor: '142.00', ingresoMinor: '200.00',
      margenMinor: '58.00', margenPorcentaje: '29.00'
    });
    expect(reporte.proyectos[1]).toMatchObject({ costoMinor: '40.00', margenMinor: '10.00', margenPorcentaje: '20.00' });
    expect(reporte.proyectos[0]?.cuentas.map(c => c.codigo)).toEqual(['5101', '5102', '5103', '5104', '5999']);
    expect(reporte.sinProyecto).toMatchObject({
      proyectoId: null, nombre: 'Sin proyecto', materialesMinor: '8.00', otrosMinor: '3.00', costoMinor: '11.00',
      margenMinor: '-11.00', margenPorcentaje: null
    });
    // 142 + 40 + 11 = 193; 250 - 193 = 57; 57/250 = 22.80%.
    expect(reporte).toMatchObject({ totalCostoMinor: '193.00', totalMargenMinor: '57.00', margenPorcentaje: '22.80', provisional: true });
  });

  it('reutiliza rentabilidad y conserva gastos solo en la métrica histórica', () => {
    escenario();
    const comun = rentabilidadProyectos(entorno.db, { ...rango, incluirGastos: false });
    expect(costosPorProyecto(entorno.db, rango).proyectos[0]?.cuentas).toEqual(comun.proyectos[0]?.cuentas.filter(c => c.tipo === 'costo'));
    expect(comun.proyectos[0]).toMatchObject({ costoMinor: '142.00', totalDocumentalCompraMinor: '149.00' });
    // La rentabilidad histórica incluye el gasto 3.00, pero nunca el activo 4.00.
    expect(rentabilidadProyectos(entorno.db, rango).proyectos[0]?.costoMinor).toBe('145.00');
  });

  it('suma por tipo y cuenta con febrero completo como comparativo de marzo', () => {
    escenario();
    const reporte = costosPorTipo(entorno.db, rango);
    // Materiales 100 + 40 + 8 = 148; otros 7 + 3 = 10; total 193.
    expect(reporte.tipos.map(t => [t.tipo, t.importeMinor])).toEqual([
      ['materiales', '148.00'], ['personal', '20.00'], ['transporte', '10.00'],
      ['subcontratacion', '5.00'], ['otros', '10.00']
    ]);
    expect(reporte.tipos[4]?.cuentas.map(c => c.codigo)).toEqual(['5199', '5999']);
    expect(reporte.periodoAnterior).toMatchObject({ desde: '2026-02-01', hasta: '2026-02-28', totalCostoMinor: '12.00' });
    expect(costosPorTipo(entorno.db, { ...rango, comparativo: false }).periodoAnterior).toBeNull();
  });

  it('concilia todos los costos, incluso fuera de 51 y sin proyecto, excluyendo gastos y activos', () => {
    escenario();
    expect(conciliacionCostos(entorno.db, rango)).toMatchObject({
      totalCostosMinor: '193.00', costosEstadoResultadosMinor: '193.00', diferenciaMinor: '0.00', cuadra: true
    });
  });

  it('filtra ámbito, borradores y la familia de cierre, incluido un reverso en otro rango', () => {
    const db = entorno.db;
    manual('10.00');
    db.prepare("INSERT INTO ambito (id, nombre, tipo) VALUES ('juridico', 'Sintético', 'juridico')").run();
    const juridico = Number(db.prepare(`INSERT INTO asiento
      (folio, fecha_operacion, periodo_id, ambito_id, concepto, estado, responsable)
      VALUES ('JUR-SINTETICO', '2026-03-15', ?, 'juridico', 'Otro ámbito sintético', 'borrador', 'qa')`)
      .run(periodoDeFecha(db, '2026-03-15').id).lastInsertRowid);
    db.prepare('INSERT INTO asiento_linea (asiento_id, cuenta_id, debe_minor, haber_minor) VALUES (?, ?, 9000, 0), (?, ?, 0, 9000)')
      .run(juridico, idCuenta(db, '5101'), juridico, idCuenta(db, '1101'));
    db.prepare("UPDATE asiento SET estado = 'contabilizado' WHERE id = ?").run(juridico);
    manual('50.00', '5101', '2026-03-15', 'administrativo', 'cierre');
    const cierre = manual('70.00', '5101', '2026-02-28', 'administrativo', 'cierre');
    // Reverso sintético fechado en marzo: el original queda fuera del rango.
    // Se arma en borrador para respetar la protección de asientos contabilizados.
    const id = Number(db.prepare(`INSERT INTO asiento
      (folio, fecha_operacion, periodo_id, ambito_id, concepto, reverso_de_id, estado, responsable)
      VALUES ('REV-SINTETICO', '2026-03-15', ?, 'administrativo', 'Reverso sintético', ?, 'borrador', 'qa')`)
      .run(periodoDeFecha(db, '2026-03-15').id, cierre.asientoId).lastInsertRowid);
    db.prepare(`INSERT INTO asiento_linea (asiento_id, cuenta_id, debe_minor, haber_minor)
      SELECT ?, cuenta_id, haber_minor, debe_minor FROM asiento_linea WHERE asiento_id = ?`).run(id, cierre.asientoId);
    db.prepare("UPDATE asiento SET estado = 'contabilizado' WHERE id = ?").run(id);
    const borrador = Number(db.prepare(`INSERT INTO asiento
      (folio, fecha_operacion, periodo_id, ambito_id, concepto, estado, responsable)
      VALUES ('BOR-SINTETICO', '2026-03-15', ?, 'administrativo', 'Borrador sintético', 'borrador', 'qa')`)
      .run(periodoDeFecha(db, '2026-03-15').id).lastInsertRowid);
    db.prepare('INSERT INTO asiento_linea (asiento_id, cuenta_id, debe_minor, haber_minor) VALUES (?, ?, 9900, 0)')
      .run(borrador, idCuenta(db, '5101'));
    expect(costosPorProyecto(db, rango).totalCostoMinor).toBe('10.00');
    expect(costosPorProyecto(db, { ...rango, ambitoId: 'juridico' }).totalCostoMinor).toBe('90.00');
    expect(conciliacionCostos(db, rango).costosEstadoResultadosMinor).toBe('10.00');
  });

  it('netea anulaciones de documentos en su proyecto y anulaciones manuales sin proyecto', () => {
    const c = compra(proyectoA, [['5101', '70.00']]);
    compra(proyectoA, [['5101', '30.00']]);
    const v = venta(proyectoA, '100.00');
    venta(proyectoA, '50.00');
    const m = manual('9.00');
    anularDocumento(entorno.db, 'compra', c.id, 'qa', 'Prueba sintética');
    anularDocumento(entorno.db, 'venta', v.id, 'qa', 'Prueba sintética');
    anularAsiento(entorno.db, m.asientoId, 'qa', 'Prueba sintética');
    expect(costosPorProyecto(entorno.db, rango).proyectos[0]).toMatchObject({
      costoMinor: '30.00', ingresoMinor: '50.00', margenMinor: '20.00', margenPorcentaje: '40.00'
    });
    expect(costosPorProyecto(entorno.db, rango).sinProyecto.costoMinor).toBe('0.00');
    expect(conciliacionCostos(entorno.db, rango).totalCostosMinor).toBe('30.00');
  });

  it.each([
    ['0.03', '0.02', '0.01', '33.33'],
    ['0.03', '0.04', '-0.01', '-33.33'],
    ['200.00', '199.99', '0.01', '0.01'],
    ['200.00', '200.01', '-0.01', '-0.01']
  ])('porcentaje entero half-up: ingreso %s, costo %s', (ingreso, costo, margen, porcentaje) => {
    venta(proyectoA, ingreso);
    compra(proyectoA, [['5101', costo]]);
    expect(costosPorProyecto(entorno.db, rango).proyectos[0]).toMatchObject({ margenMinor: margen, margenPorcentaje: porcentaje });
  });

  it('preserva centavos por encima del límite entero seguro de Number', () => {
    // 9,007,199,254,740,993 centavos: Number perdería el último centavo.
    manual('90071992547409.93');
    expect(costosPorProyecto(entorno.db, rango).sinProyecto.costoMinor).toBe('90071992547409.93');
    expect(conciliacionCostos(entorno.db, rango)).toMatchObject({
      costosEstadoResultadosMinor: '90071992547409.93', diferenciaMinor: '0.00', cuadra: true
    });
  });

  it('muestra una línea sin proyecto en cero y rechaza fechas o rangos inválidos', () => {
    expect(costosPorProyecto(entorno.db, rango).sinProyecto).toMatchObject({ costoMinor: '0.00', margenPorcentaje: null });
    expect(() => costosPorProyecto(entorno.db, { desde: '2026-02-30', hasta: '2026-03-31' })).toThrow();
    expect(() => costosPorTipo(entorno.db, { desde: '2026-04-01', hasta: '2026-03-31' })).toThrow(/Rango/);
  });

  it('exporta CSV saneado por proyecto y por tipo con comparativo', () => {
    escenario();
    const csv = csvCostos(entorno.db, rango);
    expect(csv.filas).toBe(3);
    expect(csv.csv).toContain('P-A,"Proyecto, ""A""",100.00,20.00,10.00,5.00,7.00,142.00,200.00,58.00,29.00');
    expect(csv.csv).toContain(',Sin proyecto,8.00,0.00,0.00,0.00,3.00,11.00,0.00,-11.00,');
    expect(csv.csv.split('\n').at(-1)).toBe('TOTAL,,,,,,,193.00,250.00,57.00,22.80');
    const tipos = csvCostos(entorno.db, { ...rango, reporte: 'tipo' });
    expect(tipos.csv).toContain('Materiales,5101,Costo de materiales,148.00,2026-03-01,2026-03-31,administrativo');
    expect(tipos.csv).toContain('TOTAL,,,12.00,2026-02-01,2026-02-28,administrativo');
  });

  it('permite y despacha los cuatro canales y valida sus payloads', () => {
    escenario();
    const ctx = { db: entorno.db } as ContextoApp;
    for (const comando of ['reporte:costosPorProyecto', 'reporte:costosPorTipo', 'reporte:costosConciliacion', 'reporte:costosCsv']) {
      expect(COMANDOS_PERMITIDOS.has(comando)).toBe(true);
      expect(() => despachar(ctx, comando, rango)).not.toThrow();
      expect(() => despachar(ctx, comando, { hasta: rango.hasta })).toThrow(/desde/);
    }
    expect(despachar(ctx, 'reporte:costosConciliacion', rango)).toMatchObject({ totalCostosMinor: '193.00', cuadra: true });
    expect(despachar(ctx, 'reporte:rentabilidadProyectos', rango)).toMatchObject({ proyectos: [
      expect.objectContaining({ costoMinor: '145.00' }), expect.objectContaining({ costoMinor: '40.00' })
    ] });
    expect(() => despachar(ctx, 'reporte:costosCsv', { ...rango, reporte: 'fiscal' })).toThrow(/Reporte/);
    expect(() => despachar(ctx, 'reporte:costosPorTipo', { ...rango, comparativo: 'sí' })).toThrow(/booleano/);
    expect(() => despachar(ctx, 'reporte:costosPorProyecto', { ...rango, ambitoId: 1 })).toThrow(/ambitoId/);
  });
});
