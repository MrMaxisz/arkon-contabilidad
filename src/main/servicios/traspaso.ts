import { crearPaqueteTraspaso, leerPaqueteTraspaso, type EntradaTraspaso } from '../../shared/paqueteTraspaso';
import { plataformaEscritorioPorDefecto, type Plataforma } from '../../plataforma/plataforma';
import { crearRespaldo } from './respaldo';
import { manejarRestauracion, type ContextoApp } from './restauracion';
import { nombreTraspaso } from '../../shared/nombreTraspaso';

let secuenciaImportacion = 0;

export async function exportarTraspaso(ctx: ContextoApp): Promise<{ bytes: Uint8Array; nombre: string }> {
  const p = ctx.plataforma ?? plataformaEscritorioPorDefecto();
  const info = await crearRespaldo(ctx.db, ctx.rutas.respaldos, ctx.versionApp, ctx.rutas.adjuntos, p);
  const ruta = p.rutas.join(ctx.rutas.respaldos, info.nombre);
  const entradas: EntradaTraspaso[] = [info.nombre, `${info.nombre}.manifest.json`].map(nombre => ({
    ruta: nombre, datos: p.archivos.readFileSync(p.rutas.join(ctx.rutas.respaldos, nombre))
  }));
  for (const adjunto of p.inventarioAdjuntosRegistrado(ctx.db)) entradas.push({
    ruta: `${info.nombre}-adjuntos/${adjunto.rutaRelativa}`,
    datos: p.archivos.readFileSync(p.rutas.join(`${ruta}-adjuntos`, adjunto.rutaRelativa))
  });
  return { bytes: crearPaqueteTraspaso(entradas), nombre: nombreTraspaso() };
}

export function extraerTraspaso(bytes: Uint8Array, directorio: string, p: Plataforma): string {
  const entradas = leerPaqueteTraspaso(bytes);
  const bases = entradas.filter(e => /^respaldo-[^/]+\.db$/.test(e.ruta));
  if (bases.length !== 1) throw new Error('El paquete debe contener una única base de respaldo');
  const nombre = bases[0]!.ruta;
  if (!entradas.some(e => e.ruta === `${nombre}.manifest.json`) || entradas.some(e => e.ruta !== nombre && e.ruta !== `${nombre}.manifest.json` && !e.ruta.startsWith(`${nombre}-adjuntos/`))) throw new Error('Contenido de paquete inválido');
  // Solo se extrae después de verificar TODAS las entradas y sus hashes.
  p.archivos.mkdirSync(directorio, { recursive: true });
  for (const e of entradas) {
    const ruta = p.rutas.join(directorio, e.ruta);
    const padre = e.ruta.slice(0, e.ruta.lastIndexOf('/'));
    if (e.ruta.includes('/')) p.archivos.mkdirSync(p.rutas.join(directorio, padre), { recursive: true });
    p.archivos.writeFileSync(ruta, e.datos);
  }
  return nombre;
}

export async function importarTraspaso(ctx: ContextoApp, bytes: Uint8Array) {
  const p = ctx.plataforma ?? plataformaEscritorioPorDefecto();
  // Área exclusiva: un paquete externo nunca sobrescribe respaldos del propietario.
  const area = p.rutas.join(ctx.rutas.respaldos, `traspaso-${Date.now()}-${++secuenciaImportacion}`);
  try {
    const nombre = extraerTraspaso(bytes, area, p);
    const temporal = { ...ctx, rutas: { ...ctx.rutas, respaldos: area }, reabrirBase() { ctx.reabrirBase(); this.db = ctx.db; } };
    return await manejarRestauracion(temporal, nombre);
  } finally { p.archivos.rmSync(area, { recursive: true, force: true }); }
}
