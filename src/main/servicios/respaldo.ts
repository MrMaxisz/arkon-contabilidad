import { plataformaEscritorioPorDefecto, ErrorIntegridadPlataforma, type Plataforma, type BaseDatos } from '../../plataforma/plataforma';
import { registroEvento } from './bitacora';
import type { InfoRespaldo as InfoRespaldoContrato } from '../../shared/contratos';
import { versionEsquemaActual } from '../db/aplicarMigraciones';

export class ErrorRespaldo extends Error {}


export function verificarIntegridad(rutaDb: string, plataforma: Plataforma = plataformaEscritorioPorDefecto()): void {
  try {
    plataforma.verificarIntegridad(rutaDb);
  } catch (error) {
    if (error instanceof ErrorIntegridadPlataforma) throw new ErrorRespaldo(error.message);
    throw error;
  }
}

// Limpieza de rutas EXACTAS derivadas del temporal/destino de una operación de respaldo:
// nunca borrados por patrón amplio. Incluye los restos -wal/-shm del temporal.
export function limpiarRutasRespaldo(rutas: string[], plataforma: Plataforma = plataformaEscritorioPorDefecto()): void {
  const fs = plataforma.archivos;
  for (const ruta of rutas) {
    fs.rmSync(ruta, { force: true, recursive: true });
  }
}

let operacionRespaldoEnCurso = false;

export function operacionRespaldoDisponible(): boolean {
  return !operacionRespaldoEnCurso;
}

export function adquirirOperacionRespaldo(): boolean {
  if (operacionRespaldoEnCurso) {
    return false;
  }
  operacionRespaldoEnCurso = true;
  return true;
}

export function liberarOperacionRespaldo(): void {
  operacionRespaldoEnCurso = false;
}

export async function crearRespaldo(
  db: BaseDatos,
  dirRespaldos: string,
  versionApp: string,
  dirAdjuntos?: string,
  plataforma: Plataforma = plataformaEscritorioPorDefecto()
): Promise<InfoRespaldo> {
  const { archivos: fs, rutas: path, copiarAdjuntosRespaldo } = plataforma;
  if (!adquirirOperacionRespaldo()) {
    throw new ErrorRespaldo('Otra operación de respaldo/restauración está en curso');
  }
  try {
    fs.mkdirSync(dirRespaldos, { recursive: true });
    const marca = new Date().toISOString().replace(/[:.]/g, '-');
    const nombre = `respaldo-${marca}.db`;
    const destino = path.join(dirRespaldos, nombre);
    const temporal = `${destino}.tmp`;
    let hash: string;
    let version: number;
    let adjuntos: Array<{ rutaRelativa: string; hashSha256: string }> = [];
    try {
      await plataforma.copiarBase(db, temporal);
      verificarIntegridad(temporal, plataforma);
      hash = plataforma.hashArchivo(temporal);
      const dbTemporal = plataforma.abrirCopia(temporal);
      try {
        dbTemporal.pragma('query_only = ON');
        version = (dbTemporal.prepare('SELECT MAX(version) AS v FROM _migracion').get() as { v: number | null }).v ?? 0;
        adjuntos = dirAdjuntos ? copiarAdjuntosRespaldo(dbTemporal, dirAdjuntos, `${destino}-adjuntos`) : [];
      } finally {
        dbTemporal.close();
      }
      fs.renameSync(temporal, destino);
      fs.writeFileSync(
        `${destino}.manifest.json`,
        JSON.stringify(
          {
            nombre,
            hashSha256: hash,
            versionApp,
            versionEsquema: version,
            creadoEn: new Date().toISOString(),
            adjuntos
          },
          null,
          2
        ),
        'utf8'
      );
    } catch (err) {
      // Fallo ANTES de que el respaldo exista en disco: limpieza de rutas EXACTAS (auditorías 65/66).
      limpiarRutasRespaldo([
        temporal,
        `${temporal}-wal`,
        `${temporal}-shm`,
        `${destino}-adjuntos`,
        destino,
        `${destino}.manifest.json`
      ], plataforma);
      throw err;
    }
    // Registro posterior a la creación (auditoría 66): INSERT y bitácora en UNA transacción;
    // si falla, la fila no queda huérfana y archivo+manifiesto se retiran para mantener coherencia.
    try {
      const id = db.transaction(() => {
        const info = db
          .prepare(
            'INSERT INTO respaldo (nombre, hash_sha256, version_app, version_esquema, estado) VALUES (?, ?, ?, ?, ?)'
          )
          .run(nombre, hash, versionApp, version, 'disponible');
        registroEvento(db, 'sistema', 'respaldo_creado', 'respaldo', String(info.lastInsertRowid), { nombre, hash });
        return Number(info.lastInsertRowid);
      })();
      return {
        id,
        creadoEn: new Date().toISOString(),
        nombre,
        hashSha256: hash,
        versionApp,
        versionEsquema: version,
        estado: 'disponible'
      };
    } catch (err) {
      limpiarRutasRespaldo([destino, `${destino}.manifest.json`, `${destino}-adjuntos`], plataforma);
      throw err;
    }
  } finally {
    liberarOperacionRespaldo();
  }
}

interface FilaRespaldo {
  id: number;
  creado_en: string;
  nombre: string;
  hash_sha256: string;
  version_app: string;
  version_esquema: number;
  estado: string;
}

export type InfoRespaldo = InfoRespaldoContrato;

export function listarRespaldos(db: BaseDatos): InfoRespaldo[] {
  const filas = db
    .prepare('SELECT id, creado_en, nombre, hash_sha256, version_app, version_esquema, estado FROM respaldo ORDER BY id DESC')
    .all() as FilaRespaldo[];
  return filas.map(f => ({
    id: f.id,
    creadoEn: f.creado_en,
    nombre: f.nombre,
    hashSha256: f.hash_sha256,
    versionApp: f.version_app,
    versionEsquema: f.version_esquema,
    estado: f.estado
  }));
}

export function registrarRestauracion(db: BaseDatos, detalle: { respaldo: string; copiaPrevia: string }): void {
  registroEvento(db, 'sistema', 'restauracion_completada', 'respaldo', detalle.respaldo, detalle);
}

export function descubrirRespaldos(dirRespaldos: string, plataforma: Plataforma = plataformaEscritorioPorDefecto()): InfoRespaldo[] {
  const { archivos: fs, rutas: path } = plataforma;
  if (!fs.existsSync(dirRespaldos)) {
    return [];
  }
  const encontrados: InfoRespaldo[] = [];
  for (const archivo of fs.readdirSync(dirRespaldos)) {
    if (!archivo.startsWith('respaldo-') || !archivo.endsWith('.db')) {
      continue;
    }
    const rutaManifiesto = path.join(dirRespaldos, `${archivo}.manifest.json`);
    if (!fs.existsSync(rutaManifiesto)) {
      continue;
    }
    try {
      const m = JSON.parse(fs.readFileSync(rutaManifiesto, 'utf8')) as {
        nombre?: string;
        hashSha256?: string;
        versionApp?: string;
        versionEsquema?: number;
        creadoEn?: string;
      };
      if (m.nombre !== archivo || !m.hashSha256) {
        continue;
      }
      encontrados.push({
        id: 0,
        creadoEn: m.creadoEn ?? '',
        nombre: m.nombre,
        hashSha256: m.hashSha256,
        versionApp: m.versionApp ?? '',
        versionEsquema: m.versionEsquema ?? 0,
        estado: fs.existsSync(path.join(dirRespaldos, archivo)) ? 'disponible' : 'invalido'
      });
    } catch {
      continue;
    }
  }
  return encontrados.sort((a, b) => b.creadoEn.localeCompare(a.creadoEn));
}

export function restaurarRespaldo(
  db: BaseDatos,
  rutaRespaldo: string,
  rutaBaseActiva: string,
  plataforma: Plataforma = plataformaEscritorioPorDefecto()
): { ok: boolean; detalle: string; respaldo: string; copiaPrevia: string } {
  const { archivos: fs, rutas: path } = plataforma;
  if (!fs.existsSync(rutaRespaldo)) {
    throw new ErrorRespaldo(`No existe el respaldo: ${rutaRespaldo}`);
  }
  const nombreRespaldo = path.basename(rutaRespaldo);
  const registro = db
    .prepare('SELECT * FROM respaldo WHERE nombre = ?')
    .get(nombreRespaldo) as (InfoRespaldo & { hash_sha256: string }) | undefined;
  const hash = plataforma.hashArchivo(rutaRespaldo);
  if (registro && registro.hash_sha256 !== hash) {
    throw new ErrorRespaldo('El hash del respaldo no coincide con el registrado; rechazado');
  }
  const rutaManifiesto = `${rutaRespaldo}.manifest.json`;
  let adjuntosManifiesto: Array<{ rutaRelativa: string; hashSha256: string }> = [];
  if (fs.existsSync(rutaManifiesto)) {
    const manifiesto = JSON.parse(fs.readFileSync(rutaManifiesto, 'utf8')) as {
      nombre?: string;
      hashSha256?: string;
      adjuntos?: Array<{ rutaRelativa: string; hashSha256: string }>;
    };
    if (manifiesto.nombre !== nombreRespaldo || manifiesto.hashSha256 !== hash) {
      throw new ErrorRespaldo('El manifiesto del respaldo no coincide con el archivo; restauración rechazada');
    }
    adjuntosManifiesto = manifiesto.adjuntos ?? [];
  } else if (!registro) {
    throw new ErrorRespaldo('Respaldo sin manifiesto ni registro previo; restauración rechazada');
  }
  verificarIntegridad(rutaRespaldo, plataforma);
  const versionRespaldo = leerVersionEsquema(rutaRespaldo, plataforma);
  const versionActual = versionEsquemaActual();
  if (versionRespaldo > versionActual) {
    throw new ErrorRespaldo(
      `El respaldo usa esquema ${versionRespaldo}, superior al soportado (${versionActual}); restauración bloqueada. Actualiza la app para abrirlo.`
    );
  }
  const areaTemporal = `${rutaBaseActiva}.restauracion-tmp`;
  let previa = '';
  try {
    fs.copyFileSync(rutaRespaldo, areaTemporal);
    verificarIntegridad(areaTemporal, plataforma);
    registroEvento(db, 'sistema', 'restauracion', 'respaldo', path.basename(rutaRespaldo), {
      versionRespaldo,
      estadoPrevioPreservado: true
    });
    db.close();
    previa = `${rutaBaseActiva}.antes-restauracion`;
    fs.copyFileSync(rutaBaseActiva, previa);
    fs.renameSync(areaTemporal, rutaBaseActiva);
  } catch (err) {
    // Limpieza de rutas EXACTAS del área temporal de esta restauración (auditoría 65).
    limpiarRutasRespaldo([areaTemporal, `${areaTemporal}-wal`, `${areaTemporal}-shm`], plataforma);
    throw err;
  }
  return {
    ok: true,
    detalle: `Restaurado ${nombreRespaldo}; copia previa en ${path.basename(previa)}`,
    respaldo: nombreRespaldo,
    copiaPrevia: path.basename(previa)
  };
}

export function leerVersionEsquema(rutaDb: string, plataforma: Plataforma = plataformaEscritorioPorDefecto()): number {
  const copia = plataforma.abrirCopia(rutaDb);
  try {
    copia.pragma('query_only = ON');
    const fila = copia
      .prepare('SELECT MAX(version) AS v FROM _migracion')
      .get() as { v: number | null } | undefined;
    return fila?.v ?? 0;
  } finally {
    copia.close();
  }
}
