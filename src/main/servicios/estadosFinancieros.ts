import type Database from 'better-sqlite3';
import { minorATexto } from '../../shared/dinero';

export interface SaldoCuenta {
  cuentaId: number;
  codigo: string;
  nombre: string;
  tipo: string;
  saldoMinor: string;
}

interface SaldoCrudo {
  id: number;
  codigo: string;
  nombre: string;
  tipo: string;
  saldo: number | null;
}

function saldosCrudos(db: Database.Database): SaldoCrudo[] {
  return db
    .prepare(
      `SELECT c.id, c.codigo, c.nombre, c.tipo,
              COALESCE(SUM(CASE WHEN a.estado IN ('contabilizado','anulado')
                                THEN l.debe_minor - l.haber_minor ELSE 0 END), 0) AS saldo
       FROM cuenta c
       LEFT JOIN asiento_linea l ON l.cuenta_id = c.id
       LEFT JOIN asiento a ON a.id = l.asiento_id
       WHERE c.es_grupo = 0
       GROUP BY c.id
       ORDER BY c.codigo`
    )
    .all() as SaldoCrudo[];
}

export function saldosPorCuenta(db: Database.Database): SaldoCuenta[] {
  return saldosCrudos(db).map(f => ({
    cuentaId: f.id,
    codigo: f.codigo,
    nombre: f.nombre,
    tipo: f.tipo,
    saldoMinor: minorATexto(BigInt(f.saldo ?? 0))
  }));
}

export interface BalanceResumen {
  totalActivoMinor: string;
  totalPasivoMinor: string;
  totalPatrimonioMinor: string;
  totalResultadoMinor: string;
  cuadra: boolean;
}

export function balanceResumen(db: Database.Database): BalanceResumen {
  let activo = 0n;
  let pasivo = 0n;
  let patrimonio = 0n;
  let resultado = 0n;
  for (const f of saldosCrudos(db)) {
    const saldo = BigInt(f.saldo ?? 0);
    switch (f.tipo) {
      case 'activo':
        activo += saldo;
        break;
      case 'pasivo':
        pasivo += -saldo;
        break;
      case 'patrimonio':
        patrimonio += -saldo;
        break;
      case 'ingreso':
        resultado += -saldo;
        break;
      case 'costo':
      case 'gasto':
        resultado += -saldo;
        break;
      default:
        break;
    }
  }
  return {
    totalActivoMinor: minorATexto(activo),
    totalPasivoMinor: minorATexto(pasivo),
    totalPatrimonioMinor: minorATexto(patrimonio),
    totalResultadoMinor: minorATexto(resultado),
    cuadra: activo === pasivo + patrimonio + resultado
  };
}

// ─── Auditoría 71, bloque 2: balance de comprobación y estados financieros ───
// Clasificación DOCUMENTADA por código de grupo del catálogo base (revisable por el contador):
//   Estado de resultados: 41 ingresos por servicios, 42 otros ingresos, 51 costos,
//   61 gastos de administración, 62 gastos de comercialización, 63 gastos financieros.
//   Situación financiera: corriente 11/12/13/14 (activo) y 21/22/23 (pasivo);
//   no corriente 15 (activo). Patrimonio sin corriente/no corriente.

import { validarFechaCalendario } from '../../shared/fechas';
import { SQL_FAMILIA_CIERRE_EXCLUIDA } from './familiaCierre';

export interface FilaComprobacion {
  cuentaId: number;
  codigo: string;
  nombre: string;
  tipo: string;
  esGrupo: boolean;
  saldoInicialMinor: string;
  cargosMinor: string;
  abonosMinor: string;
  saldoFinalMinor: string;
}

export interface BalanceComprobacion {
  desde: string;
  hasta: string;
  filas: FilaComprobacion[];
  totalCargosMinor: string;
  totalAbonosMinor: string;
  cuadra: boolean;
}

export function balanceComprobacion(
  db: Database.Database,
  entrada: { desde: string; hasta: string; ocultarSinMovimiento?: boolean }
): BalanceComprobacion {
  validarFechaCalendario(entrada.desde);
  validarFechaCalendario(entrada.hasta);
  if (entrada.desde > entrada.hasta) {
    throw new Error(`Rango inválido: desde ${entrada.desde} es posterior a ${entrada.hasta}`);
  }
  const filasCrudas = db
    .prepare(
      `SELECT c.id, c.codigo, c.nombre, c.tipo, c.es_grupo AS esGrupo,
              COALESCE(SUM(CASE WHEN a.fecha_operacion < ? THEN l.debe_minor - l.haber_minor ELSE 0 END), 0) AS saldoInicial,
              COALESCE(SUM(CASE WHEN a.fecha_operacion >= ? AND a.fecha_operacion <= ? THEN l.debe_minor ELSE 0 END), 0) AS cargos,
              COALESCE(SUM(CASE WHEN a.fecha_operacion >= ? AND a.fecha_operacion <= ? THEN l.haber_minor ELSE 0 END), 0) AS abonos
       FROM cuenta c
       LEFT JOIN asiento_linea l ON l.cuenta_id = c.id
       LEFT JOIN asiento a ON a.id = l.asiento_id AND a.estado IN ('contabilizado','anulado')
       GROUP BY c.id, c.codigo, c.nombre, c.tipo, c.es_grupo
       ORDER BY c.codigo`
    )
    .all(entrada.desde, entrada.desde, entrada.hasta, entrada.desde, entrada.hasta) as Array<{
    id: number;
    codigo: string;
    nombre: string;
    tipo: string;
    esGrupo: number;
    saldoInicial: number;
    cargos: number;
    abonos: number;
  }>;

  // Jerarquía: los grupos suman sus cuentas descendientes (por padre_id).
  const porId = new Map<number, { fila: FilaComprobacion; inicial: bigint; cargos: bigint; abonos: bigint }>();
  for (const f of filasCrudas) {
    porId.set(f.id, {
      fila: {
        cuentaId: f.id,
        codigo: f.codigo,
        nombre: f.nombre,
        tipo: f.tipo,
        esGrupo: f.esGrupo === 1,
        saldoInicialMinor: minorATexto(BigInt(f.saldoInicial)),
        cargosMinor: minorATexto(BigInt(f.cargos)),
        abonosMinor: minorATexto(BigInt(f.abonos)),
        saldoFinalMinor: minorATexto(BigInt(f.saldoInicial) + BigInt(f.cargos) - BigInt(f.abonos))
      },
      inicial: BigInt(f.saldoInicial),
      cargos: BigInt(f.cargos),
      abonos: BigInt(f.abonos)
    });
  }
  const padres = db.prepare('SELECT id, padre_id FROM cuenta WHERE padre_id IS NOT NULL').all() as Array<{
    id: number;
    padre_id: number;
  }>;
  const hijosDe = new Map<number, number[]>();
  for (const p of padres) {
    hijosDe.set(p.padre_id, [...(hijosDe.get(p.padre_id) ?? []), p.id]);
  }
  const sumarDescendientes = (id: number, visitados: Set<number>): { inicial: bigint; cargos: bigint; abonos: bigint } => {
    let inicial = 0n;
    let cargos = 0n;
    let abonos = 0n;
    for (const hijo of hijosDe.get(id) ?? []) {
      if (visitados.has(hijo)) {
        continue;
      }
      visitados.add(hijo);
      const propio = porId.get(hijo);
      if (propio && !propio.fila.esGrupo) {
        inicial += propio.inicial;
        cargos += propio.cargos;
        abonos += propio.abonos;
      }
      const sub = sumarDescendientes(hijo, visitados);
      inicial += sub.inicial;
      cargos += sub.cargos;
      abonos += sub.abonos;
    }
    return { inicial, cargos, abonos };
  };
  for (const [id, entry] of porId) {
    if (entry.fila.esGrupo) {
      const { inicial, cargos, abonos } = sumarDescendientes(id, new Set([id]));
      entry.fila.saldoInicialMinor = minorATexto(inicial);
      entry.fila.cargosMinor = minorATexto(cargos);
      entry.fila.abonosMinor = minorATexto(abonos);
      entry.fila.saldoFinalMinor = minorATexto(inicial + cargos - abonos);
    }
  }

  const filas = [...porId.values()]
    .map(e => e.fila)
    .filter(f => !(entrada.ocultarSinMovimiento && f.esGrupo === false && f.cargosMinor === '0.00' && f.abonosMinor === '0.00'));

  // Cuadre por movimientos del rango: cargos = abonos (partida doble).
  const cuadre = db
    .prepare(
      `SELECT COALESCE(SUM(l.debe_minor), 0) AS cargos, COALESCE(SUM(l.haber_minor), 0) AS abonos
       FROM asiento_linea l
       JOIN asiento a ON a.id = l.asiento_id AND a.estado IN ('contabilizado','anulado')
       WHERE a.fecha_operacion >= ? AND a.fecha_operacion <= ?`
    )
    .get(entrada.desde, entrada.hasta) as { cargos: number; abonos: number };
  const totalCargos = BigInt(cuadre.cargos);
  const totalAbonos = BigInt(cuadre.abonos);

  return {
    desde: entrada.desde,
    hasta: entrada.hasta,
    filas,
    totalCargosMinor: minorATexto(totalCargos),
    totalAbonosMinor: minorATexto(totalAbonos),
    cuadra: totalCargos === totalAbonos
  };
}

export interface SeccionResultados {
  codigo: string;
  nombre: string;
  importeMinor: string;
}

export interface EstadoResultadosEstructurado {
  desde: string;
  hasta: string;
  ingresos: SeccionResultados[];
  costos: SeccionResultados[];
  utilidadBrutaMinor: string;
  gastosAdministracion: SeccionResultados[];
  gastosComercializacion: SeccionResultados[];
  utilidadOperacionMinor: string;
  otrosIngresos: SeccionResultados[];
  gastosFinancieros: SeccionResultados[];
  resultadoAntesImpuestosMinor: string;
  periodoAnterior: EstadoResultadosEstructurado | null;
}

// signo: ingresos por su naturaleza acreedora (haber-debe); costos y gastos deudora (debe-haber),
// para presentar cada sección con importes positivos que se restan entre sí.
function sumasPorGrupo(
  db: Database.Database,
  prefijos: string[],
  signo: 'acreedora' | 'deudora',
  desde: string,
  hasta: string
): Array<{ codigo: string; nombre: string; saldo: bigint }> {
  const condicion = prefijos.map(() => "c.codigo LIKE ? || '%'").join(' OR ');
  const expresion = signo === 'acreedora' ? 'l.haber_minor - l.debe_minor' : 'l.debe_minor - l.haber_minor';
  const filas = db
    .prepare(
      `SELECT c.codigo, c.nombre,
              COALESCE(SUM(CASE WHEN a.id IS NOT NULL
                         AND a.fecha_operacion >= ? AND a.fecha_operacion <= ?
                         AND ${SQL_FAMILIA_CIERRE_EXCLUIDA}
                       THEN ${expresion} ELSE 0 END), 0) AS saldo
       FROM cuenta c
       LEFT JOIN asiento_linea l ON l.cuenta_id = c.id
       LEFT JOIN asiento a ON a.id = l.asiento_id AND a.estado IN ('contabilizado','anulado')
       WHERE c.es_grupo = 0 AND (${condicion})
       GROUP BY c.id, c.codigo, c.nombre
       ORDER BY c.codigo`
    )
    .all(desde, hasta, ...prefijos) as Array<{ codigo: string; nombre: string; saldo: number }>;
  return filas
    .map(f => ({ codigo: f.codigo, nombre: f.nombre, saldo: BigInt(f.saldo) }))
    .filter(f => f.saldo !== 0n);
}

function totalSeccion(seccion: Array<{ saldo: bigint }>): bigint {
  return seccion.reduce((s, f) => s + f.saldo, 0n);
}

export function estadoResultadosEstructurado(
  db: Database.Database,
  entrada: { desde: string; hasta: string; comparativo?: boolean }
): EstadoResultadosEstructurado {
  validarFechaCalendario(entrada.desde);
  validarFechaCalendario(entrada.hasta);
  if (entrada.desde > entrada.hasta) {
    throw new Error(`Rango inválido: desde ${entrada.desde} es posterior a ${entrada.hasta}`);
  }
  const calcular = (desde: string, hasta: string): EstadoResultadosEstructurado => {
    const ingresos = sumasPorGrupo(db, ['41'], 'acreedora', desde, hasta);
    const costos = sumasPorGrupo(db, ['51'], 'deudora', desde, hasta);
    const gastosAdministracion = sumasPorGrupo(db, ['61'], 'deudora', desde, hasta);
    const gastosComercializacion = sumasPorGrupo(db, ['62'], 'deudora', desde, hasta);
    const otrosIngresos = sumasPorGrupo(db, ['42'], 'acreedora', desde, hasta);
    const gastosFinancieros = sumasPorGrupo(db, ['63'], 'deudora', desde, hasta);

    const totalIngresos = totalSeccion(ingresos);
    const totalCostos = totalSeccion(costos);
    const utilidadBruta = totalIngresos - totalCostos;
    const utilidadOperacion = utilidadBruta - totalSeccion(gastosAdministracion) - totalSeccion(gastosComercializacion);
    const resultadoAntesImpuestos = utilidadOperacion + totalSeccion(otrosIngresos) - totalSeccion(gastosFinancieros);

    const mapear = (lista: Array<{ codigo: string; nombre: string; saldo: bigint }>): SeccionResultados[] =>
      lista.map(f => ({ codigo: f.codigo, nombre: f.nombre, importeMinor: minorATexto(f.saldo) }));

    return {
      desde,
      hasta,
      ingresos: mapear(ingresos),
      costos: mapear(costos),
      utilidadBrutaMinor: minorATexto(utilidadBruta),
      gastosAdministracion: mapear(gastosAdministracion),
      gastosComercializacion: mapear(gastosComercializacion),
      utilidadOperacionMinor: minorATexto(utilidadOperacion),
      otrosIngresos: mapear(otrosIngresos),
      gastosFinancieros: mapear(gastosFinancieros),
      resultadoAntesImpuestosMinor: minorATexto(resultadoAntesImpuestos),
      periodoAnterior: null
    };
  };

  const actual = calcular(entrada.desde, entrada.hasta);
  if (entrada.comparativo) {
    const dias = Math.round((Date.parse(entrada.hasta) - Date.parse(entrada.desde)) / 86400000) + 1;
    const hastaAnterior = new Date(Date.parse(entrada.desde) - 86400000).toISOString().slice(0, 10);
    const desdeAnterior = new Date(Date.parse(hastaAnterior) - (dias - 1) * 86400000).toISOString().slice(0, 10);
    actual.periodoAnterior = calcular(desdeAnterior, hastaAnterior);
  }
  return actual;
}

export interface FilaSituacion {
  codigo: string;
  nombre: string;
  corriente: boolean;
  saldoMinor: string;
}

export interface EstadoSituacionFinanciera {
  corte: string;
  activo: { corriente: FilaSituacion[]; noCorriente: FilaSituacion[]; totalMinor: string };
  pasivo: { corriente: FilaSituacion[]; noCorriente: FilaSituacion[]; totalMinor: string };
  patrimonio: { filas: FilaSituacion[]; resultadoEjercicioMinor: string; totalMinor: string };
  cuadra: boolean;
  saldosContrarios: Array<{ codigo: string; nombre: string; saldoMinor: string }>;
  comparativo: EstadoSituacionFinanciera | null;
}

const GRUPOS_NO_CORRIENTE = new Set(['15']);

export function estadoSituacionFinanciera(
  db: Database.Database,
  entrada: { corte: string; corteComparativo?: string }
): EstadoSituacionFinanciera {
  validarFechaCalendario(entrada.corte);
  const calcular = (corte: string): EstadoSituacionFinanciera => {
    const filas = db
      .prepare(
        `SELECT c.id, c.codigo, c.nombre, c.tipo, c.es_grupo AS esGrupo,
                COALESCE(SUM(CASE WHEN a.id IS NOT NULL AND a.fecha_operacion <= ?
                       THEN l.debe_minor - l.haber_minor ELSE 0 END), 0) AS saldo
         FROM cuenta c
         LEFT JOIN asiento_linea l ON l.cuenta_id = c.id
         LEFT JOIN asiento a ON a.id = l.asiento_id AND a.estado IN ('contabilizado','anulado')
         WHERE c.es_grupo = 0
         GROUP BY c.id, c.codigo, c.nombre, c.tipo, c.es_grupo
         ORDER BY c.codigo`
      )
      .all(corte) as Array<{
      id: number;
      codigo: string;
      nombre: string;
      tipo: string;
      esGrupo: number;
      saldo: number;
    }>;

    const grupoDe = (codigo: string): string => codigo.slice(0, 2);
    const activoCorriente: FilaSituacion[] = [];
    const activoNoCorriente: FilaSituacion[] = [];
    const pasivoCorriente: FilaSituacion[] = [];
    const pasivoNoCorriente: FilaSituacion[] = [];
    const patrimonioFilas: FilaSituacion[] = [];
    const saldosContrarios: Array<{ codigo: string; nombre: string; saldoMinor: string }> = [];
    let totalActivo = 0n;
    let totalPasivo = 0n;
    let totalPatrimonio = 0n;
    let resultadoEjercicio = 0n;

    for (const f of filas) {
      const saldo = BigInt(f.saldo);
      const grupo = grupoDe(f.codigo);
      const fila: FilaSituacion = {
        codigo: f.codigo,
        nombre: f.nombre,
        corriente: !GRUPOS_NO_CORRIENTE.has(grupo),
        saldoMinor: minorATexto(saldo)
      };
      // Saldos contrarios visibles: nunca se ocultan ni se compensan.
      const contrario =
        (f.tipo === 'activo' && saldo < 0n) ||
        ((f.tipo === 'pasivo' || f.tipo === 'patrimonio') && saldo > 0n);
      if (contrario) {
        saldosContrarios.push({ codigo: f.codigo, nombre: f.nombre, saldoMinor: minorATexto(saldo) });
      }
      const esCorriente = !GRUPOS_NO_CORRIENTE.has(grupo);
      switch (f.tipo) {
        case 'activo': {
          totalActivo += saldo;
          if (esCorriente) {
            activoCorriente.push(fila);
          } else {
            activoNoCorriente.push(fila);
          }
          break;
        }
        case 'pasivo': {
          totalPasivo += -saldo;
          if (esCorriente) {
            pasivoCorriente.push(fila);
          } else {
            pasivoNoCorriente.push(fila);
          }
          break;
        }
        case 'patrimonio': {
          totalPatrimonio += -saldo;
          patrimonioFilas.push(fila);
          break;
        }
        case 'ingreso':
        case 'costo':
        case 'gasto': {
          // Resultado del ejercicio aún no cerrado: el asiento de cierre (familia de cierre,
          // INCLUIDO aquí) traslada el resultado a 3201; tras el cierre estas cuentas netean 0.
          resultadoEjercicio += -saldo;
          break;
        }
        default:
          break;
      }
    }

    const totalPatrimonioConResultado = totalPatrimonio + resultadoEjercicio;
    if (resultadoEjercicio !== 0n) {
      patrimonioFilas.push({
        codigo: '—',
        nombre: 'Resultado del ejercicio (aún no cerrado)',
        corriente: true,
        saldoMinor: minorATexto(resultadoEjercicio)
      });
    }

    return {
      corte,
      activo: {
        corriente: activoCorriente,
        noCorriente: activoNoCorriente,
        totalMinor: minorATexto(totalActivo)
      },
      pasivo: {
        corriente: pasivoCorriente,
        noCorriente: pasivoNoCorriente,
        totalMinor: minorATexto(totalPasivo)
      },
      patrimonio: {
        filas: patrimonioFilas,
        resultadoEjercicioMinor: minorATexto(resultadoEjercicio),
        totalMinor: minorATexto(totalPatrimonioConResultado)
      },
      cuadra: totalActivo === totalPasivo + totalPatrimonioConResultado,
      saldosContrarios,
      comparativo: null
    };
  };

  const actual = calcular(entrada.corte);
  if (entrada.corteComparativo) {
    validarFechaCalendario(entrada.corteComparativo);
    actual.comparativo = calcular(entrada.corteComparativo);
  }
  return actual;
}
