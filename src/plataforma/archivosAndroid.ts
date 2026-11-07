export const TAMANO_TROZO = 1024 * 1024;
export interface ArkonArchivos {
  guardar(datos: { nombre: string; mime: string }): Promise<{ estado: string }>;
  abrir(): Promise<{ estado: string }>;
  escribirTrozo(datos: { base64: string }): Promise<unknown>;
  leerTrozo(): Promise<{ base64: string; fin: boolean }>;
  cerrar(datos?: { descartar?: boolean }): Promise<unknown>;
  imprimir(datos: { nombre: string; html: string }): Promise<unknown>;
}
export function pluginArchivos(): ArkonArchivos {
  const plugin = (window as unknown as { Capacitor?: { Plugins?: { ArkonArchivos?: ArkonArchivos } } }).Capacitor?.Plugins?.ArkonArchivos;
  if (!plugin) throw new Error('El plugin ArkonArchivos no está disponible. Instale el APK actualizado.');
  return plugin;
}
export function aBase64(bytes: Uint8Array): string {
  let texto = '';
  for (let i = 0; i < bytes.length; i += 8192) texto += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(texto);
}
export function deBase64(texto: string): Uint8Array {
  if (texto.length > Math.ceil(TAMANO_TROZO / 3) * 4) throw new Error('Trozo de lectura mayor que 1 MB');
  const bytes = Uint8Array.from(atob(texto), c => c.charCodeAt(0));
  if (bytes.length > TAMANO_TROZO) throw new Error('Trozo de lectura mayor que 1 MB');
  return bytes;
}
export async function guardarArchivo(plugin: ArkonArchivos, nombre: string, mime: string, bytes: Uint8Array) {
  if ((await plugin.guardar({ nombre, mime })).estado === 'cancelado') return { estado: 'cancelado', guardado: false, detalle: 'Exportación cancelada.' };
  let cerrado = false; let fallo = false;
  try {
    for (let i = 0; i < bytes.length; i += TAMANO_TROZO) await plugin.escribirTrozo({ base64: aBase64(bytes.subarray(i, i + TAMANO_TROZO)) });
    await plugin.cerrar(); cerrado = true;
    return { estado: 'guardado', guardado: true, nombre, ruta: nombre, detalle: `Exportado: ${nombre}` };
  } catch (error) { fallo = true; throw error; }
  finally { if (!cerrado) await plugin.cerrar({ descartar: fallo }).catch(() => undefined); }
}
export async function abrirArchivo(plugin: ArkonArchivos): Promise<Uint8Array | null> {
  if ((await plugin.abrir()).estado === 'cancelado') return null;
  try {
    const trozos: Uint8Array[] = []; let total = 0;
    for (;;) {
      const r = await plugin.leerTrozo();
      const bytes = deBase64(r.base64);
      if (!r.fin && !bytes.length) throw new Error('Lectura sin progreso');
      trozos.push(bytes); total += bytes.length;
      if (r.fin) break;
    }
    const bytes = new Uint8Array(total); let offset = 0;
    for (const trozo of trozos) { bytes.set(trozo, offset); offset += trozo.length; }
    return bytes;
  } finally { await plugin.cerrar(); }
}
