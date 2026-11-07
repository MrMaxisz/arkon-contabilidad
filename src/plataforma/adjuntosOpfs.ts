import type { Plataforma, BaseDatos } from './plataforma';

export interface EstadoTraspasoAndroid { activo: string; previo?: string; pendiente?: { anterior: string; copia: string } }

// Metadatos y adjuntos fuera del pool SQLite. Cerrar el writable publica el estado
// atómicamente: un pendiente siempre se recupera antes de abrir la base activa.
export async function abrirAdjuntosOpfs() {
  const raiz = await (await navigator.storage.getDirectory()).getDirectoryHandle('arkon-traspaso', { create: true });
  async function archivo(dir: FileSystemDirectoryHandle, ruta: string, crear: boolean) {
    const partes = ruta.split('/');
    for (const parte of partes.slice(0, -1)) dir = await dir.getDirectoryHandle(parte, { create: crear });
    return dir.getFileHandle(partes.at(-1)!, { create: crear });
  }
  async function escribir(handle: FileSystemFileHandle, bytes: Uint8Array) {
    const destino = await handle.createWritable();
    try { await destino.write(bytes.slice().buffer); await destino.close(); }
    catch (error) { await destino.abort(); throw error; }
  }
  return {
    async leerEstado(): Promise<EstadoTraspasoAndroid> {
      try { return JSON.parse(await (await (await raiz.getFileHandle('estado.json')).getFile()).text()); }
      catch (error) { if ((error as DOMException).name === 'NotFoundError') return { activo: 'inicial' }; throw error; }
    },
    async guardarEstado(estado: EstadoTraspasoAndroid) {
      await escribir(await raiz.getFileHandle('estado.json', { create: true }), new TextEncoder().encode(JSON.stringify(estado)));
    },
    async descartar(generacion: string) {
      try { await raiz.removeEntry(generacion, { recursive: true }); }
      catch (error) { if ((error as DOMException).name !== 'NotFoundError') throw error; }
    },
    async cargar(generacion: string, db: BaseDatos, p: Plataforma, destino: string) {
      const inventario = p.inventarioAdjuntosRegistrado(db);
      p.validarRutasRelativas(inventario.map(a => a.rutaRelativa));
      if (!inventario.length) return;
      const dir = await raiz.getDirectoryHandle(generacion);
      for (const a of inventario) {
        const bytes = new Uint8Array(await (await (await archivo(dir, a.rutaRelativa, false)).getFile()).arrayBuffer());
        p.archivos.writeFileSync(p.rutas.join(destino, a.rutaRelativa), bytes);
      }
    },
    async guardar(generacion: string, db: BaseDatos, p: Plataforma, origen: string) {
      const dir = await raiz.getDirectoryHandle(generacion, { create: true });
      const inventario = p.inventarioAdjuntosRegistrado(db);
      p.validarRutasRelativas(inventario.map(a => a.rutaRelativa));
      for (const a of inventario) await escribir(await archivo(dir, a.rutaRelativa, true), p.archivos.readFileSync(p.rutas.join(origen, a.rutaRelativa)));
    }
  };
}
