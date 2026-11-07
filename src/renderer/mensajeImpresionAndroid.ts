export function mensajeImpresionAndroid(resultado: unknown): string | null {
  return (resultado as { estado?: string })?.estado === 'impresion'
    ? 'Documento enviado al sistema de impresión. Si eligió «Guardar como PDF», compruebe el archivo en el destino.'
    : null;
}
