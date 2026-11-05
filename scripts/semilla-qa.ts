// Herramienta CLI reproducible de aceptación de DOS VERSIONES para QA de ARKON Contabilidad.
// Modo:
//   sembrar  — crea perfil sintético con datos de prueba y manifiesto esperado.
//   verificar — compara el perfil contra el manifiesto (tras instalar/actualizar).
//   respaldar — crea respaldo con manifiesto SHA-256 antes de actualizar.
// Uso (Node, ABI de Node):
//   node dist/scripts/semilla-qa.js sembrar --perfil "C:\QA\perfil"
//   node dist/scripts/semilla-qa.js verificar --perfil "C:\QA\perfil" --manifiesto "C:\QA\semilla.json"
// No toca la base operativa; requiere ruta absoluta fuera de OneDrive y distinta del perfil real.

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { abrirBase, prepararRutasDatos } from '../src/main/db/conexion';
import { aplicarMigraciones } from '../src/main/db/aplicarMigraciones';
import { sembrarCatalogoBase } from '../src/main/servicios/cuentas';
import { crearContraparte, registrarVenta } from '../src/main/servicios/operacion';
import { registrarAdjunto } from '../src/main/servicios/adjuntos';
import { crearRespaldo } from '../src/main/servicios/respaldo';
import { listarEventos } from '../src/main/servicios/bitacora';

interface ManifiestoSemilla {
  version: string;
  perfil: string;
  generadoEn: string;
  contraparteId: number;
  ventaFolio: string;
  ventaTotalMinor: string;
  adjuntoHash: string;
  eventosEsperados: number;
  respaldoHash?: string;
  respaldoNombre?: string;
}

const MARCADOR_QA = 'QA-MARCADOR-ARKON.txt';

function normalizarRuta(ruta: string): string {
  // Normalización case-insensitive para Windows: 'arkon contabilidad' === 'ARKON Contabilidad'.
  return path.normalize(ruta).replace(/\\/g, '/').toLowerCase();
}

function validarPerfil(perfil: string): void {
  if (!path.isAbsolute(perfil)) {
    throw new Error(`El perfil debe ser una ruta ABSOLUTA: ${perfil}`);
  }
  const normalizado = normalizarRuta(perfil);
  if (normalizado.includes('onedrive')) {
    throw new Error(`El perfil no puede estar bajo OneDrive: ${perfil}`);
  }
  const local = process.env.LOCALAPPDATA;
  if (local) {
    const operativo = normalizarRuta(path.join(local, 'ARKON Contabilidad'));
    if (normalizado === operativo) {
      throw new Error(`El perfil no puede ser la base operativa: ${perfil}`);
    }
    if (normalizado.startsWith(operativo + '/')) {
      throw new Error(`El perfil no puede ser subruta de la base operativa: ${perfil}`);
    }
  }
}

function exigirMarcadorQa(perfil: string, crearSiNuevo: boolean): void {
  const rutaMarcador = path.join(perfil, MARCADOR_QA);
  if (fs.existsSync(rutaMarcador)) {
    const contenido = fs.readFileSync(rutaMarcador, 'utf8');
    if (!contenido.includes('Perfil QA de ARKON Contabilidad')) {
      throw new Error(`Marcador QA inválido en ${rutaMarcador}: el perfil existe pero no es un perfil QA válido`);
    }
    return;
  }
  if (!crearSiNuevo) {
    throw new Error(`El perfil no tiene marcador QA (${rutaMarcador}); no se puede reutilizar sin marcador válido`);
  }
  // Crear marcador SOLO si el perfil está vacío (nuevo): un perfil existente con datos y sin
  // marcador se rechaza para no operar sobre datos no sembrados.
  const entradas = fs.existsSync(perfil) ? fs.readdirSync(perfil).filter(e => e !== MARCADOR_QA) : [];
  if (entradas.length > 0) {
    throw new Error(`El perfil ${perfil} ya existe con contenido y sin marcador QA; rechazado para no tocar datos desconocidos`);
  }
  fs.mkdirSync(perfil, { recursive: true });
  fs.writeFileSync(rutaMarcador, `Perfil QA de ARKON Contabilidad; semilla sintética; ${new Date().toISOString()}`, 'utf8');
}

function contexto(perfil: string) {
  const rutas = prepararRutasDatos(perfil);
  const rutaDb = path.join(rutas.datos, 'arkon.db');
  fs.mkdirSync(rutas.datos, { recursive: true });
  const db = abrirBase(rutaDb);
  aplicarMigraciones(db);
  return {
    db,
    rutas,
    versionApp: 'qa-semilla',
    rutaDb,
    reabrirBase() {
      if (db.open) {
        db.close();
      }
    }
  };
}

function sembrar(perfil: string, manifiestoRuta: string): void {
  validarPerfil(perfil);
  validarPerfil(manifiestoRuta);
  exigirMarcadorQa(perfil, true);
  const ctx = contexto(perfil);
  sembrarCatalogoBase(ctx.db);
  ctx.db
    .prepare("INSERT OR IGNORE INTO ambito (id, nombre, tipo) VALUES ('administrativo', 'QA sintético', 'administrativo')")
    .run();

  const cliente = crearContraparte(ctx.db, {
    nombre: 'Cliente QA Sintético',
    esCliente: true,
    esProveedor: false,
    responsable: 'qa'
  });
  const venta = registrarVenta(ctx.db, {
    contraparteId: cliente,
    fechaOperacion: '2026-11-10',
    concepto: 'Venta semilla QA sintética',
    tipoIngreso: 'instalaciones',
    base: '100.00',
    tasa: '0',
    claveIdempotencia: 'qa-semilla-venta-1',
    responsable: 'qa'
  });

  const origenAdjunto = path.join(perfil, 'origen-qa.txt');
  fs.writeFileSync(origenAdjunto, 'contenido sintético de QA para adjunto', 'utf8');
  const adjunto = registrarAdjunto(ctx.db, ctx.rutas.adjuntos, {
    entidad: 'venta',
    entidadId: venta.folio,
    nombreOriginal: 'origen-qa.txt',
    rutaOrigen: origenAdjunto,
    responsable: 'qa'
  });

  const eventos = listarEventos(ctx.db, 100);
  const manifiesto: ManifiestoSemilla = {
    version: 'qa-semilla-v1',
    perfil: path.normalize(perfil),
    generadoEn: new Date().toISOString(),
    contraparteId: cliente,
    ventaFolio: venta.folio,
    ventaTotalMinor: '100.00',
    adjuntoHash: adjunto.hashSha256,
    eventosEsperados: eventos.length
  };
  fs.mkdirSync(path.dirname(manifiestoRuta), { recursive: true });
  fs.writeFileSync(manifiestoRuta, JSON.stringify(manifiesto, null, 2), 'utf8');
  console.log(`SEMILLA OK: perfil=${manifiesto.perfil} manifiesto=${manifiestoRuta} venta=${venta.folio} adjuntoHash=${adjunto.hashSha256.slice(0, 12)}…`);
  ctx.db.close();
}

async function respaldar(perfil: string, manifiestoRuta: string): Promise<void> {
  validarPerfil(perfil);
  exigirMarcadorQa(perfil, false);
  const ctx = contexto(perfil);
  const respaldo = await crearRespaldo(ctx.db, ctx.rutas.respaldos, ctx.versionApp, ctx.rutas.adjuntos);
  const manifiesto = JSON.parse(fs.readFileSync(manifiestoRuta, 'utf8')) as ManifiestoSemilla;
  manifiesto.respaldoHash = respaldo.hashSha256;
  manifiesto.respaldoNombre = respaldo.nombre;
  fs.writeFileSync(manifiestoRuta, JSON.stringify(manifiesto, null, 2), 'utf8');
  console.log(`RESPALDO OK: ${respaldo.nombre} hash=${respaldo.hashSha256}`);
  ctx.db.close();
}

async function verificar(perfil: string, manifiestoRuta: string): Promise<void> {
  validarPerfil(perfil);
  exigirMarcadorQa(perfil, false);
  const esperado = JSON.parse(fs.readFileSync(manifiestoRuta, 'utf8')) as ManifiestoSemilla;
  // Verificación de LECTURA: abrir la base SIN aplicar migraciones (readonly) para no
  // recomponer con la fuente actual lo que se pretende evaluar de la versión instalada.
  // Rutas calculadas SIN crear directorios (prepararRutasDatos hace mkdir): verificación de lectura.
  const rutaDatos = path.join(perfil, 'datos');
  const rutaDb = path.join(rutaDatos, 'arkon.db');
  if (!fs.existsSync(rutaDb)) {
    console.log(`FALLA base-existe: falta ${rutaDb}`);
    console.log('RESULTADO VERIFICACIÓN: FALLA');
    process.exitCode = 2;
    return;
  }
  const Database = (await import('better-sqlite3')).default;
  const db = new Database(rutaDb, { readonly: true, fileMustExist: true });
  const rutas = prepararRutasDatos(perfil);
  let estado: 'PASA' | 'FALLA' = 'PASA' as 'PASA' | 'FALLA';
  const comprobar = (nombre: string, ok: boolean, detalle: string) => {
    console.log(`${ok ? 'PASA' : 'FALLA'} ${nombre}: ${detalle}`);
    if (!ok) {
      estado = 'FALLA';
    }
  };

  const venta = db
    .prepare('SELECT folio, total_minor, estado FROM venta WHERE folio = ?')
    .get(esperado.ventaFolio) as { folio: string; total_minor: number; estado: string } | undefined;
  comprobar('venta-existe', Boolean(venta), venta ? `${venta.folio} ${venta.estado}` : `falta ${esperado.ventaFolio}`);
  comprobar(
    'venta-total',
    Boolean(venta) && minorATexto(BigInt(venta!.total_minor)) === esperado.ventaTotalMinor,
    venta ? minorATexto(BigInt(venta.total_minor)) : '—'
  );

  const cliente = db
    .prepare('SELECT nombre FROM contraparte WHERE id = ?')
    .get(esperado.contraparteId) as { nombre: string } | undefined;
  comprobar('contraparte-existe', Boolean(cliente), cliente?.nombre ?? 'falta');

  const adjunto = db
    .prepare('SELECT ruta_relativa, hash_sha256 FROM adjunto WHERE hash_sha256 = ?')
    .get(esperado.adjuntoHash) as { ruta_relativa: string; hash_sha256: string } | undefined;
  comprobar('adjunto-registrado', Boolean(adjunto), adjunto?.ruta_relativa ?? 'falta');
  if (adjunto) {
    const rutaAdjunto = path.join(rutas.adjuntos, adjunto.ruta_relativa);
    const existe = fs.existsSync(rutaAdjunto);
    comprobar('adjunto-archivo', existe, rutaAdjunto);
    if (existe) {
      const hash = crypto.createHash('sha256').update(fs.readFileSync(rutaAdjunto)).digest('hex');
      comprobar('adjunto-hash', hash === esperado.adjuntoHash, hash.slice(0, 12) + '…');
    }
  }

  const eventos = listarEventos(db, 500);
  comprobar(
    'bitacora-conserva',
    eventos.length >= esperado.eventosEsperados,
    `${eventos.length} eventos (esperados >= ${esperado.eventosEsperados})`
  );

  if (esperado.respaldoHash && esperado.respaldoNombre) {
    const rutaRespaldo = path.join(rutas.respaldos, esperado.respaldoNombre);
    const respaldoExiste = fs.existsSync(rutaRespaldo);
    comprobar('respaldo-previo-presente', respaldoExiste, esperado.respaldoNombre);
    if (respaldoExiste) {
      try {
        const hashRespaldo = crypto.createHash('sha256').update(fs.readFileSync(rutaRespaldo)).digest('hex');
        comprobar('respaldo-hash', hashRespaldo === esperado.respaldoHash, hashRespaldo.slice(0, 12) + '…');
        const rutaManifiestoRespaldo = `${rutaRespaldo}.manifest.json`;
        comprobar('respaldo-manifiesto', fs.existsSync(rutaManifiestoRespaldo), rutaManifiestoRespaldo);
        if (fs.existsSync(rutaManifiestoRespaldo)) {
          const manifiestoRespaldo = JSON.parse(fs.readFileSync(rutaManifiestoRespaldo, 'utf8')) as { hashSha256?: string };
          comprobar(
            'respaldo-manifiesto-hash',
            manifiestoRespaldo.hashSha256 === esperado.respaldoHash,
            manifiestoRespaldo.hashSha256?.slice(0, 12) + '…'
          );
        }
      } catch (err) {
        comprobar('respaldo-lectura', false, String(err instanceof Error ? err.message : err));
      }
    }
  }

  console.log(`RESULTADO VERIFICACIÓN: ${estado}`);
  db.close();
  if (estado === 'FALLA') {
    process.exitCode = 2;
  }
}

function minorATexto(minor: bigint): string {
  const negativo = minor < 0n;
  const abs = negativo ? -minor : minor;
  const texto = `${abs / 100n}.${(abs % 100n).toString().padStart(2, '0')}`;
  return negativo ? `-${texto}` : texto;
}

function main(): void {
  const [modo, ...resto] = process.argv.slice(2);
  const args: Record<string, string> = {};
  for (let i = 0; i < resto.length; i += 2) {
    args[resto[i]!.replace(/^--/, '')] = resto[i + 1] ?? '';
  }
  const perfil = args.perfil;
  const manifiesto = args.manifiesto;
  if (!perfil || !manifiesto) {
    console.error('Uso: semilla-qa.js <sembrar|respaldar|verificar> --perfil <ruta absoluta> --manifiesto <ruta>');
    process.exitCode = 1;
    return;
  }
  if (modo === 'sembrar') {
    sembrar(perfil, manifiesto);
  } else if (modo === 'respaldar') {
    void respaldar(perfil, manifiesto);
  } else if (modo === 'verificar') {
    void verificar(perfil, manifiesto);
  } else {
    console.error(`Modo desconocido: ${modo}`);
    process.exitCode = 1;
  }
}

main();
