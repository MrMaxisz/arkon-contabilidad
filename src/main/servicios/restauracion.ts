import { plataformaEscritorioPorDefecto, type Plataforma, type BaseDatos, type RutasDatos } from '../../plataforma/plataforma';
import { aplicarMigraciones, versionEsquemaActual } from '../db/aplicarMigraciones';
import { restaurarRespaldo, registrarRestauracion, ErrorRespaldo, adquirirOperacionRespaldo, liberarOperacionRespaldo } from './respaldo';

export interface ContextoApp {
  db: BaseDatos;
  plataforma?: Plataforma;
  rutas: RutasDatos;
  versionApp: string;
  rutaDb: string;
  reabrirBase(): void;
}

export class ErrorRecuperacionPendiente extends Error {
  constructor(diagnostico: string) {
    super(diagnostico);
    this.name = 'ErrorRecuperacionPendiente';
  }
}

function baseLegible(rutaDb: string, plataforma: Plataforma): boolean {
  const fs = plataforma.archivos;
  if (!fs.existsSync(rutaDb) || fs.statSync(rutaDb).size === 0) {
    return false;
  }
  let db: BaseDatos | null = null;
  try {
    db = plataforma.abrirCopia(rutaDb, true);
    const integridad = db.pragma('integrity_check');
    const texto = Array.isArray(integridad)
      ? integridad.map(r => String(Object.values(r)[0])).join(' ')
      : String(integridad);
    if (!texto.includes('ok')) {
      return false;
    }
    const migracion = db
      .prepare("SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = '_migracion'")
      .get() as { x: number } | undefined;
    if (!migracion) {
      return false;
    }
    const version = (db.prepare('SELECT MAX(version) AS v FROM _migracion').get() as { v: number | null }).v ?? 0;
    if (version < 1 || version > versionEsquemaActual()) {
      return false;
    }
    return true;
  } catch {
    return false;
  } finally {
    if (db && db.open) {
      db.close();
    }
  }
}

function conjuntoCoherente(rutaDb: string, dirAdjuntos: string, plataforma: Plataforma): boolean {
  const { archivos: fs, rutas: path, inventarioAdjuntosRegistrado } = plataforma;
  if (!baseLegible(rutaDb, plataforma)) {
    return false;
  }
  const db = plataforma.abrirCopia(rutaDb, true);
  try {
    const inventario = inventarioAdjuntosRegistrado(db);
    for (const registro of inventario) {
      const archivo = path.join(dirAdjuntos, registro.rutaRelativa);
      if (!fs.existsSync(archivo)) {
        return false;
      }
      const hash = plataforma.hashArchivo(archivo);
      if (hash !== registro.hashSha256) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  } finally {
    if (db.open) {
      db.close();
    }
  }
}

function resolverRestauracionInterrumpida(rutas: RutasDatos, rutaDb: string, marcador: string, plataforma: Plataforma): void {
  const fs = plataforma.archivos;
  let info: { fase?: string; rutaDb?: string; adjuntos?: string; previaAdjuntos?: string; areaTemporal?: string; respaldo?: string };
  try {
    info = JSON.parse(fs.readFileSync(marcador, 'utf8'));
  } catch {
    info = {};
  }
  const areaTemporal = info.areaTemporal ?? `${rutas.adjuntos}.restauracion-tmp`;
  const previaAdjuntos = info.previaAdjuntos ?? `${rutas.adjuntos}.antes-restauracion`;
  const basePrevia = `${rutaDb}.antes-restauracion`;
  const baseTemporal = `${rutaDb}.restauracion-tmp`;

  if (fs.existsSync(baseTemporal)) {
    fs.rmSync(baseTemporal, { force: true });
  }

  if (conjuntoCoherente(rutaDb, rutas.adjuntos, plataforma)) {
    fs.rmSync(areaTemporal, { recursive: true, force: true });
    fs.rmSync(previaAdjuntos, { recursive: true, force: true });
    fs.rmSync(basePrevia, { force: true });
    fs.rmSync(marcador, { force: true });
    return;
  }

  if (fs.existsSync(areaTemporal) && conjuntoCoherente(rutaDb, areaTemporal, plataforma)) {
    fs.rmSync(previaAdjuntos, { recursive: true, force: true });
    if (fs.existsSync(rutas.adjuntos)) {
      fs.renameSync(rutas.adjuntos, previaAdjuntos);
    }
    fs.renameSync(areaTemporal, rutas.adjuntos);
    if (conjuntoCoherente(rutaDb, rutas.adjuntos, plataforma)) {
      fs.rmSync(previaAdjuntos, { recursive: true, force: true });
      fs.rmSync(basePrevia, { force: true });
      fs.rmSync(marcador, { force: true });
      return;
    }
  }

  if (fs.existsSync(basePrevia)) {
    fs.copyFileSync(basePrevia, `${rutaDb}.resolucion-tmp`);
    const dirAdjuntosPrevios = fs.existsSync(previaAdjuntos) ? previaAdjuntos : rutas.adjuntos;
    if (conjuntoCoherente(`${rutaDb}.resolucion-tmp`, dirAdjuntosPrevios, plataforma)) {
      fs.rmSync(rutaDb, { force: true });
      fs.renameSync(`${rutaDb}.resolucion-tmp`, rutaDb);
      if (fs.existsSync(previaAdjuntos)) {
        fs.rmSync(rutas.adjuntos, { recursive: true, force: true });
        fs.renameSync(previaAdjuntos, rutas.adjuntos);
      }
      if (conjuntoCoherente(rutaDb, rutas.adjuntos, plataforma)) {
        fs.rmSync(areaTemporal, { recursive: true, force: true });
        fs.rmSync(previaAdjuntos, { recursive: true, force: true });
        fs.rmSync(basePrevia, { force: true });
        fs.rmSync(marcador, { force: true });
        return;
      }
    } else {
      fs.rmSync(`${rutaDb}.resolucion-tmp`, { force: true });
    }
  }

  const diagnostico = {
    nota: 'Restauración interrumpida sin conjunto coherente verificable; copias preservadas',
    baseActiva: rutaDb,
    basePrevia,
    previaAdjuntos,
    areaTemporal,
    creadoEn: new Date().toISOString()
  };
  fs.writeFileSync(`${marcador}.sin-resolver`, JSON.stringify(diagnostico, null, 2), 'utf8');
  throw new ErrorRecuperacionPendiente(
    `Recuperación pendiente: no se pudo verificar un conjunto coherente de base y adjuntos. Copias preservadas: base anterior en ${basePrevia}, adjuntos anteriores en ${previaAdjuntos}, área temporal en ${areaTemporal}. Diagnóstico completo en ${marcador}.sin-resolver.`
  );
}

export async function crearContextoBase(rutas: RutasDatos, rutaDb: string, versionApp: string, plataforma: Plataforma = plataformaEscritorioPorDefecto()): Promise<ContextoApp> {
  const { archivos: fs, rutas: path, copiarAdjuntosRespaldo, retencionRespaldosAutomaticos } = plataforma;
  const abrirBase = (ruta: string) => plataforma.abrirBase(ruta);
  const marcador = path.join(rutas.raiz, 'restauracion-en-curso.json');
  if (fs.existsSync(marcador)) {
    resolverRestauracionInterrumpida(rutas, rutaDb, marcador, plataforma);
  }
  const sinResolver = path.join(rutas.raiz, 'restauracion-en-curso.json.sin-resolver');
  if (fs.existsSync(sinResolver)) {
    const diagnostico = JSON.parse(fs.readFileSync(sinResolver, 'utf8')) as { basePrevia?: string; previaAdjuntos?: string };
    throw new ErrorRecuperacionPendiente(
      `Recuperación pendiente sin resolver: existe un diagnóstico previo (${sinResolver}). Base anterior preservada en ${diagnostico.basePrevia ?? 'ruta desconocida'}; adjuntos anteriores en ${diagnostico.previaAdjuntos ?? 'ruta desconocida'}. Resuélvelo o elimina el archivo de diagnóstico para continuar sin garantías.`
    );
  }
  if (fs.existsSync(rutaDb)) {
    const versionPrevio = (() => {
      const previa = abrirBase(rutaDb);
      try {
        const fila = previa.prepare('SELECT MAX(version) AS v FROM _migracion').get() as { v: number | null };
        return fila?.v ?? 0;
      } catch {
        return 0;
      } finally {
        previa.close();
      }
    })();
    const { versionEsquemaActual } = await import('../db/aplicarMigraciones');
    if (versionPrevio < versionEsquemaActual()) {
      const dbPrevia = abrirBase(rutaDb);
      try {
        const marca = new Date().toISOString().replace(/[:.]/g, '-');
        const destino = path.join(rutas.respaldos, `respaldo-previo-migracion-${marca}.db`);
        const temporal = `${destino}.tmp`;
        try {
          await plataforma.copiarBase(dbPrevia, temporal);
          const { verificarIntegridad } = await import('./respaldo');
          verificarIntegridad(temporal, plataforma);
          const hash = plataforma.hashArchivo(temporal);
          const adjuntos = copiarAdjuntosRespaldo(dbPrevia, rutas.adjuntos, `${destino}-adjuntos`);
          fs.renameSync(temporal, destino);
          fs.writeFileSync(
            `${destino}.manifest.json`,
            JSON.stringify(
              {
                nombre: path.basename(destino),
                hashSha256: hash,
                versionEsquema: versionPrevio,
                versionApp,
                creadoEn: new Date().toISOString(),
                adjuntos,
                nota: 'Respaldo automático previo a migración'
              },
              null,
              2
            ),
            'utf8'
          );
        } catch (err) {
          // Fallo entre backup y rename: limpieza de rutas EXACTAS de esta operación (auditoría 65).
          const { limpiarRutasRespaldo } = await import('./respaldo');
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
      } finally {
        dbPrevia.close();
      }
      const dbRetencion = abrirBase(rutaDb);
      try {
        aplicarMigraciones(dbRetencion);
        retencionRespaldosAutomaticos(dbRetencion, rutas.respaldos);
      } finally {
        dbRetencion.close();
      }
    }
  }
  const db = abrirBase(rutaDb);
  aplicarMigraciones(db);
  const ctx: ContextoApp = {
    db,
    plataforma,
    rutas,
    versionApp,
    rutaDb,
    reabrirBase() {
      if (this.db.open) {
        this.db.close();
      }
      this.db = abrirBase(rutaDb);
      aplicarMigraciones(this.db);
    }
  };
  return ctx;
}

export async function manejarRestauracion(
  ctx: ContextoApp,
  nombre: string
): Promise<{ ok: boolean; detalle: string; respaldo: string; copiaPrevia: string }> {
  const plataforma = ctx.plataforma ?? plataformaEscritorioPorDefecto();
  const { archivos: fs, rutas: path, restaurarAdjuntosRespaldo, inventarioAdjuntosRegistrado, validarRutasRelativas } = plataforma;
  if (!adquirirOperacionRespaldo()) {
    throw new ErrorRespaldo('Otra operación de respaldo/restauración está en curso');
  }
  try {
  if (!nombre.startsWith('respaldo-') || nombre.includes(path.sep) || nombre.includes('..')) {
    throw new ErrorRespaldo('Nombre de respaldo inválido');
  }
  const ruta = path.join(ctx.rutas.respaldos, nombre);
  const rutaManifiesto = `${ruta}.manifest.json`;
  if (!fs.existsSync(rutaManifiesto)) {
    throw new ErrorRespaldo('Respaldo sin manifiesto; restauración rechazada');
  }
  const manifiesto = JSON.parse(fs.readFileSync(rutaManifiesto, 'utf8')) as {
    adjuntos?: Array<{ rutaRelativa: string; hashSha256: string }>;
  };
  const adjuntosEsperados = manifiesto.adjuntos ?? [];
  // Inspeccionar sin activar WAL ni reescribir la imagen firmada por el manifiesto.
  const dbRespaldo = plataforma.abrirCopia(ruta);
  dbRespaldo.pragma('query_only = ON');
  try {
    const inventarioBase = inventarioAdjuntosRegistrado(dbRespaldo);
    validarRutasRelativas(inventarioBase.map(r => r.rutaRelativa));
    validarRutasRelativas(adjuntosEsperados.map(a => a.rutaRelativa));
    if (inventarioBase.length !== adjuntosEsperados.length) {
      throw new ErrorRespaldo(
        `Inventario discordante: la base del respaldo registra ${inventarioBase.length} adjunto(s) y el manifiesto declara ${adjuntosEsperados.length}`
      );
    }
    const esperadosPorRuta = new Map(adjuntosEsperados.map(a => [a.rutaRelativa, a.hashSha256]));
    for (const registro of inventarioBase) {
      const esperado = esperadosPorRuta.get(registro.rutaRelativa);
      if (!esperado) {
        throw new ErrorRespaldo(
          `La base del respaldo registra el adjunto ${registro.nombreOriginal} (${registro.rutaRelativa}) que el manifiesto no declara`
        );
      }
      if (esperado !== registro.hashSha256) {
        throw new ErrorRespaldo(
          `El adjunto ${registro.nombreOriginal} (${registro.rutaRelativa}) tiene hash distinto entre la base del respaldo y el manifiesto`
        );
      }
    }
    const rutasManifiesto = new Set(adjuntosEsperados.map(a => a.rutaRelativa));
    if (rutasManifiesto.size !== adjuntosEsperados.length) {
      throw new ErrorRespaldo('El manifiesto declara rutas de adjuntos duplicadas');
    }
  } finally {
    dbRespaldo.close();
  }
  const areaAdjuntosTemporal = `${ctx.rutas.adjuntos}.restauracion-tmp`;
  fs.rmSync(areaAdjuntosTemporal, { recursive: true, force: true });
  fs.mkdirSync(areaAdjuntosTemporal, { recursive: true });
  restaurarAdjuntosRespaldo(`${ruta}-adjuntos`, areaAdjuntosTemporal, adjuntosEsperados);
  let resultado: { ok: boolean; detalle: string; respaldo: string; copiaPrevia: string };
  const previaAdjuntos = `${ctx.rutas.adjuntos}.antes-restauracion`;
  const marcador = path.join(ctx.rutas.raiz, 'restauracion-en-curso.json');
  fs.writeFileSync(
    marcador,
    JSON.stringify(
      {
        respaldo: nombre,
        fase: 'iniciada',
        rutaDb: ctx.rutaDb,
        adjuntos: ctx.rutas.adjuntos,
        previaAdjuntos,
        areaTemporal: areaAdjuntosTemporal,
        creadoEn: new Date().toISOString()
      },
      null,
      2
    ),
    'utf8'
  );
  let baseSustituida = false;
  let adjuntosPreviosPreservados = false;
  fs.writeFileSync(marcador, JSON.stringify({ respaldo: nombre, fase: 'sustituyendo-base', rutaDb: ctx.rutaDb, adjuntos: ctx.rutas.adjuntos, previaAdjuntos, areaTemporal: areaAdjuntosTemporal, creadoEn: new Date().toISOString() }, null, 2), 'utf8');
  try {
    resultado = restaurarRespaldo(ctx.db, ruta, ctx.rutaDb, plataforma);
    baseSustituida = true;
    fs.writeFileSync(marcador, JSON.stringify({ respaldo: nombre, fase: 'base-activada', rutaDb: ctx.rutaDb, adjuntos: ctx.rutas.adjuntos, previaAdjuntos, areaTemporal: areaAdjuntosTemporal, creadoEn: new Date().toISOString() }, null, 2), 'utf8');
    fs.rmSync(previaAdjuntos, { recursive: true, force: true });
    if (fs.existsSync(ctx.rutas.adjuntos)) {
      fs.renameSync(ctx.rutas.adjuntos, previaAdjuntos);
      adjuntosPreviosPreservados = true;
    }
    fs.renameSync(areaAdjuntosTemporal, ctx.rutas.adjuntos);
    ctx.reabrirBase();
    const inventarioRestaurado = ctx.db
      .prepare('SELECT COUNT(*) AS n FROM adjunto')
      .get() as { n: number };
    if (inventarioRestaurado.n !== adjuntosEsperados.length) {
      throw new ErrorRespaldo(
        `Inventario inconsistente tras restaurar: ${inventarioRestaurado.n} adjunto(s) registrados y ${adjuntosEsperados.length} en el paquete`
      );
    }
  } catch (err) {
    const fallos: string[] = [];
    if (baseSustituida) {
      try {
        const basePrevia = `${ctx.rutaDb}.antes-restauracion`;
        if (fs.existsSync(basePrevia)) {
          if (ctx.db.open) {
            ctx.db.close();
          }
          fs.copyFileSync(basePrevia, ctx.rutaDb);
        }
      } catch (errBase) {
        fallos.push(`base: ${String(errBase instanceof Error ? errBase.message : errBase)}`);
      }
    }
    if (adjuntosPreviosPreservados && fs.existsSync(previaAdjuntos)) {
      try {
        fs.rmSync(ctx.rutas.adjuntos, { recursive: true, force: true });
        fs.renameSync(previaAdjuntos, ctx.rutas.adjuntos);
      } catch (errAdj) {
        fallos.push(`adjuntos: ${String(errAdj instanceof Error ? errAdj.message : errAdj)}`);
      }
    }
    try {
      if (!ctx.db.open) {
        ctx.reabrirBase();
      }
    } catch (errRe) {
      fallos.push(`reapertura: ${String(errRe instanceof Error ? errRe.message : errRe)}`);
    }
    fs.rmSync(areaAdjuntosTemporal, { recursive: true, force: true });
    fs.rmSync(marcador, { force: true });
    if (fallos.length > 0) {
      throw new ErrorRespaldo(
        `Restauración fallida y recuperación incompleta (${fallos.join('; ')}); copias previas preservadas en ${previaAdjuntos} y ${ctx.rutaDb}.antes-restauracion`
      );
    }
    throw err;
  }
  fs.rmSync(previaAdjuntos, { recursive: true, force: true });
  fs.rmSync(marcador, { force: true });
  registrarRestauracion(ctx.db, { respaldo: resultado.respaldo, copiaPrevia: resultado.copiaPrevia });
  return resultado;
  } finally {
    liberarOperacionRespaldo();
  }
}

export function restaurarAdjuntosDesdeRespaldo(
  rutaRespaldo: string,
  dirAdjuntosDestino: string,
  esperados: Array<{ rutaRelativa: string; hashSha256: string }>,
  plataforma: Plataforma = plataformaEscritorioPorDefecto()
): void {
  plataforma.restaurarAdjuntosRespaldo(`${rutaRespaldo}-adjuntos`, dirAdjuntosDestino, esperados);
}

export async function respaldoPeriodicoSiCorresponde(ctx: ContextoApp): Promise<{ creado: boolean; nombre?: string; omitidoPor?: string }> {
  const plataforma = ctx.plataforma ?? plataformaEscritorioPorDefecto();
  const { archivos: fs, rutas: path, copiarAdjuntosRespaldo, retencionRespaldosAutomaticos } = plataforma;
  const marcador = path.join(ctx.rutas.raiz, 'restauracion-en-curso.json');
  if (fs.existsSync(marcador) || fs.existsSync(`${marcador}.sin-resolver`)) {
    return { creado: false, omitidoPor: 'restauración en curso o pendiente de resolución' };
  }
  const fila = ctx.db
    .prepare("SELECT valor FROM configuracion WHERE clave = 'respaldo_intervalo_minutos'")
    .get() as { valor: string } | undefined;
  const intervalo = Math.max(0, Number(fila?.valor ?? '0') || 0);
  if (intervalo === 0) {
    return { creado: false, omitidoPor: 'respaldo periódico desactivado (intervalo 0)' };
  }
  const ultimo = ctx.db
    .prepare("SELECT MAX(creado_en) AS ultimo FROM respaldo WHERE nombre LIKE 'respaldo-automatico-%'")
    .get() as { ultimo: string | null };
  if (ultimo.ultimo) {
    const fechaUltimo = new Date(ultimo.ultimo.replace(' ', 'T') + 'Z').getTime();
    const transcurridoMin = (Date.now() - fechaUltimo) / 60000;
    if (transcurridoMin < intervalo) {
      return { creado: false, omitidoPor: `último respaldo automático hace ${Math.floor(transcurridoMin)} min (intervalo ${intervalo})` };
    }
  }
  if (!adquirirOperacionRespaldo()) {
    return { creado: false, omitidoPor: 'otra operación de respaldo/restauración en curso' };
  }
  try {
    const marca = new Date().toISOString().replace(/[:.]/g, '-');
    const nombreArchivo = `respaldo-automatico-${marca}.db`;
    const destino = path.join(ctx.rutas.respaldos, nombreArchivo);
    const temporal = `${destino}.tmp`;
    let hash: string;
    let versionEsquemaCopia = 0;
    let adjuntos: Array<{ rutaRelativa: string; hashSha256: string }> = [];
    try {
      await plataforma.copiarBase(ctx.db, temporal);
      const { verificarIntegridad } = await import('./respaldo');
      verificarIntegridad(temporal, plataforma);
      hash = plataforma.hashArchivo(temporal);
      const dbTemporal = plataforma.abrirCopia(temporal);
      try {
        dbTemporal.pragma('query_only = ON');
        adjuntos = copiarAdjuntosRespaldo(dbTemporal, ctx.rutas.adjuntos, `${destino}-adjuntos`);
        versionEsquemaCopia = (dbTemporal.prepare('SELECT MAX(version) AS v FROM _migracion').get() as { v: number | null }).v ?? 0;
      } finally {
        dbTemporal.close();
      }
      if (!fs.existsSync(temporal)) {
        return { creado: false, omitidoPor: 'la copia temporal desapareció durante el respaldo' };
      }
      fs.renameSync(temporal, destino);
      fs.writeFileSync(
        `${destino}.manifest.json`,
        JSON.stringify(
          {
            nombre: nombreArchivo,
            hashSha256: hash,
            versionApp: ctx.versionApp,
            versionEsquema: versionEsquemaCopia,
            creadoEn: new Date().toISOString(),
            adjuntos,
            nota: 'Respaldo automático periódico'
          },
          null,
          2
        ),
        'utf8'
      );
    } catch (err) {
      // Fallo ANTES de que el respaldo exista en disco: limpieza de rutas EXACTAS (auditorías 65/66).
      const { limpiarRutasRespaldo } = await import('./respaldo');
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
    // Post-creación (auditoría 66): un fallo de registro o de RETENCIÓN no borra el respaldo nuevo;
    // el error se propaga sin tocar archivo, manifiesto ni fila ya registrada.
    ctx.db
      .prepare('INSERT INTO respaldo (nombre, hash_sha256, version_app, version_esquema, estado) VALUES (?, ?, ?, ?, ?)')
      .run(nombreArchivo, hash, ctx.versionApp, versionEsquemaCopia, 'disponible');
    retencionRespaldosAutomaticos(ctx.db, ctx.rutas.respaldos);
    return { creado: true, nombre: nombreArchivo };
  } finally {
    liberarOperacionRespaldo();
  }
}
