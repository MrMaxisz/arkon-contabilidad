import type Database from 'better-sqlite3';
import type { RutasDatos } from '../main/db/conexion';
import type * as Adjuntos from '../main/servicios/adjuntos';
import { crearPlataformaEscritorio } from './escritorio';

export type BaseDatos = Database.Database;
export type { RutasDatos };

// Contrato síncrono una vez inicializado SQLite. No carga Node ni Electron.
export interface Plataforma {
  archivos: {
    existsSync(ruta: string): boolean;
    statSync(ruta: string): { size: number; isFile(): boolean };
    readFileSync(ruta: string): Uint8Array;
    readFileSync(ruta: string, codificacion: 'utf8'): string;
    writeFileSync(ruta: string, datos: string | Uint8Array, codificacion?: 'utf8'): void;
    mkdirSync(ruta: string, opciones: { recursive: true }): unknown;
    readdirSync(ruta: string): string[];
    copyFileSync(origen: string, destino: string): void;
    renameSync(origen: string, destino: string): void;
    rmSync(ruta: string, opciones: { recursive?: boolean; force: true }): void;
  };
  rutas: { join(...partes: string[]): string; basename(ruta: string): string; extname(ruta: string): string; isAbsolute(ruta: string): boolean; sep: string };
  prepararRutasDatos(raiz: string): RutasDatos;
  abrirBase(ruta: string): BaseDatos;
  abrirCopia(ruta: string, soloLectura?: boolean): BaseDatos;
  copiarBase(db: BaseDatos, destino: string): Promise<void>;
  verificarIntegridad(ruta: string): void;
  hashArchivo(ruta: string): string;
  copiarAdjuntosRespaldo: typeof Adjuntos.copiarAdjuntosRespaldo;
  restaurarAdjuntosRespaldo: typeof Adjuntos.restaurarAdjuntosRespaldo;
  retencionRespaldosAutomaticos: typeof Adjuntos.retencionRespaldosAutomaticos;
  inventarioAdjuntosRegistrado: typeof Adjuntos.inventarioAdjuntosRegistrado;
  validarRutasRelativas: typeof Adjuntos.validarRutasRelativas;
}

// Compatibilidad de las llamadas de escritorio existentes. La implementación nativa
// solo se carga si no se inyectó una plataforma (nunca en el recorrido WASM).
export function plataformaEscritorioPorDefecto(): Plataforma {
  return escritorio ??= crearPlataformaEscritorio();
}

let escritorio: Plataforma | undefined;

export class ErrorIntegridadPlataforma extends Error {}

export function comprobarIntegridad(db: BaseDatos): void {
  const resultado = db.pragma('integrity_check') as unknown;
  const texto = Array.isArray(resultado)
    ? resultado.map(r => String(Object.values(r)[0])).join(' ')
    : String(resultado);
  if (!texto.includes('ok')) throw new ErrorIntegridadPlataforma(`Integridad fallida: ${texto}`);
}
