export function limpiarMensajeError(err: unknown): string {
  const texto = String(err instanceof Error ? err.message : err);
  return texto
    .replace(/^Error invoking remote method 'arkon':\s*/i, '')
    .replace(/^Error:\s*/i, '')
    .trim();
}
