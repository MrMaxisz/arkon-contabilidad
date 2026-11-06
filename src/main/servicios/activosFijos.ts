import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { minorATexto, parseMontoMinor } from '../../shared/dinero';
import { validarFechaCalendario } from '../../shared/fechas';
import { contabilizarAsiento, anularAsiento } from './motorAsientos';
import { registroEvento } from './bitacora';
import { CUENTAS_REGULADORAS } from './estadosFinancieros';
import { escaparCsv } from './fiscal';

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
        id: bigint;
        codigo: string;
        fechaInicioUso: string;
        costo: bigint;
        residual: bigint;
        vidaUtilMeses: bigint;
      }
    | undefined;
  if (!activo) {
    throw new ErrorActivoFijo(`No existe el activo fijo ${activoId}`);
  }
  const cuotas = calcularCuotas(activo.costo - activo.residual, Number(activo.vidaUtilMeses));
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
  mes: string;
  cuotaMinor: string;
}

export interface PrevisualizacionDepreciacion {
  mes: string;
  filas: FilaPrevisualizacionDepreciacion[];
  totalMinor: string;
}

// Incluye todas las cuotas pendientes hasta el mes pedido, en orden de mes y activo.
export function previsualizarDepreciacion(db: Database.Database, mes: string): PrevisualizacionDepreciacion {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) {
    throw new ErrorActivoFijo(`Mes inválido: ${mes}`);
  }
  const activos = db
    .prepare(
      `SELECT id, codigo, descripcion, cuenta_gasto_id AS cuentaGastoId, cuenta_depreciacion_id AS cuentaDepreciacionId
       FROM activo_fijo WHERE estado = 'activo' AND ambito_id = 'administrativo' ORDER BY codigo`
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
    const aplicadas = new Set(
      (db.prepare('SELECT mes FROM depreciacion_detalle WHERE activo_fijo_id = ?').all(activo.id) as Array<{ mes: string }>)
        .map(c => c.mes)
    );
    for (const cuota of cuadro.cuotas) {
      if (cuota.mes > mes || aplicadas.has(cuota.mes)) {
        continue;
      }
      filas.push({
        activoId: activo.id,
        codigo: activo.codigo,
        descripcion: activo.descripcion,
        cuentaGastoId: activo.cuentaGastoId,
        cuentaDepreciacionId: activo.cuentaDepreciacionId,
        numeroCuota: cuota.numero,
        mes: cuota.mes,
        cuotaMinor: cuota.cuotaMinor
      });
      total += parseMontoMinor(cuota.cuotaMinor);
    }
  }
  filas.sort((a, b) => a.mes.localeCompare(b.mes) || a.codigo.localeCompare(b.codigo));
  return { mes, filas, totalMinor: minorATexto(total) };
}

export interface ResultadoDepreciacionMes {
  loteId: number;
  asientoFolio: string;
  totalMinor: string;
  existente: boolean;
}

// Cada ejecución con pendientes crea un asiento propio al cierre del mes pedido.
// La idempotencia se determina por las cuotas pendientes, incluso con altas tardías.
export function depreciarMes(
  db: Database.Database,
  entrada: { mes: string; responsable: string }
): ResultadoDepreciacionMes {
  if (!entrada.responsable?.trim()) {
    throw new ErrorActivoFijo('La depreciación requiere responsable');
  }
  const ejecutar = db.transaction((): ResultadoDepreciacionMes => {
    const previo = previsualizarDepreciacion(db, entrada.mes);
    if (previo.filas.length === 0) {
      const existente = db
        .prepare(`SELECT l.id, a.folio, l.total_minor AS total
                  FROM depreciacion_lote l JOIN asiento a ON a.id = l.asiento_id
                  ORDER BY l.id DESC LIMIT 1`)
        .safeIntegers(true)
        .get() as { id: bigint; folio: string; total: bigint } | undefined;
      if (existente) {
        return {
          loteId: Number(existente.id),
          asientoFolio: existente.folio,
          totalMinor: minorATexto(existente.total),
          existente: true
        };
      }
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
      claveIdempotencia: `depreciacion:${entrada.mes}:${randomUUID()}`
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
        fila.mes,
        parseMontoMinor(fila.cuotaMinor)
      );
    }
    registroEvento(db, entrada.responsable.trim(), 'depreciacion_mes', 'depreciacion_lote', String(loteId), {
      mes: entrada.mes,
      total: minorATexto(totalMinor),
      activos: new Set(previo.filas.map(f => f.activoId)).size,
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
      .prepare('SELECT id, mes, asiento_id FROM depreciacion_lote ORDER BY id DESC LIMIT 1')
      .get() as { id: number; mes: string; asiento_id: number } | undefined;
    if (!lote) {
      throw new ErrorActivoFijo('No hay lotes de depreciación que anular');
    }
    const afectaBaja = db.prepare(`SELECT 1 FROM depreciacion_detalle d
      JOIN baja_activo_fijo b ON b.activo_fijo_id = d.activo_fijo_id AND b.estado = 'registrada'
      WHERE d.lote_id = ? LIMIT 1`).get(lote.id);
    if (afectaBaja) {
      throw new ErrorActivoFijo('El lote afecta una baja o venta vigente; anule primero la baja');
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

// ─── Bloque 3C: baja o venta administrativa, sin IVA ───
export interface EntradaBajaActivoFijo {
  activoId: number;
  tipo: 'baja' | 'venta';
  fechaOperacion: string;
  importeMinor?: string;
  cuentaCobroId?: number;
  responsable: string;
  motivo: string;
}

export interface ResultadoBajaActivoFijo {
  bajaId: number;
  asientoId: number;
  asientoFolio: string;
  depreciacionPendienteMinor: string;
  acumuladaMinor: string;
  valorLibrosMinor: string;
  resultadoMinor: string;
}

export function darBajaActivoFijo(
  db: Database.Database,
  entrada: EntradaBajaActivoFijo
): ResultadoBajaActivoFijo {
  validarFechaCalendario(entrada.fechaOperacion);
  if (!entrada.responsable?.trim() || !entrada.motivo?.trim()) {
    throw new ErrorActivoFijo('La baja requiere responsable y motivo');
  }
  if (entrada.tipo !== 'baja' && entrada.tipo !== 'venta') {
    throw new ErrorActivoFijo('Tipo de baja inválido');
  }
  const importe = parseMontoMinor(entrada.importeMinor ?? '0');
  if (importe < 0n || (entrada.tipo === 'baja' && importe !== 0n)) {
    throw new ErrorActivoFijo('Importe inválido para la baja o venta');
  }
  return db.transaction((): ResultadoBajaActivoFijo => {
    const activo = db.prepare(`SELECT codigo, estado, fecha_adquisicion AS fechaAdquisicion,
        costo_minor AS costo, cuenta_activo_id AS cuentaActivoId,
        cuenta_depreciacion_id AS cuentaDepreciacionId, cuenta_gasto_id AS cuentaGastoId
      FROM activo_fijo WHERE id = ? AND ambito_id = 'administrativo'`)
      .safeIntegers(true).get(entrada.activoId) as {
        codigo: string; estado: string; fechaAdquisicion: string; costo: bigint;
        cuentaActivoId: bigint; cuentaDepreciacionId: bigint; cuentaGastoId: bigint;
      } | undefined;
    if (!activo || activo.estado !== 'activo') {
      throw new ErrorActivoFijo('El activo no existe en el ámbito administrativo o ya está de baja');
    }
    if (entrada.fechaOperacion < activo.fechaAdquisicion) {
      throw new ErrorActivoFijo('La baja no puede ser anterior a la adquisición');
    }
    if (importe > 0n) {
      cuentaValida(db, entrada.cuentaCobroId ?? 0, 'activo', 'cobro');
      if ([Number(activo.cuentaActivoId), Number(activo.cuentaDepreciacionId)].includes(entrada.cuentaCobroId!)) {
        throw new ErrorActivoFijo('La cuenta de cobro debe ser distinta del activo y su acumulada');
      }
    }
    const aplicadas = db.prepare(`SELECT d.mes, d.cuota_minor AS cuota, a.fecha_operacion AS fecha
      FROM depreciacion_detalle d JOIN depreciacion_lote l ON l.id = d.lote_id
      JOIN asiento a ON a.id = l.asiento_id WHERE d.activo_fijo_id = ?`)
      .safeIntegers(true).all(entrada.activoId) as Array<{ mes: string; cuota: bigint; fecha: string }>;
    const mes = entrada.fechaOperacion.slice(0, 7);
    if (aplicadas.some(c => c.mes > mes || c.fecha > entrada.fechaOperacion)) {
      throw new ErrorActivoFijo('El activo tiene depreciación posterior a la fecha de baja');
    }
    const mesesAplicados = new Set(aplicadas.map(c => c.mes));
    const pendientes = cuotasDepreciacionActivo(db, entrada.activoId).cuotas
      .filter(c => c.mes <= mes && !mesesAplicados.has(c.mes));
    const pendiente = pendientes.reduce((s, c) => s + parseMontoMinor(c.cuotaMinor), 0n);
    const acumulada = aplicadas.reduce((s, c) => s + c.cuota, pendiente);
    const libros = activo.costo - acumulada;
    if (libros < 0n) {
      throw new ErrorActivoFijo('La depreciación acumulada supera el costo del activo');
    }
    const resultado = importe - libros;
    const lineas: Array<{ cuentaId: number; debeMinor: string; haberMinor: string }> = [];
    const linea = (cuentaId: number, debe: bigint, haber = 0n): void => {
      if (debe !== 0n || haber !== 0n) {
        lineas.push({ cuentaId, debeMinor: minorATexto(debe), haberMinor: minorATexto(haber) });
      }
    };
    // Las cuotas pendientes se devengan a la fecha de baja (incluye todo su mes).
    // El mismo asiento retira costo y acumulada y reconoce el resultado.
    linea(Number(activo.cuentaGastoId), pendiente);
    linea(Number(activo.cuentaDepreciacionId), 0n, pendiente);
    linea(Number(activo.cuentaActivoId), 0n, activo.costo);
    linea(Number(activo.cuentaDepreciacionId), acumulada);
    if (importe > 0n) linea(entrada.cuentaCobroId!, importe);
    if (resultado !== 0n) {
      const cuenta = db.prepare('SELECT id FROM cuenta WHERE codigo = ?')
        .get(resultado > 0n ? '4202' : '6402') as { id: number } | undefined;
      if (!cuenta) throw new ErrorActivoFijo('Falta la cuenta de resultado de baja o venta');
      cuentaValida(db, cuenta.id, resultado > 0n ? 'ingreso' : 'gasto', 'resultado');
      linea(cuenta.id, resultado < 0n ? -resultado : 0n, resultado > 0n ? resultado : 0n);
    }
    const asiento = contabilizarAsiento(db, {
      fechaOperacion: entrada.fechaOperacion,
      concepto: `${entrada.tipo === 'venta' ? 'Venta' : 'Baja'} de activo fijo ${activo.codigo}: ${entrada.motivo.trim()}`,
      responsable: entrada.responsable.trim(), ambitoId: 'administrativo', lineas,
      origenTipo: 'baja_activo_fijo', origenId: String(entrada.activoId)
    });
    if (pendientes.length > 0) {
      const lote = db.prepare(`INSERT INTO depreciacion_lote (mes, asiento_id, total_minor, responsable)
        VALUES (?, ?, ?, ?)`).run(mes, asiento.asientoId, pendiente, entrada.responsable.trim());
      const insertar = db.prepare(`INSERT INTO depreciacion_detalle (lote_id, activo_fijo_id, mes, cuota_minor)
        VALUES (?, ?, ?, ?)`);
      for (const cuota of pendientes) {
        insertar.run(lote.lastInsertRowid, entrada.activoId, cuota.mes, parseMontoMinor(cuota.cuotaMinor));
      }
    }
    const baja = db.prepare(`INSERT INTO baja_activo_fijo
      (activo_fijo_id, fecha_operacion, tipo, importe_minor, acumulada_minor, asiento_id, responsable, motivo)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(entrada.activoId, entrada.fechaOperacion,
      entrada.tipo, importe, acumulada, asiento.asientoId, entrada.responsable.trim(), entrada.motivo.trim());
    db.prepare('UPDATE activo_fijo SET estado = ? WHERE id = ?')
      .run(entrada.tipo === 'venta' ? 'vendido' : 'dado_de_baja', entrada.activoId);
    const salida: ResultadoBajaActivoFijo = {
      bajaId: Number(baja.lastInsertRowid), asientoId: asiento.asientoId, asientoFolio: asiento.folio,
      depreciacionPendienteMinor: minorATexto(pendiente), acumuladaMinor: minorATexto(acumulada),
      valorLibrosMinor: minorATexto(libros), resultadoMinor: minorATexto(resultado)
    };
    registroEvento(db, entrada.responsable.trim(), 'activo_fijo_baja', 'activo_fijo', String(entrada.activoId), {
      ...salida, tipo: entrada.tipo, importe: minorATexto(importe), motivo: entrada.motivo.trim()
    });
    return salida;
  })();
}

export function anularBajaActivoFijo(
  db: Database.Database,
  entrada: { bajaId: number; responsable: string; motivo: string }
): { reversoFolio: string } {
  if (!entrada.responsable?.trim() || !entrada.motivo?.trim()) {
    throw new ErrorActivoFijo('La anulación de la baja requiere responsable y motivo');
  }
  return db.transaction(() => {
    const baja = db.prepare(`SELECT b.activo_fijo_id AS activoId, b.asiento_id AS asientoId,
        b.fecha_operacion AS fecha
      FROM baja_activo_fijo b JOIN activo_fijo f ON f.id = b.activo_fijo_id
      WHERE b.id = ? AND b.estado = 'registrada' AND f.ambito_id = 'administrativo'`)
      .get(entrada.bajaId) as { activoId: number; asientoId: number; fecha: string } | undefined;
    if (!baja) throw new ErrorActivoFijo('No existe una baja vigente en el ámbito administrativo');
    const posterior = db.prepare(`SELECT 1 FROM asiento a WHERE a.ambito_id = 'administrativo'
      AND a.estado IN ('contabilizado','anulado') AND a.id != ?
      AND (a.id > ? OR a.fecha_operacion > ?)
      AND ((a.origen_tipo IN ('activo_fijo','baja_activo_fijo') AND a.origen_id = ?)
        OR EXISTS (SELECT 1 FROM depreciacion_lote l JOIN depreciacion_detalle d ON d.lote_id = l.id
                   WHERE l.asiento_id = a.id AND d.activo_fijo_id = ?)) LIMIT 1`)
      .get(baja.asientoId, baja.asientoId, baja.fecha, String(baja.activoId), baja.activoId);
    if (posterior) throw new ErrorActivoFijo('El activo tiene movimientos posteriores a la baja');
    const reverso = anularAsiento(db, baja.asientoId, entrada.responsable.trim(), entrada.motivo.trim(), true);
    // Solo se liberan las cuotas creadas por esta baja; los lotes previos se conservan.
    db.prepare(`DELETE FROM depreciacion_detalle WHERE lote_id IN
      (SELECT id FROM depreciacion_lote WHERE asiento_id = ?)`).run(baja.asientoId);
    db.prepare('DELETE FROM depreciacion_lote WHERE asiento_id = ?').run(baja.asientoId);
    db.prepare("UPDATE baja_activo_fijo SET estado = 'anulada', reverso_id = ? WHERE id = ?")
      .run(reverso.asientoId, entrada.bajaId);
    db.prepare("UPDATE activo_fijo SET estado = 'activo' WHERE id = ?").run(baja.activoId);
    registroEvento(db, entrada.responsable.trim(), 'activo_fijo_baja_anulada', 'activo_fijo', String(baja.activoId), {
      bajaId: entrada.bajaId, reverso: reverso.folio, motivo: entrada.motivo.trim()
    });
    return { reversoFolio: reverso.folio };
  })();
}

// ─── Bloque 3D: reportes de activos fijos (sin interfaz) ───
// El cuadro y la conciliación son de SOLO LECTURA: la diferencia se informa y nunca se ajusta.

export interface FilaCuadroActivosFijos {
  activoId: number;
  codigo: string;
  descripcion: string;
  categoria: string;
  estado: string;
  costoMinor: string;
  acumuladaMinor: string;
  valorLibrosMinor: string;
  gastoPeriodoMinor: string;
}

export interface FilaCuadroCategoriaActivosFijos {
  categoria: string;
  costoMinor: string;
  acumuladaMinor: string;
  valorLibrosMinor: string;
  gastoPeriodoMinor: string;
}

export interface TotalesCuadroActivosFijos {
  costoMinor: string;
  acumuladaMinor: string;
  valorLibrosMinor: string;
  gastoPeriodoMinor: string;
}

export interface CuadroGeneralActivosFijos {
  corte: string;
  periodoDesde: string;
  periodoHasta: string;
  filas: FilaCuadroActivosFijos[];
  categorias: FilaCuadroCategoriaActivosFijos[];
  totales: TotalesCuadroActivosFijos;
}

interface TotalesCrudos {
  costo: bigint;
  acumulada: bigint;
  valorLibros: bigint;
  gasto: bigint;
}

function totalesVacios(): TotalesCrudos {
  return { costo: 0n, acumulada: 0n, valorLibros: 0n, gasto: 0n };
}

function totalesATexto(t: TotalesCrudos): TotalesCuadroActivosFijos {
  return {
    costoMinor: minorATexto(t.costo),
    acumuladaMinor: minorATexto(t.acumulada),
    valorLibrosMinor: minorATexto(t.valorLibros),
    gastoPeriodoMinor: minorATexto(t.gasto)
  };
}

// Cuadro general a una fecha de corte. El gasto del período es el del EJERCICIO del corte
// (1 de enero a la fecha de corte), coherente con el aviso de Cierre. Solo activos del
// ámbito administrativo vigentes al corte; los dados de baja antes del corte no se incluyen.
export function cuadroGeneralActivosFijos(db: Database.Database, corte: string): CuadroGeneralActivosFijos {
  validarFechaCalendario(corte);
  const periodoDesde = `${corte.slice(0, 4)}-01-01`;
  const activos = db
    .prepare(
      `SELECT f.id, f.codigo, f.descripcion, f.categoria, f.costo_minor AS costo,
              f.cuenta_activo_id AS cuentaActivoId, f.cuenta_depreciacion_id AS cuentaDepreciacionId
       FROM activo_fijo f
       WHERE f.ambito_id = 'administrativo'
         AND f.fecha_adquisicion <= ?
         AND NOT EXISTS (
           SELECT 1 FROM baja_activo_fijo b
           WHERE b.activo_fijo_id = f.id AND b.estado = 'registrada' AND b.fecha_operacion <= ?
         )
       ORDER BY f.categoria, f.codigo`
    )
    .safeIntegers(true)
    .all(corte, corte) as Array<{
    id: bigint;
    codigo: string;
    descripcion: string;
    categoria: string;
    costo: bigint;
    cuentaActivoId: bigint;
    cuentaDepreciacionId: bigint;
  }>;
  // La acumulada y el gasto se toman por la FECHA DEL ASIENTO del lote, no solo por el mes:
  // un corte anterior al cierre del mes no debe incluir una depreciación contabilizada después.
  const acumuladas = db
    .prepare(
      `SELECT d.activo_fijo_id AS activoId,
              COALESCE(SUM(CASE WHEN a.fecha_operacion <= ? THEN d.cuota_minor ELSE 0 END), 0) AS acumulada,
              COALESCE(SUM(CASE WHEN a.fecha_operacion >= ? AND a.fecha_operacion <= ? THEN d.cuota_minor ELSE 0 END), 0) AS gasto
       FROM depreciacion_detalle d
       JOIN depreciacion_lote l ON l.id = d.lote_id
       JOIN asiento a ON a.id = l.asiento_id
       WHERE a.estado = 'contabilizado'
       GROUP BY d.activo_fijo_id`
    )
    .safeIntegers(true)
    .all(corte, periodoDesde, corte) as Array<{ activoId: bigint; acumulada: bigint; gasto: bigint }>;
  const porActivo = new Map(acumuladas.map(a => [Number(a.activoId), a]));

  const filas: FilaCuadroActivosFijos[] = [];
  const categorias = new Map<string, TotalesCrudos>();
  const totales = totalesVacios();
  for (const activo of activos) {
    const mov = porActivo.get(Number(activo.id)) ?? { acumulada: 0n, gasto: 0n };
    const acumulada = mov.acumulada;
    const valorLibros = activo.costo - acumulada;
    filas.push({
      activoId: Number(activo.id),
      codigo: activo.codigo,
      descripcion: activo.descripcion,
      categoria: activo.categoria,
      estado: 'activo',
      costoMinor: minorATexto(activo.costo),
      acumuladaMinor: minorATexto(acumulada),
      valorLibrosMinor: minorATexto(valorLibros),
      gastoPeriodoMinor: minorATexto(mov.gasto)
    });
    const acumuladoCategoria = categorias.get(activo.categoria) ?? totalesVacios();
    acumuladoCategoria.costo += activo.costo;
    acumuladoCategoria.acumulada += acumulada;
    acumuladoCategoria.valorLibros += valorLibros;
    acumuladoCategoria.gasto += mov.gasto;
    categorias.set(activo.categoria, acumuladoCategoria);
    totales.costo += activo.costo;
    totales.acumulada += acumulada;
    totales.valorLibros += valorLibros;
    totales.gasto += mov.gasto;
  }
  return {
    corte,
    periodoDesde,
    periodoHasta: corte,
    filas,
    categorias: [...categorias.entries()].map(([categoria, t]) => ({
      categoria,
      ...totalesATexto(t)
    })),
    totales: totalesATexto(totales)
  };
}

export interface FilaConciliacionActivosFijos {
  cuentaId: number;
  codigo: string;
  nombre: string;
  tipo: 'activo' | 'acumulada';
  saldoMayorMinor: string;
  saldoReporteMinor: string;
  diferenciaMinor: string;
}

export interface ConciliacionActivosFijos {
  corte: string;
  filas: FilaConciliacionActivosFijos[];
  cuadra: boolean;
  totalDiferenciaMinor: string;
}

// Conciliación contra el mayor. En la cuenta de activo se compara el saldo deudor; en la
// acumulada, su saldo acreedor natural (positivo). La diferencia es reporte - mayor.
// Si difiere, solo se informa: esta función no registra ningún asiento ni ajuste.
export function conciliacionActivosFijos(db: Database.Database, corte: string): ConciliacionActivosFijos {
  validarFechaCalendario(corte);
  const cuentas = db
    .prepare(
      `SELECT DISTINCT f.cuenta_activo_id AS cuentaId, 'activo' AS tipo
       FROM activo_fijo f WHERE f.ambito_id = 'administrativo'
       UNION
       SELECT DISTINCT f.cuenta_depreciacion_id AS cuentaId, 'acumulada' AS tipo
       FROM activo_fijo f WHERE f.ambito_id = 'administrativo'`
    )
    .all() as Array<{ cuentaId: number; tipo: 'activo' | 'acumulada' }>;
  if (cuentas.length === 0) {
    return { corte, filas: [], cuadra: true, totalDiferenciaMinor: '0.00' };
  }
  const nombres = new Map(
    (db.prepare('SELECT id, codigo, nombre FROM cuenta').all() as Array<{ id: number; codigo: string; nombre: string }>)
      .map(c => [c.id, c])
  );
  const costoPorCuenta = new Map(
    (db
      .prepare(
        `SELECT f.cuenta_activo_id AS cuentaId, COALESCE(SUM(f.costo_minor), 0) AS total
         FROM activo_fijo f
         WHERE f.ambito_id = 'administrativo'
           AND f.fecha_adquisicion <= ?
           AND NOT EXISTS (
             SELECT 1 FROM baja_activo_fijo b
             WHERE b.activo_fijo_id = f.id AND b.estado = 'registrada' AND b.fecha_operacion <= ?
           )
         GROUP BY f.cuenta_activo_id`
      )
      .safeIntegers(true)
      .all(corte, corte) as Array<{ cuentaId: bigint; total: bigint }>)
      .map(f => [Number(f.cuentaId), f.total])
  );
  const acumuladaPorCuenta = new Map(
    (db
      .prepare(
        `SELECT f.cuenta_depreciacion_id AS cuentaId, COALESCE(SUM(d.cuota_minor), 0) AS total
         FROM depreciacion_detalle d
         JOIN depreciacion_lote l ON l.id = d.lote_id
         JOIN asiento a ON a.id = l.asiento_id
         JOIN activo_fijo f ON f.id = d.activo_fijo_id
         WHERE f.ambito_id = 'administrativo'
           AND a.estado = 'contabilizado'
           AND a.fecha_operacion <= ?
           AND f.fecha_adquisicion <= ?
           AND NOT EXISTS (
             SELECT 1 FROM baja_activo_fijo b
             WHERE b.activo_fijo_id = f.id AND b.estado = 'registrada' AND b.fecha_operacion <= ?
           )
         GROUP BY f.cuenta_depreciacion_id`
      )
      .safeIntegers(true)
      .all(corte, corte, corte) as Array<{ cuentaId: bigint; total: bigint }>)
      .map(f => [Number(f.cuentaId), f.total])
  );
  const mayor = new Map(
    (db
      .prepare(
        `SELECT l.cuenta_id AS cuentaId, COALESCE(SUM(l.debe_minor - l.haber_minor), 0) AS saldo
         FROM asiento_linea l
         JOIN asiento a ON a.id = l.asiento_id
         WHERE a.ambito_id = 'administrativo'
           AND a.estado IN ('contabilizado', 'anulado')
           AND a.fecha_operacion <= ?
         GROUP BY l.cuenta_id`
      )
      .safeIntegers(true)
      .all(corte) as Array<{ cuentaId: bigint; saldo: bigint }>)
      .map(f => [Number(f.cuentaId), f.saldo])
  );

  let totalDiferencia = 0n;
  const filas: FilaConciliacionActivosFijos[] = cuentas.map(cuenta => {
    const info = nombres.get(cuenta.cuentaId);
    const reporte = cuenta.tipo === 'activo'
      ? (costoPorCuenta.get(cuenta.cuentaId) ?? 0n)
      : (acumuladaPorCuenta.get(cuenta.cuentaId) ?? 0n);
    const saldoCrudo = mayor.get(cuenta.cuentaId) ?? 0n;
    // La acumulada es reguladora: su saldo natural es acreedor, por eso se invierte el signo.
    const saldoMayor = cuenta.tipo === 'activo' ? saldoCrudo : -saldoCrudo;
    const diferencia = reporte - saldoMayor;
    totalDiferencia += diferencia < 0n ? -diferencia : diferencia;
    return {
      cuentaId: cuenta.cuentaId,
      codigo: info?.codigo ?? String(cuenta.cuentaId),
      nombre: info?.nombre ?? '',
      tipo: cuenta.tipo,
      saldoMayorMinor: minorATexto(saldoMayor),
      saldoReporteMinor: minorATexto(reporte),
      diferenciaMinor: minorATexto(diferencia)
    };
  });
  filas.sort((a, b) => a.codigo.localeCompare(b.codigo) || a.tipo.localeCompare(b.tipo));
  return {
    corte,
    filas,
    cuadra: totalDiferencia === 0n,
    totalDiferenciaMinor: minorATexto(totalDiferencia)
  };
}

// CSV del cuadro general con el mismo saneamiento del paquete del contador (`escaparCsv`).
export function csvCuadroGeneralActivosFijos(
  db: Database.Database,
  corte: string
): { csv: string; version: string; filas: number } {
  const cuadro = cuadroGeneralActivosFijos(db, corte);
  const lineas = ['categoria,codigo,descripcion,estado,costo,acumulada,valor_libros,gasto_periodo'];
  for (const f of cuadro.filas) {
    lineas.push(
      [
        escaparCsv(f.categoria),
        escaparCsv(f.codigo),
        escaparCsv(f.descripcion),
        escaparCsv(f.estado),
        f.costoMinor,
        f.acumuladaMinor,
        f.valorLibrosMinor,
        f.gastoPeriodoMinor
      ].join(',')
    );
  }
  lineas.push(
    `TOTAL,,,,${cuadro.totales.costoMinor},${cuadro.totales.acumuladaMinor},${cuadro.totales.valorLibrosMinor},${cuadro.totales.gastoPeriodoMinor}`
  );
  return {
    csv: lineas.join('\n'),
    version: 'cuadro-activos-fijos-v1',
    filas: cuadro.filas.length
  };
}
