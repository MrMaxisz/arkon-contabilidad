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

// ─── Auditoría 71/72, bloque 2: balance de comprobación y estados financieros ───
// Clasificación por TIPO de cuenta (auditoría 72): lo que no está en un grupo conocido
// del catálogo base va a una línea visible de otros costos/gastos/ingresos.
// Clasificación corriente/no corriente por GRUPO RAÍZ (subiendo por padre_id) con una
// tabla única; una cuenta sin clasificar se marca, no se da por corriente.
// Cuentas reguladoras (p. ej. 1502 depreciación acumulada): su saldo contrario natural
// NO se reporta como contrario.

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
  entrada: { desde: string; hasta: string; ocultarSinMovimiento?: boolean; ambitoId?: string }
): BalanceComprobacion {
  validarFechaCalendario(entrada.desde);
  validarFechaCalendario(entrada.hasta);
  if (entrada.desde > entrada.hasta) {
    throw new Error(`Rango inválido: desde ${entrada.desde} es posterior a ${entrada.hasta}`);
  }
  const ambito = entrada.ambitoId ?? 'administrativo';
  const filasCrudas = (
    db
      .prepare(
        `SELECT c.id, c.codigo, c.nombre, c.tipo, c.es_grupo AS esGrupo,
                COALESCE(SUM(CASE WHEN a.fecha_operacion < ? THEN l.debe_minor - l.haber_minor ELSE 0 END), 0) AS saldoInicial,
                COALESCE(SUM(CASE WHEN a.fecha_operacion >= ? AND a.fecha_operacion <= ? THEN l.debe_minor ELSE 0 END), 0) AS cargos,
                COALESCE(SUM(CASE WHEN a.fecha_operacion >= ? AND a.fecha_operacion <= ? THEN l.haber_minor ELSE 0 END), 0) AS abonos
         FROM cuenta c
         LEFT JOIN asiento_linea l ON l.cuenta_id = c.id
         LEFT JOIN asiento a ON a.id = l.asiento_id AND a.estado IN ('contabilizado','anulado')
                           AND a.ambito_id = ?
         GROUP BY c.id, c.codigo, c.nombre, c.tipo, c.es_grupo
         ORDER BY c.codigo`
      )
      .safeIntegers(true)
      .all(entrada.desde, entrada.desde, entrada.hasta, entrada.desde, entrada.hasta, ambito) as Array<{
      id: number;
      codigo: string;
      nombre: string;
      tipo: string;
      esGrupo: number;
      saldoInicial: bigint;
      cargos: bigint;
      abonos: bigint;
    }>
  );

  const porId = new Map<number, { fila: FilaComprobacion; inicial: bigint; cargos: bigint; abonos: bigint }>();
  for (const f of filasCrudas) {
    porId.set(Number(f.id), {
      fila: {
        cuentaId: f.id,
        codigo: f.codigo,
        nombre: f.nombre,
        tipo: f.tipo,
        esGrupo: Number(f.esGrupo) === 1,
        saldoInicialMinor: minorATexto(f.saldoInicial),
        cargosMinor: minorATexto(f.cargos),
        abonosMinor: minorATexto(f.abonos),
        saldoFinalMinor: minorATexto(f.saldoInicial + f.cargos - f.abonos)
      },
      inicial: f.saldoInicial,
      cargos: f.cargos,
      abonos: f.abonos
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

  // Ocultar sin movimiento: SOLO con saldo inicial, cargos y abonos en cero (auditoría 72).
  const filas = [...porId.values()]
    .map(e => e.fila)
    .filter(
      f =>
        !(
          entrada.ocultarSinMovimiento &&
          f.saldoInicialMinor === '0.00' &&
          f.cargosMinor === '0.00' &&
          f.abonosMinor === '0.00'
        )
    );

  const cuadre = (
    db
      .prepare(
        `SELECT COALESCE(SUM(l.debe_minor), 0) AS cargos, COALESCE(SUM(l.haber_minor), 0) AS abonos
         FROM asiento_linea l
         JOIN asiento a ON a.id = l.asiento_id AND a.estado IN ('contabilizado','anulado')
         WHERE a.fecha_operacion >= ? AND a.fecha_operacion <= ? AND a.ambito_id = ?`
      )
      .safeIntegers(true)
      .get(entrada.desde, entrada.hasta, ambito) as { cargos: bigint; abonos: bigint }
  );

  return {
    desde: entrada.desde,
    hasta: entrada.hasta,
    filas,
    totalCargosMinor: minorATexto(cuadre.cargos),
    totalAbonosMinor: minorATexto(cuadre.abonos),
    cuadra: cuadre.cargos === cuadre.abonos
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
  otrosCostos: SeccionResultados[];
  utilidadBrutaMinor: string;
  gastosAdministracion: SeccionResultados[];
  gastosComercializacion: SeccionResultados[];
  otrosGastos: SeccionResultados[];
  utilidadOperacionMinor: string;
  otrosIngresos: SeccionResultados[];
  gastosFinancieros: SeccionResultados[];
  resultadoAntesImpuestosMinor: string;
  periodoAnterior: EstadoResultadosEstructurado | null;
}

interface CuentaResultado {
  codigo: string;
  nombre: string;
  tipo: string;
  grupo: string;
  saldo: bigint;
}

function cuentasResultados(
  db: Database.Database,
  desde: string,
  hasta: string,
  ambitoId: string
): CuentaResultado[] {
  const filas = (
    db
      .prepare(
        `SELECT c.codigo, c.nombre, c.tipo,
                COALESCE(SUM(CASE WHEN a.id IS NOT NULL
                           AND a.fecha_operacion >= ? AND a.fecha_operacion <= ?
                           AND a.ambito_id = ?
                           AND ${SQL_FAMILIA_CIERRE_EXCLUIDA}
                         THEN CASE WHEN c.tipo = 'ingreso' THEN l.haber_minor - l.debe_minor
                                   ELSE l.debe_minor - l.haber_minor END
                         ELSE 0 END), 0) AS saldo
         FROM cuenta c
         LEFT JOIN asiento_linea l ON l.cuenta_id = c.id
         LEFT JOIN asiento a ON a.id = l.asiento_id AND a.estado IN ('contabilizado','anulado')
         WHERE c.es_grupo = 0 AND c.tipo IN ('ingreso','costo','gasto')
         GROUP BY c.id, c.codigo, c.nombre, c.tipo
         ORDER BY c.codigo`
      )
      .safeIntegers(true)
      .all(desde, hasta, ambitoId) as Array<{ codigo: string; nombre: string; tipo: string; saldo: bigint }>
  );
  return filas
    .filter(f => f.saldo !== 0n)
    .map(f => ({ codigo: f.codigo, nombre: f.nombre, tipo: f.tipo, grupo: f.codigo.slice(0, 2), saldo: f.saldo }));
}

function totalSeccion(seccion: Array<{ saldo: bigint }>): bigint {
  return seccion.reduce((s, f) => s + f.saldo, 0n);
}

function mapearSeccion(lista: CuentaResultado[]): SeccionResultados[] {
  return lista.map(f => ({ codigo: f.codigo, nombre: f.nombre, importeMinor: minorATexto(f.saldo) }));
}

// Rango comparativo correcto (auditoría 72): mes completo → mes calendario anterior;
// año completo → año anterior; N meses completos → los N anteriores; rango libre → igual número de días.
export function rangoAnterior(desde: string, hasta: string): { desde: string; hasta: string } {
  const utc = (texto: string): Date => new Date(`${texto}T00:00:00Z`);
  const texto = (fecha: Date): string => fecha.toISOString().slice(0, 10);
  const anioDesde = Number(desde.slice(0, 4));
  const mesDesde = Number(desde.slice(5, 7));
  const anioHasta = Number(hasta.slice(0, 4));
  const mesHasta = Number(hasta.slice(5, 7));
  const diasEnMes = (anio: number, mes: number): number => new Date(Date.UTC(anio, mes, 0)).getUTCDate();

  if (desde === `${anioDesde}-01-01` && hasta === `${anioDesde}-12-31`) {
    return { desde: `${anioDesde - 1}-01-01`, hasta: `${anioDesde - 1}-12-31` };
  }
  if (desde.endsWith('-01') && hasta === `${anioHasta}-${String(mesHasta).padStart(2, '0')}-${String(diasEnMes(anioHasta, mesHasta)).padStart(2, '0')}`) {
    const mesesCompletos = (anioHasta - anioDesde) * 12 + (mesHasta - mesDesde) + 1;
    // N meses completos contiguos: restar N meses al primero y al último.
    const desdeMes = mesDesde - mesesCompletos;
    const hastaMes = mesHasta - mesesCompletos;
    const ajustar = (anio: number, mes: number): { anio: number; mes: number } => {
      let a = anio;
      let m = mes;
      while (m <= 0) {
        m += 12;
        a -= 1;
      }
      return { anio: a, mes: m };
    };
    const d = ajustar(anioDesde, desdeMes);
    const h = ajustar(anioHasta, hastaMes);
    return {
      desde: `${d.anio}-${String(d.mes).padStart(2, '0')}-01`,
      hasta: `${h.anio}-${String(h.mes).padStart(2, '0')}-${String(diasEnMes(h.anio, h.mes)).padStart(2, '0')}`
    };
  }
  const dias = Math.round((utc(hasta).getTime() - utc(desde).getTime()) / 86400000) + 1;
  const hastaAnterior = texto(new Date(utc(desde).getTime() - 86400000));
  const desdeAnterior = texto(new Date(utc(hastaAnterior).getTime() - (dias - 1) * 86400000));
  return { desde: desdeAnterior, hasta: hastaAnterior };
}

export function estadoResultadosEstructurado(
  db: Database.Database,
  entrada: { desde: string; hasta: string; comparativo?: boolean; ambitoId?: string }
): EstadoResultadosEstructurado {
  validarFechaCalendario(entrada.desde);
  validarFechaCalendario(entrada.hasta);
  if (entrada.desde > entrada.hasta) {
    throw new Error(`Rango inválido: desde ${entrada.desde} es posterior a ${entrada.hasta}`);
  }
  const ambito = entrada.ambitoId ?? 'administrativo';
  const calcular = (desde: string, hasta: string): EstadoResultadosEstructurado => {
    const cuentas = cuentasResultados(db, desde, hasta, ambito);
    // Clasificación por tipo con grupos conocidos; lo demás a líneas visibles de "otros" (auditoría 72).
    const ingresos = cuentas.filter(c => c.tipo === 'ingreso' && c.grupo === '41');
    const otrosIngresos = cuentas.filter(c => c.tipo === 'ingreso' && c.grupo !== '41');
    const costos = cuentas.filter(c => c.tipo === 'costo' && c.grupo === '51');
    const otrosCostos = cuentas.filter(c => c.tipo === 'costo' && c.grupo !== '51');
    const gastosAdministracion = cuentas.filter(c => c.tipo === 'gasto' && c.grupo === '61');
    const gastosComercializacion = cuentas.filter(c => c.tipo === 'gasto' && c.grupo === '62');
    const gastosFinancieros = cuentas.filter(c => c.tipo === 'gasto' && c.grupo === '63');
    const otrosGastos = cuentas.filter(c => c.tipo === 'gasto' && !['61', '62', '63'].includes(c.grupo));

    const utilidadBruta =
      totalSeccion(ingresos) - totalSeccion(costos) - totalSeccion(otrosCostos);
    const utilidadOperacion =
      utilidadBruta - totalSeccion(gastosAdministracion) - totalSeccion(gastosComercializacion) - totalSeccion(otrosGastos);
    const resultadoAntesImpuestos =
      utilidadOperacion + totalSeccion(otrosIngresos) - totalSeccion(gastosFinancieros);

    return {
      desde,
      hasta,
      ingresos: mapearSeccion(ingresos),
      costos: mapearSeccion(costos),
      otrosCostos: mapearSeccion(otrosCostos),
      utilidadBrutaMinor: minorATexto(utilidadBruta),
      gastosAdministracion: mapearSeccion(gastosAdministracion),
      gastosComercializacion: mapearSeccion(gastosComercializacion),
      otrosGastos: mapearSeccion(otrosGastos),
      utilidadOperacionMinor: minorATexto(utilidadOperacion),
      otrosIngresos: mapearSeccion(otrosIngresos),
      gastosFinancieros: mapearSeccion(gastosFinancieros),
      resultadoAntesImpuestosMinor: minorATexto(resultadoAntesImpuestos),
      periodoAnterior: null
    };
  };

  const actual = calcular(entrada.desde, entrada.hasta);
  if (entrada.comparativo) {
    const anterior = rangoAnterior(entrada.desde, entrada.hasta);
    actual.periodoAnterior = calcular(anterior.desde, anterior.hasta);
  }
  return actual;
}

export interface FilaSituacion {
  codigo: string;
  nombre: string;
  corriente: boolean;
  sinClasificar: boolean;
  saldoMinor: string;
}

export interface EstadoSituacionFinanciera {
  corte: string;
  activo: { corriente: FilaSituacion[]; noCorriente: FilaSituacion[]; sinClasificar: FilaSituacion[]; totalMinor: string };
  pasivo: { corriente: FilaSituacion[]; noCorriente: FilaSituacion[]; sinClasificar: FilaSituacion[]; totalMinor: string };
  patrimonio: { filas: FilaSituacion[]; resultadoEjercicioMinor: string; totalMinor: string };
  cuadra: boolean;
  saldosContrarios: Array<{ codigo: string; nombre: string; saldoMinor: string }>;
  comparativo: EstadoSituacionFinanciera | null;
}

// Tabla ÚNICA de clasificación por grupo raíz (subiendo por padre_id). Una cuenta cuyo
// grupo raíz no esté en la tabla queda SIN CLASIFICAR, marcada, nunca dada por corriente.
const CLASIFICACION_CORRIENTE = new Map([
  ['11', 'corriente'], ['12', 'corriente'], ['13', 'corriente'], ['14', 'corriente'], ['15', 'noCorriente'],
  ['21', 'corriente'], ['22', 'corriente'], ['23', 'corriente'], ['24', 'noCorriente'], ['25', 'noCorriente'],
  ['26', 'noCorriente'], ['27', 'noCorriente'], ['28', 'noCorriente'], ['29', 'noCorriente']
]);

// Cuentas reguladoras: su saldo contrario natural NO se reporta como contrario (auditoría 72).
const CUENTAS_REGULADORAS = new Set(['1502']);

export function estadoSituacionFinanciera(
  db: Database.Database,
  entrada: { corte: string; corteComparativo?: string; ambitoId?: string }
): EstadoSituacionFinanciera {
  validarFechaCalendario(entrada.corte);
  const ambito = entrada.ambitoId ?? 'administrativo';
  const calcular = (corte: string): EstadoSituacionFinanciera => {
    const filas = (
      db
        .prepare(
          `SELECT c.id, c.codigo, c.nombre, c.tipo, c.es_grupo AS esGrupo, c.padre_id AS padreId,
                  COALESCE(SUM(CASE WHEN a.id IS NOT NULL AND a.fecha_operacion <= ?
                         THEN l.debe_minor - l.haber_minor ELSE 0 END), 0) AS saldo
           FROM cuenta c
           LEFT JOIN asiento_linea l ON l.cuenta_id = c.id
           LEFT JOIN asiento a ON a.id = l.asiento_id AND a.estado IN ('contabilizado','anulado')
                             AND a.ambito_id = ?
           WHERE c.es_grupo = 0
           GROUP BY c.id, c.codigo, c.nombre, c.tipo, c.es_grupo, c.padre_id
           ORDER BY c.codigo`
        )
        .safeIntegers(true)
        .all(corte, ambito) as Array<{
        id: number;
        codigo: string;
        nombre: string;
        tipo: string;
        esGrupo: number;
        padreId: number | null;
        saldo: bigint;
      }>
    );

    // Grupo raíz por cadena padre_id.
    const grupoRaiz = new Map<number, string>();
    const cuentaPorId = new Map<number, { codigo: string; padreId: number | null }>();
    for (const f of filas) {
      cuentaPorId.set(Number(f.id), { codigo: f.codigo, padreId: f.padreId === null ? null : Number(f.padreId) });
    }
    const grupos = db.prepare('SELECT id, codigo, padre_id AS padreId FROM cuenta WHERE es_grupo = 1').all() as Array<{
      id: number;
      codigo: string;
      padreId: number | null;
    }>;
    for (const g of grupos) {
      cuentaPorId.set(g.id, { codigo: g.codigo, padreId: g.padreId });
    }
    // Primer ancestro (subiendo por padre_id) cuyo código esté en la tabla de clasificación;
    // si ninguno está, la cuenta queda SIN CLASIFICAR (marcada, nunca dada por corriente).
    const clasificacionDe = (id: number, visitados: Set<number>): string | undefined => {
      const info = cuentaPorId.get(id);
      if (!info || visitados.has(id)) {
        return undefined;
      }
      visitados.add(id);
      const propio = CLASIFICACION_CORRIENTE.has(info.codigo.slice(0, 2)) ? info.codigo.slice(0, 2) : undefined;
      if (propio) {
        return propio;
      }
      if (info.padreId === null) {
        return undefined;
      }
      return clasificacionDe(info.padreId, visitados);
    };
    for (const f of filas) {
      grupoRaiz.set(Number(f.id), clasificacionDe(Number(f.id), new Set<number>()) ?? '');
    }

    const activoCorriente: FilaSituacion[] = [];
    const activoNoCorriente: FilaSituacion[] = [];
    const activoSinClasificar: FilaSituacion[] = [];
    const pasivoCorriente: FilaSituacion[] = [];
    const pasivoNoCorriente: FilaSituacion[] = [];
    const pasivoSinClasificar: FilaSituacion[] = [];
    const patrimonioFilas: FilaSituacion[] = [];
    const saldosContrarios: Array<{ codigo: string; nombre: string; saldoMinor: string }> = [];
    let totalActivo = 0n;
    let totalPasivo = 0n;
    let totalPatrimonio = 0n;
    let resultadoEjercicio = 0n;

    for (const f of filas) {
      const saldo = f.saldo;
      const raiz = grupoRaiz.get(Number(f.id)) ?? '';
      const clasificacion = CLASIFICACION_CORRIENTE.get(raiz);
      // Presentación por naturaleza: filas y totales en el mismo signo (auditoría 72).
      const natural = f.tipo === 'activo' ? saldo : -saldo;
      const fila: FilaSituacion = {
        codigo: f.codigo,
        nombre: f.nombre,
        corriente: clasificacion === 'corriente',
        sinClasificar: clasificacion === undefined,
        saldoMinor: minorATexto(natural)
      };
      const contrario =
        !CUENTAS_REGULADORAS.has(f.codigo) &&
        ((f.tipo === 'activo' && saldo < 0n) || ((f.tipo === 'pasivo' || f.tipo === 'patrimonio') && saldo > 0n));
      if (contrario) {
        saldosContrarios.push({ codigo: f.codigo, nombre: f.nombre, saldoMinor: minorATexto(natural) });
      }
      switch (f.tipo) {
        case 'activo': {
          totalActivo += saldo;
          if (clasificacion === 'corriente') {
            activoCorriente.push(fila);
          } else if (clasificacion === 'noCorriente') {
            activoNoCorriente.push(fila);
          } else {
            activoSinClasificar.push(fila);
          }
          break;
        }
        case 'pasivo': {
          totalPasivo += -saldo;
          if (clasificacion === 'corriente') {
            pasivoCorriente.push(fila);
          } else if (clasificacion === 'noCorriente') {
            pasivoNoCorriente.push(fila);
          } else {
            pasivoSinClasificar.push(fila);
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
        sinClasificar: false,
        saldoMinor: minorATexto(resultadoEjercicio)
      });
    }

    return {
      corte,
      activo: {
        corriente: activoCorriente,
        noCorriente: activoNoCorriente,
        sinClasificar: activoSinClasificar,
        totalMinor: minorATexto(totalActivo)
      },
      pasivo: {
        corriente: pasivoCorriente,
        noCorriente: pasivoNoCorriente,
        sinClasificar: pasivoSinClasificar,
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
