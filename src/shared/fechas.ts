export class ErrorFecha extends Error {}

const DIAS_POR_MES = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function esBisiesto(anio: number): boolean {
  return (anio % 4 === 0 && anio % 100 !== 0) || anio % 400 === 0;
}

export function validarFechaCalendario(fecha: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    throw new ErrorFecha(`Formato de fecha inválido: ${fecha}`);
  }
  const anio = Number(fecha.slice(0, 4));
  const mes = Number(fecha.slice(5, 7));
  const dia = Number(fecha.slice(8, 10));
  if (anio < 1900 || anio > 2999) {
    throw new ErrorFecha(`Año fuera de rango: ${fecha}`);
  }
  if (mes < 1 || mes > 12) {
    throw new ErrorFecha(`Mes inexistente: ${fecha}`);
  }
  const diasMes = mes === 2 && esBisiesto(anio) ? 29 : DIAS_POR_MES[mes - 1] ?? 31;
  if (dia < 1 || dia > diasMes) {
    throw new ErrorFecha(`Día inexistente en el calendario: ${fecha}`);
  }
}

export function fechaDentroDePeriodo(fecha: string, inicio: string, fin: string): boolean {
  return fecha >= inicio && fecha <= fin;
}

export const ZONA_EL_SALVADOR_OFFSET_MS = -6 * 3600 * 1000;

export function fechaLocalElSalvador(ahora: Date = new Date()): string {
  const sv = new Date(ahora.getTime() + ZONA_EL_SALVADOR_OFFSET_MS);
  return sv.toISOString().slice(0, 10);
}

export function formatearFechaHoraElSalvador(fecha: string | Date): string {
  const base = typeof fecha === 'string' ? new Date(fecha) : fecha;
  if (Number.isNaN(base.getTime())) return String(fecha);
  const sv = new Date(base.getTime() + ZONA_EL_SALVADOR_OFFSET_MS);
  const dia = String(sv.getUTCDate()).padStart(2, '0');
  const mes = String(sv.getUTCMonth() + 1).padStart(2, '0');
  const anio = sv.getUTCFullYear();
  const hora = String(sv.getUTCHours()).padStart(2, '0');
  const minuto = String(sv.getUTCMinutes()).padStart(2, '0');
  return `${dia}/${mes}/${anio} ${hora}:${minuto}`;
}
