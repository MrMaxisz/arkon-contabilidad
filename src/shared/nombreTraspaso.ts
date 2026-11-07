export function nombreTraspaso(fecha = new Date()): string {
  return `ARKON-${fecha.toISOString().slice(0, 10)}.arkon`;
}
