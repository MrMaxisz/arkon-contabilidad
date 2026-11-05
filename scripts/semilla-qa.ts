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

function validarPerfil(perfil: string): void {
  if (!path.isAbsolute(perfil)) {
    throw new Error(`El perfil debe ser una ruta ABSOLUTA: ${perfil}`);
  }
  const normalizado = path.normalize(perfil);
  if (normalizado.includes('OneDrive')) {
    throw new Error(`El perfil no puede estar bajo OneDrive: ${normalizado}`);
  }
  const local = process.env.LOCALAPPDATA;
  if (local && normalizado === path.normalize(path.join(local, 'ARKON Contabilidad'))) {
    throw new Error(`El perfil no puede ser la base operativa: ${normalizado}`);
  }
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
  const ctx = contexto(perfil);
  const respaldo = await crearRespaldo(ctx.db, ctx.rutas.respaldos, ctx.versionApp, ctx.rutas.adjuntos);
  const manifiesto = JSON.parse(fs.readFileSync(manifiestoRuta, 'utf8')) as ManifiestoSemilla;
  manifiesto.respaldoHash = respaldo.hashSha256;
  manifiesto.respaldoNombre = respaldo.nombre;
  fs.writeFileSync(manifiestoRuta, JSON.stringify(manifiesto, null, 2), 'utf8');
  console.log(`RESPALDO OK: ${respaldo.nombre} hash=${respaldo.hashSha256}`);
  ctx.db.close();
}

function verificar(perfil: string, manifiestoRuta: string): void {
  validarPerfil(perfil);
  const esperado = JSON.parse(fs.readFileSync(manifiestoRuta, 'utf8')) as ManifiestoSemilla;
  const ctx = contexto(perfil);
  let estado: 'PASA' | 'FALLA' = 'PASA' as 'PASA' | 'FALLA';
  const comprobar = (nombre: string, ok: boolean, detalle: string) => {
    console.log(`${ok ? 'PASA' : 'FALLA'} ${nombre}: ${detalle}`);
    if (!ok) {
      estado = 'FALLA';
    }
  };

  const venta = ctx.db
    .prepare('SELECT folio, total_minor, estado FROM venta WHERE folio = ?')
    .get(esperado.ventaFolio) as { folio: string; total_minor: number; estado: string } | undefined;
  comprobar('venta-existe', Boolean(venta), venta ? `${venta.folio} ${venta.estado}` : `falta ${esperado.ventaFolio}`);
  comprobar(
    'venta-total',
    Boolean(venta) && minorATexto(BigInt(venta!.total_minor)) === esperado.ventaTotalMinor,
    venta ? minorATexto(BigInt(venta.total_minor)) : '—'
  );

  const cliente = ctx.db
    .prepare('SELECT nombre FROM contraparte WHERE id = ?')
    .get(esperado.contraparteId) as { nombre: string } | undefined;
  comprobar('contraparte-existe', Boolean(cliente), cliente?.nombre ?? 'falta');

  const adjunto = ctx.db
    .prepare('SELECT ruta_relativa, hash_sha256 FROM adjunto WHERE hash_sha256 = ?')
    .get(esperado.adjuntoHash) as { ruta_relativa: string; hash_sha256: string } | undefined;
  comprobar('adjunto-registrado', Boolean(adjunto), adjunto?.ruta_relativa ?? 'falta');
  if (adjunto) {
    const rutaAdjunto = path.join(ctx.rutas.adjuntos, adjunto.ruta_relativa);
    const existe = fs.existsSync(rutaAdjunto);
    comprobar('adjunto-archivo', existe, rutaAdjunto);
    if (existe) {
      const hash = crypto.createHash('sha256').update(fs.readFileSync(rutaAdjunto)).digest('hex');
      comprobar('adjunto-hash', hash === esperado.adjuntoHash, hash.slice(0, 12) + '…');
    }
  }

  const eventos = listarEventos(ctx.db, 500);
  comprobar(
    'bitacora-conserva',
    eventos.length >= esperado.eventosEsperados,
    `${eventos.length} eventos (esperados >= ${esperado.eventosEsperados})`
  );

  if (esperado.respaldoHash) {
    const respaldoExiste = fs.existsSync(path.join(ctx.rutas.respaldos, esperado.respaldoNombre ?? ''));
    comprobar('respaldo-previo-presente', respaldoExiste, esperado.respaldoNombre ?? '—');
  }

  console.log(`RESULTADO VERIFICACIÓN: ${estado}`);
  ctx.db.close();
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
    verificar(perfil, manifiesto);
  } else {
    console.error(`Modo desconocido: ${modo}`);
    process.exitCode = 1;
  }
}

main();
