import type Database from 'better-sqlite3';
import { minorATexto, parseMontoMinor } from '../../shared/dinero';
import { validarFechaCalendario } from '../../shared/fechas';
import { contabilizarAsiento, anularAsiento } from './motorAsientos';
import { registroEvento } from './bitacora';
import { CUENTAS_REGULADORAS } from './estadosFinancieros';

// Activos fijos (bloque 3, tarea 3A): migración aplicada en v20; alta y cálculo de cuotas.
// Servicio puro: sin Electron, `db` por parámetro. Importes en menores enteros (bigint/safeIntegers).

// POLÍTICA PROPUESTA (regla 2 del bloque 3): la depreciación empieza el MES SIGUIENTE al
// inicio de uso. Pendiente de confirmación del contador; no hay tasas fiscales en el código.
export const POLITICA_INICIO_DEPRECIACION = 'mes_siguiente_al_inicio_de_uso' as const;

export class ErrorActivoFijo extends Error {}

export interface EntradaAltaActivoFijo {
  descripcion: string;
  categoria: string;
  ubicacion: string;
  responsable: string;
  fechaAdquisicion: string;
  fechaInicioUso: string;
  costoMinor: string;
  residualMinor: string;
  vidaUtilMeses: number;
  cuentaActivoId: number;
  cuentaDepreciacionId: number;
  cuentaGastoId: number;
  cuentaContrapartidaId?: number;
  compraId?: number;
  proyectoId?: number;
  ambitoId?: string;
}

export interface ActivoFijoAlta {
  id: number;
  codigo: string;
  asientoAltaId: number | null;
}

// Cuotas por línea recta mensual en centavos enteros: (costo - residual) / vida útil.
// El ÚLTIMO mes absorbe el redondeo: lo acumulado iguala exactamente lo depreciable.
export function calcularCuotas(depreciableMinor: bigint, vidaUtilMeses: number): bigint[] {
  if (vidaUtilMeses <= 0) {
    throw new ErrorActivoFijo('La vida útil debe ser mayor que cero');
  }
  if (depreciableMinor < 0n) {
    throw new ErrorActivoFijo('Lo depreciable no puede ser negativo');
  }
  // División entera HACIA ABAJO (auditoría 75): ninguna cuota negativa y el acumulado
  // nunca supera lo depreciable; el último mes absorbe la diferencia exacta.
  const cuotaBase = depreciableMinor / BigInt(vidaUtilMeses);
  const cuotas: bigint[] = [];
  let acumulado = 0n;
  for (let mes = 1; mes <= vidaUtilMeses; mes += 1) {
    if (mes === vidaUtilMeses) {
      cuotas.push(depreciableMinor - acumulado);
    } else {
      cuotas.push(cuotaBase);
      acumulado += cuotaBase;
    }
  }
  return cuotas;
}

// Mes (YYYY-MM) siguiente a una fecha calendario.
export function mesSiguiente(fecha: string): string {
  validarFechaCalendario(fecha);
  const anio = Number(fecha.slice(0, 4));
  const mes = Number(fecha.slice(5, 7));
  const siguiente = mes === 12 ? { anio: anio + 1, mes: 1 } : { anio, mes: mes + 1 };
  return `${siguiente.anio}-${String(siguiente.mes).padStart(2, '0')}`;
}

export interface CuotaDepreciacion {
  mes: string;
  numero: number;
  cuotaMinor: string;
  acumuladoMinor: string;
}

// Cuadro completo de cuotas de un activo: desde el mes siguiente al inicio de uso.
export function cuotasDepreciacionActivo(
  db: Database.Database,
  activoId: number
): { activoId: number; codigo: string; mesInicio: string; cuotas: CuotaDepreciacion[] } {
  const activo = db
    .prepare(
      `SELECT id, codigo, fecha_inicio_uso AS fechaInicioUso, costo_minor AS costo, residual_minor AS residual,
              vida_util_meses AS vidaUtilMeses
       FROM activo_fijo WHERE id = ?`
    )
    .safeIntegers(true)
    .get(activoId) as
    | {
        id: number;
        codigo: string;
        fechaInicioUso: string;
        costo: bigint;
        residual: bigint;
        vidaUtilMeses: number;
      }
    | undefined;
  if (!activo) {
    throw new ErrorActivoFijo(`No existe el activo fijo ${activoId}`);
  }
  const cuotas = calcularCuotas(activo.costo - activo.residual, activo.vidaUtilMeses);
  const inicio = mesSiguiente(activo.fechaInicioUso);
  const anioInicio = Number(inicio.slice(0, 4));
  const mesInicio = Number(inicio.slice(5, 7));
  const lista: CuotaDepreciacion[] = [];
  let acumulado = 0n;
  cuotas.forEach((cuota, i) => {
    acumulado += cuota;
    const numeroMes = mesInicio + i;
    const anio = anioInicio + Math.floor((numeroMes - 1) / 12);
    const mes = ((numeroMes - 1) % 12) + 1;
    lista.push({
      mes: `${anio}-${String(mes).padStart(2, '0')}`,
      numero: i + 1,
      cuotaMinor: minorATexto(cuota),
      acumuladoMinor: minorATexto(acumulado)
    });
  });
  return { activoId, codigo: activo.codigo, mesInicio: inicio, cuotas: lista };
}

function siguienteCodigo(db: Database.Database): string {
  const fila = db
    .prepare("SELECT MAX(CAST(substr(codigo, 4) AS INTEGER)) AS n FROM activo_fijo WHERE codigo LIKE 'AF-%'")
    .get() as { n: number | null };
  return `AF-${String((fila.n ?? 0) + 1).padStart(6, '0')}`;
}

function cuentaValida(db: Database.Database, cuentaId: number, tipo: string, rol: string): void {
  const cuenta = db
    .prepare('SELECT id, codigo, tipo, es_grupo, activa FROM cuenta WHERE id = ?')
    .get(cuentaId) as { id: number; codigo: string; tipo: string; es_grupo: number; activa: number } | undefined;
  if (!cuenta) {
    throw new ErrorActivoFijo(`La cuenta de ${rol} no existe`);
  }
  if (cuenta.es_grupo === 1) {
    throw new ErrorActivoFijo(`La cuenta de ${rol} no puede ser de grupo`);
  }
  if (!cuenta.activa) {
    throw new ErrorActivoFijo(`La cuenta de ${rol} está inactiva`);
  }
  if (cuenta.tipo !== tipo) {
    throw new ErrorActivoFijo(`La cuenta de ${rol} debe ser de tipo ${tipo} (cuenta ${cuenta.codigo})`);
  }
}

export function darAltaActivoFijo(db: Database.Database, entrada: EntradaAltaActivoFijo): ActivoFijoAlta {
  if (!entrada.descripcion?.trim()) {
    throw new ErrorActivoFijo('El activo requiere descripción');
  }
  if (!entrada.categoria?.trim()) {
    throw new ErrorActivoFijo('El activo requiere categoría');
  }
  if (!entrada.ubicacion?.trim()) {
    throw new ErrorActivoFijo('El activo requiere ubicación');
  }
  if (!entrada.responsable?.trim()) {
    throw new ErrorActivoFijo('El activo requiere responsable');
  }
  validarFechaCalendario(entrada.fechaAdquisicion);
  validarFechaCalendario(entrada.fechaInicioUso);
  if (entrada.fechaInicioUso < entrada.fechaAdquisicion) {
    throw new ErrorActivoFijo('El inicio de uso no puede ser anterior a la adquisición');
  }
  if (!Number.isInteger(entrada.vidaUtilMeses) || entrada.vidaUtilMeses <= 0) {
    throw new ErrorActivoFijo('La vida útil en meses debe ser un entero mayor que cero');
  }
  const ambitoId = entrada.ambitoId ?? 'administrativo';
  const ambito = db.prepare('SELECT id FROM ambito WHERE id = ? AND activo = 1').get(ambitoId);
  if (!ambito) {
    throw new ErrorActivoFijo(`Ámbito inexistente o inactivo: ${ambitoId}`);
  }
  cuentaValida(db, entrada.cuentaActivoId, 'activo', 'activo fijo');
  cuentaValida(db, entrada.cuentaDepreciacionId, 'activo', 'depreciación acumulada');
  cuentaValida(db, entrada.cuentaGastoId, 'gasto', 'gasto de depreciación');
  if (entrada.cuentaActivoId === entrada.cuentaDepreciacionId) {
    throw new ErrorActivoFijo('La cuenta de depreciación acumulada debe ser distinta de la cuenta del activo');
  }
  const cuentaDepreciacion = db
    .prepare('SELECT codigo FROM cuenta WHERE id = ?')
    .get(entrada.cuentaDepreciacionId) as { codigo: string };
  if (!CUENTAS_REGULADORAS.has(cuentaDepreciacion.codigo)) {
    throw new ErrorActivoFijo(`La cuenta de depreciación acumulada debe ser reguladora (cuenta ${cuentaDepreciacion.codigo})`);
  }

  let costoMinor: bigint;
  let residualMinor: bigint;
  try {
    costoMinor = parseMontoMinor(entrada.costoMinor);
    residualMinor = parseMontoMinor(entrada.residualMinor || '0');
  } catch {
    throw new ErrorActivoFijo('Importes inválidos');
  }
  if (costoMinor < 0n || residualMinor < 0n) {
    throw new ErrorActivoFijo('Costo y residual no pueden ser negativos');
  }
  if (residualMinor > costoMinor) {
    throw new ErrorActivoFijo('El valor residual no puede superar el costo');
  }

  const ejecutar = db.transaction((): ActivoFijoAlta => {
  const codigo = siguienteCodigo(db);

  // Regla 4: si viene de una compra ya contabilizada en la cuenta del activo, NO genera
  // otro asiento; en caso contrario genera asiento con cuenta de contrapartida elegida.
  // Asiento, activo y bitácora en UNA transacción (auditoría 75).
  let asientoAltaId: number | null = null;
  if (entrada.compraId) {
    const compra = db
      .prepare('SELECT id, estado FROM compra WHERE id = ?')
      .get(entrada.compraId) as { id: number; estado: string } | undefined;
    if (!compra) {
      throw new ErrorActivoFijo(`No existe la compra ${entrada.compraId}`);
    }
    if (compra.estado !== 'registrada') {
      throw new ErrorActivoFijo('La compra de origen debe estar registrada (contabilizada)');
    }
    // El asiento de la compra lleva origen_id = folio de la compra (CMP-XXXXXX).
    const tocaCuentaActivo = db
      .prepare(
        `SELECT 1 FROM asiento_linea l JOIN asiento a ON a.id = l.asiento_id
         WHERE a.origen_tipo = 'compra'
           AND a.origen_id = (SELECT folio FROM compra WHERE id = ?)
           AND l.cuenta_id = ?
         LIMIT 1`
      )
      .get(entrada.compraId, entrada.cuentaActivoId);
    if (!tocaCuentaActivo) {
      throw new ErrorActivoFijo('La compra de origen no está contabilizada en la cuenta del activo');
    }
    // La suma de costos de activos de una compra no puede superar lo contabilizado en esa cuenta.
    const contabilizado = (
      db
        .prepare(
          `SELECT COALESCE(SUM(l.debe_minor - l.haber_minor), 0) AS total
           FROM asiento_linea l JOIN asiento a ON a.id = l.asiento_id
           WHERE a.origen_tipo = 'compra'
             AND a.origen_id = (SELECT folio FROM compra WHERE id = ?)
             AND l.cuenta_id = ?`
        )
        .safeIntegers(true)
        .get(entrada.compraId, entrada.cuentaActivoId) as { total: bigint }
    ).total;
    const yaAsignado = (
      db
        .prepare('SELECT COALESCE(SUM(costo_minor), 0) AS total FROM activo_fijo WHERE compra_id = ?')
        .safeIntegers(true)
        .get(entrada.compraId) as { total: bigint }
    ).total;
    if (yaAsignado + costoMinor > contabilizado) {
      throw new ErrorActivoFijo(
        `El costo supera lo disponible de la compra en esa cuenta (disponible: ${minorATexto(contabilizado - yaAsignado)})`
      );
    }
  } else {
    if (!entrada.cuentaContrapartidaId) {
      throw new ErrorActivoFijo('Sin compra de origen se requiere la cuenta de contrapartida');
    }
    const contrapartida = db
      .prepare('SELECT tipo FROM cuenta WHERE id = ?')
      .get(entrada.cuentaContrapartidaId) as { tipo: string } | undefined;
    if (!contrapartida) {
      throw new ErrorActivoFijo('La cuenta de contrapartida no existe');
    }
    const resultado = contabilizarAsiento(db, {
      fechaOperacion: entrada.fechaAdquisicion,
      concepto: `Alta de activo fijo ${codigo}: ${entrada.descripcion.trim()}`,
      responsable: entrada.responsable.trim(),
      ambitoId,
      lineas: [
        { cuentaId: entrada.cuentaActivoId, debeMinor: minorATexto(costoMinor), haberMinor: '' },
        { cuentaId: entrada.cuentaContrapartidaId, debeMinor: '', haberMinor: minorATexto(costoMinor) }
      ],
      claveIdempotencia: `alta-activo:${codigo}`
    });
    asientoAltaId = (
      db.prepare('SELECT id FROM asiento WHERE folio = ?').get(resultado.folio) as { id: number }
    ).id;
  }

  const info = db
    .prepare(
      `INSERT INTO activo_fijo (codigo, descripcion, categoria, ubicacion, responsable,
        fecha_adquisicion, fecha_inicio_uso, costo_minor, residual_minor, vida_util_meses,
        cuenta_activo_id, cuenta_depreciacion_id, cuenta_gasto_id, compra_id, proyecto_id, estado, ambito_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'activo', ?)`
    )
    .run(
      codigo,
      entrada.descripcion.trim(),
      entrada.categoria.trim(),
      entrada.ubicacion.trim(),
      entrada.responsable.trim(),
      entrada.fechaAdquisicion,
      entrada.fechaInicioUso,
      costoMinor,
      residualMinor,
      entrada.vidaUtilMeses,
      entrada.cuentaActivoId,
      entrada.cuentaDepreciacionId,
      entrada.cuentaGastoId,
      entrada.compraId ?? null,
      entrada.proyectoId ?? null,
      ambitoId
    );
  const id = Number(info.lastInsertRowid);
  registroEvento(db, entrada.responsable.trim(), 'activo_fijo_alta', 'activo_fijo', String(id), {
    codigo,
    costo: minorATexto(costoMinor),
    residual: minorATexto(residualMinor),
    vidaUtilMeses: entrada.vidaUtilMeses,
    politicaInicio: POLITICA_INICIO_DEPRECIACION,
    asientoAltaId
  });
    return { id, codigo, asientoAltaId };
  });
  return ejecutar();
}
// ─── Bloque 3, tarea 3B: depreciación del mes y anulación del último lote ───

export interface FilaPrevisualizacionDepreciacion {
  activoId: number;
  codigo: string;
  descripcion: string;
  cuentaGastoId: number;
  cuentaDepreciacionId: number;
  numeroCuota: number;
  cuotaMinor: string;
}

export interface PrevisualizacionDepreciacion {
  mes: string;
  filas: FilaPrevisualizacionDepreciacion[];
  totalMinor: string;
}

function cuotasAplicadas(db: Database.Database, activoId: number): number {
  return (
    db.prepare('SELECT COUNT(*) AS n FROM depreciacion_detalle WHERE activo_fijo_id = ?').get(activoId) as { n: number }
  ).n;
}

// Vista previa del mes: activos con cuota pendiente EN ese mes, sin huecos por activo
// (la cuota n exige las 1..n-1 aplicadas), excluyendo dados de baja y totalmente depreciados.
export function previsualizarDepreciacion(db: Database.Database, mes: string): PrevisualizacionDepreciacion {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) {
    throw new ErrorActivoFijo(`Mes inválido: ${mes}`);
  }
  const activos = db
    .prepare(
      `SELECT id, codigo, descripcion, cuenta_gasto_id AS cuentaGastoId, cuenta_depreciacion_id AS cuentaDepreciacionId
       FROM activo_fijo WHERE estado = 'activo' ORDER BY codigo`
    )
    .all() as Array<{
    id: number;
    codigo: string;
    descripcion: string;
    cuentaGastoId: number;
    cuentaDepreciacionId: number;
  }>;
  const filas: FilaPrevisualizacionDepreciacion[] = [];
  let total = 0n;
  for (const activo of activos) {
    const cuadro = cuotasDepreciacionActivo(db, activo.id);
    const aplicadas = cuotasAplicadas(db, activo.id);
    if (aplicadas >= cuadro.cuotas.length) {
      continue; // totalmente depreciado
    }
    const cuota = cuadro.cuotas.find(c => c.mes === mes);
    if (!cuota) {
      continue; // sin cuota en ese mes
    }
    if (cuota.numero !== aplicadas + 1) {
      continue; // hueco: exige la cuota siguiente a la última aplicada
    }
    const cuotaMinor = parseMontoMinor(cuota.cuotaMinor);
    filas.push({
      activoId: activo.id,
      codigo: activo.codigo,
      descripcion: activo.descripcion,
      cuentaGastoId: activo.cuentaGastoId,
      cuentaDepreciacionId: activo.cuentaDepreciacionId,
      numeroCuota: cuota.numero,
      cuotaMinor: cuota.cuotaMinor
    });
    total += cuotaMinor;
  }
  return { mes, filas, totalMinor: minorATexto(total) };
}

export interface ResultadoDepreciacionMes {
  loteId: number;
  asientoFolio: string;
  totalMinor: string;
  existente: boolean;
}

// Depreciación del mes (acción explícita; la vista previa es aparte). Un asiento por mes
// con clave idempotente depreciacion:YYYY-MM y una línea por combinación de cuentas.
// Respeta períodos cerrados y no admite huecos por activo.
export function depreciarMes(
  db: Database.Database,
  entrada: { mes: string; responsable: string }
): ResultadoDepreciacionMes {
  if (!entrada.responsable?.trim()) {
    throw new ErrorActivoFijo('La depreciación requiere responsable');
  }
  const ejecutar = db.transaction((): ResultadoDepreciacionMes => {
    // Idempotente PRIMERO: si el mes ya tiene lote, no se duplica aunque ya no quede nada pendiente.
    const existente = db
      .prepare('SELECT id, asiento_id, total_minor FROM depreciacion_lote WHERE mes = ?')
      .get(entrada.mes) as { id: number; asiento_id: number; total_minor: number } | undefined;
    if (existente) {
      const folio = (db.prepare('SELECT folio FROM asiento WHERE id = ?').get(existente.asiento_id) as { folio: string }).folio;
      return {
        loteId: existente.id,
        asientoFolio: folio,
        totalMinor: minorATexto(BigInt(existente.total_minor)),
        existente: true
      };
    }
    const previo = previsualizarDepreciacion(db, entrada.mes);
    if (previo.filas.length === 0) {
      throw new ErrorActivoFijo(`Nada que depreciar en ${entrada.mes}`);
    }
    // Período cerrado: se rechaza antes de contabilizar.
    const periodo = db
      .prepare('SELECT id, estado FROM periodo WHERE inicio = ?')
      .get(`${entrada.mes}-01`) as { id: number; estado: string } | undefined;
    if (periodo && periodo.estado !== 'abierto') {
      throw new ErrorActivoFijo(`El período de ${entrada.mes} está ${periodo.estado}`);
    }
    // Una línea por combinación de cuentas (gasto al debe, acumulada al haber).
    const porCombinacion = new Map<string, { gasto: number; acumulada: number; total: bigint }>();
    for (const fila of previo.filas) {
      const clave = `${fila.cuentaGastoId}:${fila.cuentaDepreciacionId}`;
      const actual = porCombinacion.get(clave) ?? { gasto: fila.cuentaGastoId, acumulada: fila.cuentaDepreciacionId, total: 0n };
      actual.total += parseMontoMinor(fila.cuotaMinor);
      porCombinacion.set(clave, actual);
    }
    const lineas = [...porCombinacion.values()].map(c => [
      { cuentaId: c.gasto, debeMinor: minorATexto(c.total), haberMinor: '' },
      { cuentaId: c.acumulada, debeMinor: '', haberMinor: minorATexto(c.total) }
    ]).flat();
    const totalMinor = [...porCombinacion.values()].reduce((s, c) => s + c.total, 0n);
    const asiento = contabilizarAsiento(db, {
      fechaOperacion: finDeMesCalendario(entrada.mes),
      concepto: `Depreciación del mes ${entrada.mes}`,
      responsable: entrada.responsable.trim(),
      ambitoId: 'administrativo',
      lineas,
      origenTipo: 'depreciacion',
      origenId: entrada.mes,
      claveIdempotencia: `depreciacion:${entrada.mes}`
    });
    const asientoId = (db.prepare('SELECT id FROM asiento WHERE folio = ?').get(asiento.folio) as { id: number }).id;
    const lote = db
      .prepare('INSERT INTO depreciacion_lote (mes, asiento_id, total_minor, responsable) VALUES (?, ?, ?, ?)')
      .run(entrada.mes, asientoId, totalMinor, entrada.responsable.trim());
    const loteId = Number(lote.lastInsertRowid);
    for (const fila of previo.filas) {
      db.prepare('INSERT INTO depreciacion_detalle (lote_id, activo_fijo_id, mes, cuota_minor) VALUES (?, ?, ?, ?)').run(
        loteId,
        fila.activoId,
        entrada.mes,
        parseMontoMinor(fila.cuotaMinor)
      );
    }
    registroEvento(db, entrada.responsable.trim(), 'depreciacion_mes', 'depreciacion_lote', String(loteId), {
      mes: entrada.mes,
      total: minorATexto(totalMinor),
      activos: previo.filas.length,
      asiento: asiento.folio
    });
    return { loteId, asientoFolio: asiento.folio, totalMinor: minorATexto(totalMinor), existente: false };
  });
  return ejecutar();
}

// Último día del mes YYYY-MM (fechas UTC, sin bisiesto especial: lo resuelve Date).
function finDeMesCalendario(mes: string): string {
  const anio = Number(mes.slice(0, 4));
  const mesNumero = Number(mes.slice(5, 7));
  const fin = new Date(Date.UTC(anio, mesNumero, 0));
  return fin.toISOString().slice(0, 10);
}

// Anular SOLO el último lote, por reverso, con motivo y responsable. Los detalles se
// eliminan para que el mes pueda rehacerse.
export function anularUltimoLote(
  db: Database.Database,
  entrada: { responsable: string; motivo: string }
): { loteId: number; mes: string; reversoFolio: string } {
  if (!entrada.responsable?.trim() || !entrada.motivo?.trim()) {
    throw new ErrorActivoFijo('La anulación del lote requiere responsable y motivo');
  }
  const ejecutar = db.transaction((): { loteId: number; mes: string; reversoFolio: string } => {
    const lote = db
      .prepare('SELECT id, mes, asiento_id FROM depreciacion_lote ORDER BY mes DESC LIMIT 1')
      .get() as { id: number; mes: string; asiento_id: number } | undefined;
    if (!lote) {
      throw new ErrorActivoFijo('No hay lotes de depreciación que anular');
    }
    // Solo el último: no debe existir ningún lote posterior.
    const posteriores = (
      db.prepare('SELECT COUNT(*) AS n FROM depreciacion_lote WHERE mes > ?').get(lote.mes) as { n: number }
    ).n;
    if (posteriores > 0) {
      throw new ErrorActivoFijo('Solo se puede anular el último lote');
    }
    const reverso = anularAsiento(db, lote.asiento_id, entrada.responsable.trim(), entrada.motivo.trim());
    db.prepare('DELETE FROM depreciacion_detalle WHERE lote_id = ?').run(lote.id);
    db.prepare('DELETE FROM depreciacion_lote WHERE id = ?').run(lote.id);
    registroEvento(db, entrada.responsable.trim(), 'depreciacion_lote_anulado', 'depreciacion_lote', String(lote.id), {
      mes: lote.mes,
      motivo: entrada.motivo.trim(),
      reverso: reverso.folio
    });
    return { loteId: lote.id, mes: lote.mes, reversoFolio: reverso.folio };
  });
  return ejecutar();
}
