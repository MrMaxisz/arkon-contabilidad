import type BetterSqlite3 from 'better-sqlite3';
type Database = BetterSqlite3.Database;
import { validarFechaCalendario } from '../../shared/fechas';
import { minorATexto } from '../../shared/dinero';
import { auxiliarContraparteDetalle } from './fiscal';
import { escaparCsv } from './fiscal';
import { SQL_FAMILIA_CIERRE_EXCLUIDA, SQL_FAMILIA_CIERRE_PRESENTA } from './familiaCierre';

export class ErrorPaquete extends Error {}

export type ResultadoConciliacionAnual = 'ok' | 'descuadre' | 'no-aplica';

// Función PURA (auditoría 62): la conciliación estado-resultados vs ejercicio-anual SOLO aplica
// cuando el rango cubre el año completo del corte; compara contra el TOTAL real de
// ejercicio-anual.csv (TOTAL_ORDINARIO_ANUAL). En rango parcial escribe no-aplica, nunca ok.
export function conciliarEstadoResultadosVsAnual(entrada: {
  rangoCubreAnio: boolean;
  totalEstadoResultados: bigint;
  totalOrdinarioAnual: bigint;
}): ResultadoConciliacionAnual {
  if (!entrada.rangoCubreAnio) {
    return 'no-aplica';
  }
  return entrada.totalEstadoResultados === entrada.totalOrdinarioAnual ? 'ok' : 'descuadre';
}

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
    estadoResultadosVsAnual: ResultadoConciliacionAnual;
  };
  limitaciones: string[];
}

interface SaldoCuentaCorte {
  codigo: string;
  nombre: string;
  tipo: string;
  saldo: bigint;
}

function saldosCuentaCorte(db: Database, hasta: string): SaldoCuentaCorte[] {
  return (
    db
      .prepare(
        `SELECT c.codigo, c.nombre, c.tipo,
                COALESCE(SUM(CASE WHEN a.id IS NOT NULL THEN l.debe_minor - l.haber_minor ELSE 0 END), 0) AS saldo
         FROM cuenta c
         LEFT JOIN asiento_linea l ON l.cuenta_id = c.id
         LEFT JOIN asiento a ON a.id = l.asiento_id
           AND a.estado IN ('contabilizado','anulado')
           AND a.fecha_operacion <= ?
         WHERE c.es_grupo = 0
         GROUP BY c.id, c.codigo, c.nombre, c.tipo
         ORDER BY c.codigo`
      )
      .all(hasta) as Array<{ codigo: string; nombre: string; tipo: string; saldo: number }>
  ).map(f => ({ codigo: f.codigo, nombre: f.nombre, tipo: f.tipo, saldo: BigInt(f.saldo) }));
}

function mayorCuentaCorte(db: Database, codigo: string, hasta: string): bigint {
  return BigInt(
    (
      db
        .prepare(
          `SELECT COALESCE(SUM(l.debe_minor - l.haber_minor), 0) AS s
           FROM asiento_linea l
           JOIN asiento a ON a.id = l.asiento_id
           JOIN cuenta c ON c.id = l.cuenta_id
           WHERE c.codigo = ? AND a.estado IN ('contabilizado','anulado') AND a.fecha_operacion <= ?`
        )
        .get(codigo, hasta) as { s: number }
    ).s
  );
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
    'Saldos de cuentas, balance y conciliaciones calculados ACUMULADOS al corte (hasta); movimientos, asientos y resultados calculados del rango exacto desde–hasta.',
    'ejercicio-anual.csv: soporte del AÑO del corte (resultado ordinario sin la familia de cierre), diferenciado del rango desde–hasta y reconciliado contra el mayor.',
    'estado-resultados.csv y la vista de estado de resultados EXCLUYEN la familia de cierre (asiento de cierre, su reverso y cierres anulados): el traslado a 3201 no es ingreso ni gasto ordinario. Las anulaciones ordinarias Sí cuentan y netean cero.',
    'Las retenciones y el tratamiento fiscal de anticipos permanecen como control interno pendiente de la política del contador.',
    'Cifras en USD con dos decimales; los importes provienen del mayor contable y de las aplicaciones de documentos.'
  ];

  const archivos: ArchivoPaquete[] = [];

  const saldosCorte = saldosCuentaCorte(db, hasta);
  const lineasCuentas = ['codigo,nombre,tipo,saldo'];
  for (const c of saldosCorte) {
    lineasCuentas.push(`${escaparCsv(c.codigo)},${escaparCsv(c.nombre)},${escaparCsv(c.tipo)},${minorATexto(c.saldo)}`);
  }
  archivos.push({ nombre: 'cuentas.csv', contenido: lineasCuentas.join('\n') });

  let totalClientesCorte = 0n;
  let totalProveedoresCorte = 0n;
  for (const tipo of ['cliente', 'proveedor'] as const) {
    const etiqueta = tipo === 'cliente' ? 'clientes' : 'proveedores';
    const tabla = tipo === 'cliente' ? 'venta' : 'compra';
    const universo = db
      .prepare(
        `SELECT DISTINCT p.id, p.nombre
         FROM contraparte p
         JOIN ${tabla} x ON x.contraparte_id = p.id
           AND x.estado = 'registrada' AND x.fecha_operacion <= ?
         WHERE ${tipo === 'cliente' ? 'p.es_cliente' : 'p.es_proveedor'} = 1
         ORDER BY p.nombre`
      )
      .all(hasta) as Array<{ id: number; nombre: string }>;
    const lineas: string[] = ['contraparte,folio,fecha,concepto,total,aplicado,saldo'];
    let totalTipo = 0n;
    for (const p of universo) {
      const detalle = auxiliarContraparteDetalle(db, tipo, p.id, hasta);
      for (const d of detalle.documentos) {
        lineas.push(
          [
            escaparCsv(p.nombre),
            escaparCsv(d.folio),
            d.fecha,
            escaparCsv(d.concepto),
            d.totalMinor,
            d.aplicadoMinor,
            d.saldoMinor
          ].join(',')
        );
      }
      lineas.push(`${escaparCsv(p.nombre)},TOTAL,,,,,${detalle.saldoMinor}`);
      totalTipo += parse(detalle.saldoMinor);
    }
    if (tipo === 'cliente') {
      totalClientesCorte = totalTipo;
    } else {
      totalProveedoresCorte = totalTipo;
    }
    archivos.push({ nombre: `auxiliar-${etiqueta}.csv`, contenido: lineas.join('\n') });
  }

  const filasEfectivo = saldosCorte.filter(c => c.codigo === '1101' || c.codigo === '1102' || c.codigo === '1103');
  const lineasEfectivo = ['cuenta,nombre,saldo'];
  let totalEfectivo = 0n;
  for (const c of filasEfectivo) {
    lineasEfectivo.push(`${escaparCsv(c.codigo)},${escaparCsv(c.nombre)},${minorATexto(c.saldo)}`);
    totalEfectivo += c.saldo;
  }
  lineasEfectivo.push(`TOTAL,,${minorATexto(totalEfectivo)}`);
  archivos.push({ nombre: 'auxiliar-efectivo.csv', contenido: lineasEfectivo.join('\n') });

  const filasResultados = db
    .prepare(
      `SELECT c.codigo, c.nombre, c.tipo,
              COALESCE(SUM(l.haber_minor - l.debe_minor), 0) AS saldo
       FROM asiento_linea l
       JOIN asiento a ON a.id = l.asiento_id AND a.estado IN ('contabilizado','anulado')
       JOIN cuenta c ON c.id = l.cuenta_id
       WHERE c.es_grupo = 0 AND c.tipo IN ('ingreso','costo','gasto')
         AND a.fecha_operacion >= ? AND a.fecha_operacion <= ?
         AND ${SQL_FAMILIA_CIERRE_EXCLUIDA}
       GROUP BY c.id, c.codigo, c.nombre, c.tipo
       ORDER BY c.codigo`
    )
    .all(desde, hasta) as Array<{ codigo: string; nombre: string; tipo: string; saldo: number }>;
  const lineasResultados = ['desde,hasta,codigo,nombre,tipo,importe'];
  let netoResultados = 0n;
  for (const f of filasResultados) {
    netoResultados += BigInt(f.saldo);
    lineasResultados.push(
      `${desde},${hasta},${escaparCsv(f.codigo)},${escaparCsv(f.nombre)},${f.tipo},${minorATexto(BigInt(f.saldo))}`
    );
  }
  lineasResultados.push(`${desde},${hasta},TOTAL,,,${minorATexto(netoResultados)}`);
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
        minorATexto(BigInt(a.debe)),
        minorATexto(BigInt(a.haber))
      ].join(',')
    );
  }
  archivos.push({ nombre: 'asientos.csv', contenido: lineasAsientos.join('\n') });

  let activo = 0n;
  let pasivo = 0n;
  let patrimonio = 0n;
  let resultado = 0n;
  for (const c of saldosCorte) {
    if (c.tipo === 'activo') {
      activo += c.saldo;
    } else if (c.tipo === 'pasivo') {
      pasivo += c.saldo;
    } else if (c.tipo === 'patrimonio') {
      patrimonio += c.saldo;
    } else {
      resultado += c.saldo;
    }
  }
  const mayorClientes = mayorCuentaCorte(db, '1201', hasta);
  const mayorProveedores = mayorCuentaCorte(db, '2101', hasta);
  const mayorEfectivo = BigInt(
    (
      db
        .prepare(
          `SELECT COALESCE(SUM(l.debe_minor - l.haber_minor), 0) AS s
           FROM asiento_linea l
           JOIN asiento a ON a.id = l.asiento_id
           JOIN cuenta c ON c.id = l.cuenta_id
           WHERE c.es_efectivo = 1 AND a.estado IN ('contabilizado','anulado') AND a.fecha_operacion <= ?`
        )
        .get(hasta) as { s: number }
    ).s
  );
  let cuentasConcilian = true;
  for (const c of saldosCorte) {
    if (c.saldo !== mayorCuentaCorte(db, c.codigo, hasta)) {
      cuentasConcilian = false;
    }
  }
  // Soporte anual diferenciado y reconciliado: el año del corte.
  const anioCorte = Number(hasta.slice(0, 4));
  const filasAnual = db
    .prepare(
      `SELECT c.codigo, c.nombre, c.tipo,
              COALESCE(SUM(CASE WHEN a.fecha_operacion >= ? AND a.fecha_operacion <= ?
                AND ${SQL_FAMILIA_CIERRE_EXCLUIDA} THEN l.haber_minor - l.debe_minor ELSE 0 END), 0) AS movimiento
       FROM cuenta c
       LEFT JOIN asiento_linea l ON l.cuenta_id = c.id
       LEFT JOIN asiento a ON a.id = l.asiento_id AND a.estado IN ('contabilizado','anulado')
       WHERE c.es_grupo = 0 AND c.tipo IN ('ingreso','costo','gasto')
       GROUP BY c.id, c.codigo, c.nombre, c.tipo
       HAVING movimiento <> 0
       ORDER BY c.codigo`
    )
    .all(`${anioCorte}-01-01`, hasta) as Array<{ codigo: string; nombre: string; tipo: string; movimiento: number }>;
  const lineasAnual = ['codigo,nombre,tipo,movimiento_ejercicio_anual'];
  let anualNeto = 0n;
  for (const f of filasAnual) {
    anualNeto += BigInt(f.movimiento);
    lineasAnual.push(`${escaparCsv(f.codigo)},${escaparCsv(f.nombre)},${f.tipo},${minorATexto(BigInt(f.movimiento))}`);
  }
  lineasAnual.push(`TOTAL_ORDINARIO_ANUAL,,,${minorATexto(anualNeto)}`);
  lineasAnual.push(`NOTA: resultado ordinario del año ${anioCorte} (familia de cierre y sus reversos excluidos); el archivo estado-resultados.csv cubre el RANGO desde-hasta solicitado; ambos alcances son distintos y reconciliados contra el mayor.`);
  archivos.push({ nombre: 'ejercicio-anual.csv', contenido: lineasAnual.join('\n') });

  const trasladoCierre = db
    .prepare(
      `SELECT COALESCE(SUM(l.haber_minor - l.debe_minor), 0) AS monto
       FROM asiento_linea l
       JOIN asiento a ON a.id = l.asiento_id AND a.estado IN ('contabilizado','anulado')
       JOIN cuenta c ON c.id = l.cuenta_id AND c.es_grupo = 0 AND c.tipo IN ('ingreso','costo','gasto')
       WHERE a.fecha_operacion >= ? AND a.fecha_operacion <= ?
         AND ${SQL_FAMILIA_CIERRE_PRESENTA}`
    )
    .get(desde, hasta) as { monto: number };
  const resultadoTrasladadoCierre = -BigInt(trasladoCierre.monto);
  const rangoCubreAnio = desde === `${anioCorte}-01-01` && hasta === `${anioCorte}-12-31`;
  const conciliaciones = {
    clientesMayor: totalClientesCorte === mayorClientes,
    proveedoresMayor: totalProveedoresCorte === -mayorProveedores,
    efectivoMayor: totalEfectivo === mayorEfectivo,
    balanceCuadra: activo + pasivo + patrimonio + resultado === 0n && cuentasConcilian,
    estadoResultadosVsAnual: conciliarEstadoResultadosVsAnual({ rangoCubreAnio, totalEstadoResultados: netoResultados, totalOrdinarioAnual: anualNeto })
  };
  const lineasConciliaciones = [
    `conciliacion,resultado`,
    `auxiliar-clientes-al-corte-vs-mayor-1201,${conciliaciones.clientesMayor ? 'ok' : 'descuadre'}`,
    `auxiliar-proveedores-al-corte-vs-mayor-2101,${conciliaciones.proveedoresMayor ? 'ok' : 'descuadre'}`,
    `auxiliar-efectivo-al-corte-vs-mayor,${conciliaciones.efectivoMayor ? 'ok' : 'descuadre'}`,
    `cuentas-exportadas-vs-mayor-al-corte,${cuentasConcilian ? 'ok' : 'descuadre'}`,
    `balance-activo-pasivo-patrimonio-resultado,${conciliaciones.balanceCuadra ? 'cuadra' : 'no cuadra'}`,
    `resultado-trasladado-por-cierre,${minorATexto(resultadoTrasladadoCierre)}`,
    `estado-resultados-vs-ejercicio-anual,${conciliaciones.estadoResultadosVsAnual}`,
    `total-activo,${minorATexto(activo)}`,
    `total-pasivo,${minorATexto(pasivo)}`,
    `total-patrimonio,${minorATexto(patrimonio)}`,
    `resultado-acumulado-al-corte,${minorATexto(-resultado)}`,
    `total-clientes-al-corte,${minorATexto(totalClientesCorte)}`,
    `mayor-1201-al-corte,${minorATexto(mayorClientes)}`,
    `total-proveedores-al-corte,${minorATexto(totalProveedoresCorte)}`,
    `mayor-2101-al-corte,${minorATexto(mayorProveedores)}`
  ];
  archivos.push({ nombre: 'conciliaciones.csv', contenido: lineasConciliaciones.join('\n') });


  const leeme = [
    'PAQUETE INTERNO PARA EL CONTADOR — ARKON CONTABILIDAD',
    'Versión del paquete: paquete-contador-v2',
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
    version: 'paquete-contador-v2',
    generadoEn: new Date().toISOString(),
    desde,
    hasta,
    archivos,
    conciliaciones,
    limitaciones
  };
}

function parse(texto: string): bigint {
  const negativo = texto.startsWith('-');
  const limpio = texto.replace('-', '');
  const [entero = '0', decimales = '00'] = limpio.split('.');
  const minor = BigInt(entero) * 100n + BigInt(decimales.padEnd(2, '0').slice(0, 2));
  return negativo ? -minor : minor;
}
