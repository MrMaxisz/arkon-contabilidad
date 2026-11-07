import { fechaLocalElSalvador } from './fechas';

export function nombreTraspaso(fecha = new Date()): string {
  return `ARKON-${fechaLocalElSalvador(fecha)}.arkon`;
}
