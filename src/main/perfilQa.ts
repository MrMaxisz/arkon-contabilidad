import path from 'path';

export const NOMBRE_MARCADOR_QA = 'QA-MARCADOR-ARKON.txt';
export const TEXTO_MARCADOR_QA = 'Perfil QA de ARKON Contabilidad';

export interface AccesoArchivosPerfil {
  resolverRealpath(ruta: string): string;
  leerArchivo(ruta: string): string | null;
}

export interface EntradaPerfil {
  canal: string | undefined;
  rutaEnv: string | undefined;
  rutaOperativa: string;
  archivos: AccesoArchivosPerfil;
}

export type DecisionPerfil =
  | { canal: 'produccion'; rutaDatos: string }
  | { canal: 'qa'; valido: true; rutaDatos: string; rutaChromium: string }
  | { canal: 'qa'; valido: false; rutaDatos: null; motivo: string };

function normalizar(ruta: string): string {
  return path.normalize(ruta).replace(/\\/g, '/').toLowerCase();
}

function esSubruta(candidata: string, base: string): boolean {
  return candidata.startsWith(base.endsWith('/') ? base : base + '/');
}

function marcadorValido(ruta: string, archivos: AccesoArchivosPerfil): boolean {
  const rutas = [ruta, path.join(ruta, '..')];
  for (const r of rutas) {
    const contenido = archivos.leerArchivo(path.join(r, NOMBRE_MARCADOR_QA));
    if (contenido !== null && contenido.trim().startsWith(TEXTO_MARCADOR_QA)) {
      return true;
    }
  }
  return false;
}

// Función PURA: decide la ruta de datos según el canal empaquetado. Sin efectos secundarios:
// todo acceso al sistema de archivos se inyecta (realpath para detectar junctions, lectura del marcador).
// Canal ausente: comportamiento histórico (override absoluto de ARKON_RUTA_DATOS o ruta operativa).
export function decidirPerfil(entrada: EntradaPerfil): DecisionPerfil {
  if (entrada.canal !== 'qa') {
    if (entrada.rutaEnv && path.isAbsolute(entrada.rutaEnv)) {
      return { canal: 'produccion', rutaDatos: entrada.rutaEnv };
    }
    return { canal: 'produccion', rutaDatos: entrada.rutaOperativa };
  }

  const rechazo = (motivo: string): DecisionPerfil => ({ canal: 'qa', valido: false, rutaDatos: null, motivo });
  if (!entrada.rutaEnv) {
    return rechazo('Falta ARKON_RUTA_DATOS: la versión QA solo abre con su lanzador.');
  }
  if (!path.isAbsolute(entrada.rutaEnv)) {
    return rechazo(`ARKON_RUTA_DATOS debe ser una ruta absoluta: ${entrada.rutaEnv}`);
  }
  const real = entrada.archivos.resolverRealpath(entrada.rutaEnv);
  const realOperativa = entrada.archivos.resolverRealpath(entrada.rutaOperativa);
  const nReal = normalizar(real);
  const nRealOperativa = normalizar(realOperativa);
  const nEnv = normalizar(entrada.rutaEnv);
  const nOperativa = normalizar(entrada.rutaOperativa);
  for (const n of [nEnv, nReal]) {
    if (n.includes('onedrive')) {
      return rechazo(`El perfil QA no puede estar bajo OneDrive: ${entrada.rutaEnv}`);
    }
  }
  for (const n of [nEnv, nReal]) {
    if (n === nOperativa || n === nRealOperativa || esSubruta(n, nOperativa) || esSubruta(n, nRealOperativa)) {
      return rechazo(`El perfil QA no puede ser la base operativa ni una subruta suya: ${entrada.rutaEnv}`);
    }
  }
  if (!marcadorValido(real, entrada.archivos)) {
    return rechazo(`No se encontró ${NOMBRE_MARCADOR_QA} con el texto "${TEXTO_MARCADOR_QA}" en el perfil QA o su padre directo.`);
  }
  return { canal: 'qa', valido: true, rutaDatos: entrada.rutaEnv, rutaChromium: path.join(entrada.rutaEnv, 'chromium') };
}
