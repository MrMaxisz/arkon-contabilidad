import path from 'path';

export const NOMBRE_MARCADOR_QA = 'QA-MARCADOR-ARKON.txt';
export const TEXTO_MARCADOR_QA = 'Perfil QA de ARKON Contabilidad';

export interface AccesoArchivosPerfil {
  resolverRealpath(ruta: string): string;
  leerArchivo(ruta: string): string | null;
}

export interface EntradaPerfil {
  canal: string | undefined;
  canalRoto: boolean;
  empaquetado: boolean;
  rutaEnv: string | undefined;
  rutaOperativa: string;
  archivos: AccesoArchivosPerfil;
}

export type DecisionPerfil =
  | { canal: 'produccion'; rutaDatos: string }
  | { canal: 'qa'; valido: true; rutaDatos: string; rutaChromium: string }
  | { canal: 'qa'; valido: false; rutaDatos: null; motivo: string };

export type LecturaCanal = { canal: string | undefined; roto: boolean };

// Lectura PURA del canal desde el contenido del package.json empaquetado.
// null (lectura fallida) o JSON inválido => roto: el empaquetado debe fallar en cerrado (78).
// Ninguna variable de entorno puede activar o cambiar el canal: solo este contenido.
export function leerCanalDesdePaquete(contenido: string | null): LecturaCanal {
  if (contenido === null) {
    return { canal: undefined, roto: true };
  }
  try {
    const pkg = JSON.parse(contenido) as { arkonCanal?: unknown };
    return { canal: typeof pkg.arkonCanal === 'string' ? pkg.arkonCanal : undefined, roto: false };
  } catch {
    return { canal: undefined, roto: true };
  }
}

function normalizar(ruta: string): string {
  return path.normalize(ruta).replace(/\\/g, '/').toLowerCase();
}

function esSubruta(candidata: string, base: string): boolean {
  return candidata.startsWith(base.endsWith('/') ? base : base + '/');
}

// Devuelve la carpeta que contiene el marcador válido (la propia ruta o su padre directo),
// o null si no existe. El chromium del perfil se deriva de ESA carpeta.
function carpetaMarcador(ruta: string, archivos: AccesoArchivosPerfil): string | null {
  const carpetas = [ruta, path.join(ruta, '..')];
  for (const c of carpetas) {
    const contenido = archivos.leerArchivo(path.join(c, NOMBRE_MARCADOR_QA));
    if (contenido !== null && contenido.trim().startsWith(TEXTO_MARCADOR_QA)) {
      return c;
    }
  }
  return null;
}

// Función PURA: decide la ruta de datos según el canal empaquetado. Sin efectos secundarios:
// todo acceso al sistema de archivos se inyecta (realpath para detectar junctions, lectura del marcador).
// Canal ausente: comportamiento histórico (override absoluto de ARKON_RUTA_DATOS o ruta operativa).
// Empaquetado con lectura rota del paquete: fallo en cerrado como QA inválido (78), sin tocar nada.
export function decidirPerfil(entrada: EntradaPerfil): DecisionPerfil {
  if (entrada.empaquetado && entrada.canalRoto) {
    return {
      canal: 'qa',
      valido: false,
      rutaDatos: null,
      motivo: 'No se pudo leer la configuración del paquete (package.json inválido o ilegible); por seguridad no se abrió ningún dato.'
    };
  }

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
  const carpetaQa = carpetaMarcador(real, entrada.archivos);
  if (carpetaQa === null) {
    return rechazo(`No se encontró ${NOMBRE_MARCADOR_QA} con el texto "${TEXTO_MARCADOR_QA}" en el perfil QA o su padre directo.`);
  }
  return { canal: 'qa', valido: true, rutaDatos: entrada.rutaEnv, rutaChromium: path.join(carpetaQa, 'chromium') };
}
