import type Database from 'better-sqlite3';
import { redondearDivision, minorATexto, parseMontoMinor } from '../../shared/dinero';
import { validarFechaCalendario } from '../../shared/fechas';
import { contabilizarAsiento } from './motorAsientos';
import { registroEvento } from './bitacora';

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
  const cuotaBase = redondearDivision(depreciableMinor, BigInt(vidaUtilMeses));
  const cuotas: bigint[] = [];
  let acumulado = 0n;
  for (let mes = 1; mes <= vidaUtilMeses; mes += 1) {
    if (mes === vidaUtilMeses) {
      cuotas.push(depreciableMinor - acumulado);
    } else {
      const cuota = cuotaBase;
      cuotas.push(cuota);
      acumulado += cuota;
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

  const codigo = siguienteCodigo(db);

  // Regla 4: si viene de una compra ya contabilizada en la cuenta del activo, NO genera
  // otro asiento; en caso contrario genera asiento con cuenta de contrapartida elegida.
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
}
