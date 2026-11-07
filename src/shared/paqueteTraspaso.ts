import { sha256 } from './sha256';

export interface EntradaTraspaso { ruta: string; datos: Uint8Array }
interface Indice { ruta: string; tamano: number; sha256: string }
const firma = new Uint8Array([65,82,75,79,78,13,10,26]);
const encoder = new TextEncoder();
function validarRuta(ruta: string, vistas: Set<string>): void {
  // Una única representación portable, también segura al extraer sobre Windows.
  if (typeof ruta !== 'string' || !ruta || /[\\:\x00-\x1f]/.test(ruta) || ruta.includes('..') || ruta.split('/').some(p => !p || p === '.' || /[. ]$/.test(p))) throw new Error('Ruta inválida en paquete');
  const clave = ruta.toLowerCase();
  if (vistas.has(clave)) throw new Error('Entradas duplicadas en paquete');
  vistas.add(clave);
}

// Cabecera: firma(8), versión uint32 BE(4), tamaño índice UTF-8 uint32 BE(4).
// Índice JSON seguido por el contenido concatenado en el orden declarado.
export function crearPaqueteTraspaso(entradas: EntradaTraspaso[]): Uint8Array {
  const vistas = new Set<string>();
  const indice = encoder.encode(JSON.stringify(entradas.map(e => {
    validarRuta(e.ruta, vistas);
    return { ruta: e.ruta, tamano: e.datos.length, sha256: sha256(e.datos) };
  })));
  const bytes = new Uint8Array(16 + indice.length + entradas.reduce((n,e) => n + e.datos.length, 0));
  bytes.set(firma);
  const vista = new DataView(bytes.buffer);
  vista.setUint32(8, 1); vista.setUint32(12, indice.length);
  bytes.set(indice, 16);
  let offset = 16 + indice.length;
  for (const e of entradas) { bytes.set(e.datos, offset); offset += e.datos.length; }
  return bytes;
}

export function leerPaqueteTraspaso(bytes: Uint8Array): EntradaTraspaso[] {
  if (!(bytes instanceof Uint8Array) || bytes.length < 16) throw new Error('Paquete truncado');
  if (!firma.every((v,i) => bytes[i] === v)) throw new Error('Firma de paquete ajena');
  const vista = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (vista.getUint32(8) !== 1) throw new Error('Versión de formato no soportada');
  let offset = 16 + vista.getUint32(12);
  if (offset > bytes.length) throw new Error('Índice truncado');
  const indice: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(16, offset)));
  if (!Array.isArray(indice)) throw new Error('Índice inválido');
  const vistas = new Set<string>();
  const entradas = indice.map((e: Indice) => {
    if (!e || typeof e !== 'object') throw new Error('Entrada inválida');
    validarRuta(e.ruta, vistas);
    if (!Number.isSafeInteger(e.tamano) || e.tamano < 0 || typeof e.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(e.sha256)) throw new Error('Entrada inválida');
    if (e.tamano > bytes.length - offset) throw new Error('Contenido truncado');
    const datos = bytes.slice(offset, offset + e.tamano); offset += e.tamano;
    if (sha256(datos) !== e.sha256) throw new Error('Entrada alterada (SHA-256)');
    return { ruta: e.ruta, datos };
  });
  if (offset !== bytes.length) throw new Error('Contenido sobrante en paquete');
  return entradas;
}
