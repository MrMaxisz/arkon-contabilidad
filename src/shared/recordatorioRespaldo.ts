export function debeMostrarRecordatorioRespaldo(
  totalPartidas: number,
  ultimaExportacionFecha: string | null | undefined,
  ahora: Date = new Date()
): boolean {
  if (totalPartidas < 1) return false;
  if (!ultimaExportacionFecha) return true;
  const ultima = new Date(ultimaExportacionFecha);
  if (Number.isNaN(ultima.getTime())) return true;
  return ahora.getTime() - ultima.getTime() > 7 * 24 * 60 * 60 * 1000;
}
