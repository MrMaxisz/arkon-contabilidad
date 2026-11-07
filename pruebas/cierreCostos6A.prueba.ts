import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { entornoPrueba, idCuenta, type EntornoPrueba } from './utilidades';
import { cerrarEjercicio, estadoEjercicio, registrarApertura } from '../src/main/servicios/cierre';
import { contabilizarAsiento, anularAsiento } from '../src/main/servicios/motorAsientos';
import { crearContraparte, crearProyecto } from '../src/main/servicios/operacion';
import { costosPorProyecto, conciliacionCostos } from '../src/main/servicios/costos';

let entorno: EntornoPrueba;
beforeEach(() => { entorno = entornoPrueba(); });
afterEach(() => entorno.limpiar());

const cierre = {
  anio: 2026, responsable: 'qa', motivo: 'Cierre sintético', referencia: 'Soporte sintético', claveIdempotencia: '6a'
};
const apertura = {
  fechaOperacion: '2026-01-01', concepto: 'Apertura sintética', referencia: 'Soporte sintético',
  responsable: 'qa', claveIdempotencia: 'apertura-6a',
  lineas: [
    { cuentaCodigo: '1101', debeMinor: '100.00', haberMinor: '' },
    { cuentaCodigo: '3101', debeMinor: '', haberMinor: '100.00' }
  ]
};
function ingreso(monto: string, ambitoId = 'administrativo') {
  const db = entorno.db;
  return contabilizarAsiento(db, {
    fechaOperacion: '2026-03-15', concepto: 'Ingreso sintético', responsable: 'qa', ambitoId,
    lineas: [
      { cuentaId: idCuenta(db, '1101'), debeMinor: monto, haberMinor: '' },
      { cuentaId: idCuenta(db, '4101'), debeMinor: '', haberMinor: monto }
    ]
  });
}
function lineas(asientoId: number) {
  return entorno.db.prepare(`SELECT c.codigo, l.debe_minor AS debe, l.haber_minor AS haber
    FROM asiento_linea l JOIN cuenta c ON c.id = l.cuenta_id WHERE l.asiento_id = ? ORDER BY c.codigo`)
    .safeIntegers(true).all(asientoId);
}

describe('6A: cierre y costos, cifras calculadas a mano', () => {
  it('1: administrativo 100 y jurídico 200 cierran solo 100', () => {
    entorno.db.prepare("INSERT INTO ambito (id, nombre, tipo) VALUES ('juridico', 'Sintético', 'juridico')").run();
    ingreso('100.00');
    // Folio propio para el otro ámbito; no depende del numerador administrativo.
    const db = entorno.db;
    const otro = Number(db.prepare(`INSERT INTO asiento
      (folio, fecha_operacion, periodo_id, ambito_id, concepto, estado, responsable)
      SELECT 'J-6A', fecha_operacion, periodo_id, 'juridico', 'Sintético', 'borrador', 'qa'
      FROM asiento LIMIT 1`).run().lastInsertRowid);
    db.prepare(`INSERT INTO asiento_linea (asiento_id, cuenta_id, debe_minor, haber_minor)
      VALUES (?, ?, 20000, 0), (?, ?, 0, 20000)`)
      .run(otro, idCuenta(db, '1101'), otro, idCuenta(db, '4101'));
    db.prepare("UPDATE asiento SET estado = 'contabilizado' WHERE id = ?").run(otro);
    // 100 + 200 globales; solo 100 administrativos pasan a patrimonio.
    expect(estadoEjercicio(entorno.db, 2026).resultadoNetoMinor).toBe('100.00');
    const resultado = cerrarEjercicio(entorno.db, cierre);
    expect(resultado.netoMinor).toBe('100.00');
    expect(lineas(resultado.id)).toEqual([
      { codigo: '3201', debe: 0n, haber: 10000n },
      { codigo: '4101', debe: 10000n, haber: 0n }
    ]);
    expect(estadoEjercicio(entorno.db, 2026).resultadoNetoMinor).toBe('0.00');
  });

  it('2: cierra exactamente 9007199254740993 centavos', () => {
    ingreso('90071992547409.93');
    // 9007199254740993 / 100 = 90071992547409.93, sin perder el último centavo.
    expect(estadoEjercicio(entorno.db, 2026).resultadoNetoMinor).toBe('90071992547409.93');
    const resultado = cerrarEjercicio(entorno.db, cierre);
    expect(resultado.netoMinor).toBe('90071992547409.93');
    expect(lineas(resultado.id)).toEqual([
      { codigo: '3201', debe: 0n, haber: 9007199254740993n },
      { codigo: '4101', debe: 9007199254740993n, haber: 0n }
    ]);
    expect(estadoEjercicio(entorno.db, 2026).resultadoNetoMinor).toBe('0.00');
  });

  it.each(['1101', '3'])('3: rechaza cuenta destino %s sin trasladar los 100', codigo => {
    ingreso('100.00');
    expect(() => cerrarEjercicio(entorno.db, { ...cierre, cuentaResultadoCodigo: codigo })).toThrow(/Cuenta de resultados/);
    expect(estadoEjercicio(entorno.db, 2026).resultadoNetoMinor).toBe('100.00');
    expect(entorno.db.prepare("SELECT COUNT(*) AS n FROM asiento WHERE origen_tipo = 'cierre'").get()).toEqual({ n: 0 });
  });

  it('4: apertura 100 = 100 conserva soporte y un único evento, incluso al reintentar', () => {
    const db = entorno.db;
    const resultado = registrarApertura(db, apertura);
    expect(lineas(resultado.id)).toEqual([
      { codigo: '1101', debe: 10000n, haber: 0n },
      { codigo: '3101', debe: 0n, haber: 10000n }
    ]);
    expect(db.prepare('SELECT motivo FROM asiento WHERE id = ?').get(resultado.id)).toEqual({ motivo: apertura.referencia });
    expect(registrarApertura(db, apertura).duplicado).toBe(true);
    expect(db.prepare("SELECT COUNT(*) AS n FROM bitacora_evento WHERE tipo = 'apertura_registrada'").get()).toEqual({ n: 1 });
  });

  it.each(['soporte', 'evento'])('4: fallo de %s revierte asiento, líneas, período y bitácora', fallo => {
    const db = entorno.db;
    const antes = db.prepare('SELECT COUNT(*) AS n FROM bitacora_evento').get();
    db.exec(fallo === 'soporte'
      ? `CREATE TRIGGER fallo_soporte BEFORE UPDATE OF motivo ON asiento
         BEGIN SELECT RAISE(ABORT, 'fallo sintético'); END`
      : `CREATE TRIGGER fallo_evento BEFORE INSERT ON bitacora_evento WHEN NEW.tipo = 'apertura_registrada'
         BEGIN SELECT RAISE(ABORT, 'fallo sintético'); END`);
    // Intento de 100 debe = 100 haber; al fallar quedan 0 centavos y 0 asientos.
    expect(() => registrarApertura(db, apertura)).toThrow(/fallo sintético/);
    expect(db.prepare('SELECT COUNT(*) AS n FROM asiento').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT COALESCE(SUM(debe_minor), 0) AS debe, COALESCE(SUM(haber_minor), 0) AS haber FROM asiento_linea').get())
      .toEqual({ debe: 0, haber: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM periodo').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM bitacora_evento').get()).toEqual(antes);
  });

  it.each([false, true])('5: dos compras del mismo asiento no duplican sus líneas (proyecto ambiguo: %s)', ambiguo => {
    const db = entorno.db;
    const contraparte = crearContraparte(db, { nombre: 'Sintética', esProveedor: true, responsable: 'qa' });
    const proyecto = crearProyecto(db, { codigo: 'P6A', nombre: 'Sintético', contraparteId: contraparte, responsable: 'qa' });
    const asiento = contabilizarAsiento(db, {
      fechaOperacion: '2026-03-15', concepto: 'Costo sintético', responsable: 'qa', ambitoId: 'administrativo',
      lineas: [
        { cuentaId: idCuenta(db, '5101'), debeMinor: '60.00', haberMinor: '' },
        { cuentaId: idCuenta(db, '5101'), debeMinor: '40.00', haberMinor: '' },
        { cuentaId: idCuenta(db, '1101'), debeMinor: '', haberMinor: '100.00' }
      ]
    });
    const insertar = db.prepare(`INSERT INTO compra
      (folio, contraparte_id, proyecto_id, fecha_operacion, concepto, base_minor, iva_minor, total_minor, asiento_id, responsable)
      VALUES (?, ?, ?, '2026-03-15', 'Sintética', ?, 0, ?, ?, 'qa')`);
    insertar.run('CMP-6A-1', contraparte, proyecto, 6000, 6000, asiento.asientoId);
    insertar.run('CMP-6A-2', contraparte, ambiguo ? null : proyecto, 4000, 4000, asiento.asientoId);
    const rango = { desde: '2026-03-01', hasta: '2026-03-31' };
    // 60 + 40 = 100 contables (no 200); tampoco SUM(DISTINCT importe).
    const reporte = costosPorProyecto(db, rango);
    expect(reporte.totalCostoMinor).toBe('100.00');
    expect(ambiguo ? reporte.sinProyecto.costoMinor : reporte.proyectos[0]?.costoMinor).toBe('100.00');
    expect(conciliacionCostos(db, rango)).toMatchObject({
      totalCostosMinor: '100.00', costosEstadoResultadosMinor: '100.00', diferenciaMinor: '0.00', cuadra: true
    });
    anularAsiento(db, asiento.asientoId, 'qa', 'Reverso sintético');
    // Original 100 menos reverso 100 = 0, también con documentos duplicados.
    expect(conciliacionCostos(db, rango)).toMatchObject({
      totalCostosMinor: '0.00', costosEstadoResultadosMinor: '0.00', diferenciaMinor: '0.00', cuadra: true
    });
  });
});
