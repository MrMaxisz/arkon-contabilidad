import type BetterSqlite3 from 'better-sqlite3';
type Database = BetterSqlite3.Database;
import { validarFechaCalendario } from '../../shared/fechas';
import { saldosPorCuenta, balanceResumen } from './estadosFinancieros';
import {
  auxiliarContrapartes,
  auxiliarEfectivo,
  auxiliarContraparteDetalle,
  estadoResultados
} from './fiscal';
import { escaparCsv } from './fiscal';

export class ErrorPaquete extends Error {}

export interface ArchivoPaquete {
  nombre: string;
  contenido: string;
}

export interface PaqueteContador {
  version: string;
  generadoEn: string;
  desde: string;
  hasta: string;
  archivos: ArchivoPaquete[];
  conciliaciones: {
    clientesMayor: boolean;
    proveedoresMayor: boolean;
    efectivoMayor: boolean;
    balanceCuadra: boolean;
  };
  limitaciones: string[];
}

export function generarPaqueteContador(db: Database, desde: string, hasta: string): PaqueteContador {
  validarFechaCalendario(desde);
  validarFechaCalendario(hasta);
  if (desde > hasta) {
    throw new ErrorPaquete(`Rango inválido: desde ${desde} es posterior a ${hasta}`);
  }
  const limitaciones = [
    'Paquete interno de trabajo para el contador responsable. NO es un anexo ni declaración oficial.',
    'ARKON Ingeniería Eléctrica no está constituida como entidad jurídica ni inscrita como contribuyente de IVA; los datos son de control administrativo.',
    'El auxiliar de caja y bancos se exporta a la fecha de generación, sin corte temporal por período.',
    'Las retenciones y el tratamiento fiscal de anticipos permanecen como control interno pendiente de la política del contador.',
    'Cifras en USD con dos decimales; los importes provienen del mayor contable y de las aplicaciones de documentos.'
  ];

  const archivos: ArchivoPaquete[] = [];

  const cuentas = saldosPorCuenta(db);
  const lineasCuentas = ['codigo,nombre,tipo,saldo'];
  for (const c of cuentas) {
    lineasCuentas.push(`${escaparCsv(c.codigo)},${escaparCsv(c.nombre)},${escaparCsv(c.tipo)},${c.saldoMinor}`);
  }
  archivos.push({ nombre: 'cuentas.csv', contenido: lineasCuentas.join('\n') });

  const auxiliares = auxiliarContrapartes(db);
  for (const tipo of ['cliente', 'proveedor'] as const) {
    const filas = tipo === 'cliente' ? auxiliares.clientes : auxiliares.proveedores;
    const lineas: string[] = ['contraparte,folio,fecha,concepto,total,aplicado,saldo'];
    for (const f of filas) {
      const detalle = auxiliarContraparteDetalle(db, tipo, f.contraparteId, hasta);
      for (const d of detalle.documentos) {
        lineas.push(
          [
            escaparCsv(f.contraparteNombre),
            escaparCsv(d.folio),
            d.fecha,
            escaparCsv(d.concepto),
            d.totalMinor,
            d.aplicadoMinor,
            d.saldoMinor
          ].join(',')
        );
      }
      lineas.push(`${escaparCsv(f.contraparteNombre)},TOTAL,,,,,${detalle.saldoMinor}`);
    }
    const etiqueta = tipo === 'cliente' ? 'clientes' : 'proveedores';
    archivos.push({ nombre: `auxiliar-${etiqueta}.csv`, contenido: lineas.join('\n') });
  }

  const efectivo = auxiliarEfectivo(db);
  const lineasEfectivo = ['cuenta,nombre,saldo'];
  for (const c of efectivo.cuentas) {
    lineasEfectivo.push(`${escaparCsv(c.codigo)},${escaparCsv(c.nombre)},${c.saldoMinor}`);
  }
  lineasEfectivo.push(`TOTAL,,${efectivo.totalMinor}`);
  archivos.push({ nombre: 'auxiliar-efectivo.csv', contenido: lineasEfectivo.join('\n') });

  const lineasResultados = ['mes,codigo,nombre,tipo,importe'];
  const meses: string[] = [];
  let cursor = desde.slice(0, 7);
  const finMes = hasta.slice(0, 7);
  while (cursor <= finMes) {
    meses.push(cursor);
    const [a = 0, m = 0] = cursor.split('-').map(Number);
    cursor = m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, '0')}`;
  }
  for (const mes of meses) {
    const estado = estadoResultados(db, mes);
    for (const f of estado.filas) {
      lineasResultados.push(`${mes},${escaparCsv(f.codigo)},${escaparCsv(f.nombre)},${f.tipo},${f.importeMinor}`);
    }
    lineasResultados.push(`${mes},TOTAL,,,${estado.resultadoMinor}`);
  }
  archivos.push({ nombre: 'estado-resultados.csv', contenido: lineasResultados.join('\n') });

  const asientos = db
    .prepare(
      `SELECT a.folio, a.fecha_operacion AS fecha, a.concepto, a.estado, a.origen_tipo, a.responsable,
              COALESCE((SELECT SUM(l.debe_minor) FROM asiento_linea l WHERE l.asiento_id = a.id), 0) AS debe,
              COALESCE((SELECT SUM(l.haber_minor) FROM asiento_linea l WHERE l.asiento_id = a.id), 0) AS haber
       FROM asiento a
       WHERE a.fecha_operacion >= ? AND a.fecha_operacion <= ?
       ORDER BY a.fecha_operacion, a.id`
    )
    .all(desde, hasta) as Array<{
    folio: string;
    fecha: string;
    concepto: string;
    estado: string;
    origen_tipo: string | null;
    responsable: string;
    debe: number;
    haber: number;
  }>;
  const lineasAsientos = ['folio,fecha,concepto,estado,origen,responsable,debe,haber'];
  for (const a of asientos) {
    lineasAsientos.push(
      [
        escaparCsv(a.folio),
        a.fecha,
        escaparCsv(a.concepto),
        a.estado,
        escaparCsv(a.origen_tipo ?? ''),
        escaparCsv(a.responsable),
        (BigInt(a.debe) / 100n).toString() + '.' + (BigInt(a.debe) % 100n).toString().padStart(2, '0'),
        (BigInt(a.haber) / 100n).toString() + '.' + (BigInt(a.haber) % 100n).toString().padStart(2, '0')
      ].join(',')
    );
  }
  archivos.push({ nombre: 'asientos.csv', contenido: lineasAsientos.join('\n') });

  const balance = balanceResumen(db);
  const conciliaciones = {
    clientesMayor: auxiliares.conciliaMayor,
    proveedoresMayor: auxiliares.conciliaMayor,
    efectivoMayor: efectivo.conciliaMayor,
    balanceCuadra: balance.cuadra
  };
  const lineasConciliaciones = [
    `conciliacion,resultado`,
    `auxiliares-clientes-proveedores-vs-mayor,${conciliaciones.clientesMayor ? 'ok' : 'descuadre'}`,
    `auxiliar-efectivo-vs-mayor,${conciliaciones.efectivoMayor ? 'ok' : 'descuadre'}`,
    `balance-activo-pasivo-patrimonio,${conciliaciones.balanceCuadra ? 'cuadra' : 'no cuadra'}`,
    `total-activo,${balance.totalActivoMinor}`,
    `total-pasivo,${balance.totalPasivoMinor}`,
    `total-patrimonio,${balance.totalPatrimonioMinor}`,
    `resultado-del-periodo,${balance.totalResultadoMinor}`
  ];
  archivos.push({ nombre: 'conciliaciones.csv', contenido: lineasConciliaciones.join('\n') });

  const leeme = [
    'PAQUETE INTERNO PARA EL CONTADOR — ARKON CONTABILIDAD',
    `Versión del paquete: paquete-contador-v1`,
    `Período: ${desde} a ${hasta}`,
    `Generado: ${new Date().toISOString()}`,
    '',
    'Contenido:',
    ...archivos.map(a => `- ${a.nombre}`),
    '',
    'Límites e incompletos identificados:',
    ...limitaciones.map(l => `- ${l}`)
  ].join('\n');
  archivos.unshift({ nombre: 'LEEME.txt', contenido: leeme });

  return {
    version: 'paquete-contador-v1',
    generadoEn: new Date().toISOString(),
    desde,
    hasta,
    archivos,
    conciliaciones,
    limitaciones
  };
}
