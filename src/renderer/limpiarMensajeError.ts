export function limpiarMensajeError(err: unknown): string {
  const texto = String(err instanceof Error ? err.message : err);
  return texto
    .replace(/^Error invoking remote method '[^']*':\s*/, '')
    .replace(/^(?:[A-Z]\w*Error|Error\w*):\s*/, '')
    .trim();
}
