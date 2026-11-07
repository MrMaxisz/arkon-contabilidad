import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { SqliteWasmDatabaseAdapter } from './sqliteWasm';
import { aplicarMigraciones } from '../main/db/aplicarMigraciones';
import { sembrarCatalogoBase } from '../main/servicios/cuentas';
import { despachar, comandos, type ContextoApp } from '../main/comandos';
import { crearPlataformaMemoria, type ModuloWasmRespaldo } from './memoria';
import { sha256 } from '../shared/sha256';
import { exportarTraspaso, importarTraspaso } from '../main/servicios/traspaso';
import { crearContextoBase } from '../main/servicios/restauracion';
import { abrirAdjuntosOpfs } from './adjuntosOpfs';
import { migraciones } from '../main/db/migraciones';

export async function abrirMotorAndroid(antesInstalar?: () => Promise<void>) {
  // El paquete usa new URL('sqlite3.wasm', import.meta.url): Vite incluye el WASM con su URL final.
  const sqlite = await sqlite3InitModule();
  // No hay fallback a memoria: si OPFS falla, no se permite registrar datos.
  const pool = await sqlite.installOpfsSAHPoolVfs({
    name: 'opfs-sahpool', directory: '/arkon-administrativo',
    preserveOnInitFailure: true
  });
  await pool.reserveMinimumCapacity(10); // activa, diarios, anterior, premigración y temporales
  const adjuntos = await abrirAdjuntosOpfs();
  let estado = await adjuntos.leerEstado();
  if (estado.pendiente) {
    try {
      await pool.importDb('/arkon.db', pool.exportFile(estado.pendiente.copia));
      estado = { activo: estado.pendiente.anterior, previo: estado.previo };
      await adjuntos.guardarEstado(estado);
    } finally { pool.pauseVfs(); }
    throw new Error('Operación interrumpida: se recuperó la base anterior. Vuelve a abrir la app.');
  }
  const abrir = () => {
    const db = new SqliteWasmDatabaseAdapter(new pool.OpfsSAHPoolDb('/arkon.db'));
    db.pragma('foreign_keys = ON'); db.pragma('journal_mode = DELETE'); db.pragma('synchronous = FULL');
    return db;
  };
  const existente = pool.getFileNames().includes('/arkon.db');
  let db = abrir();
  const ctx: ContextoApp = {
    db: db as unknown as ContextoApp['db'], rutaDb: '/arkon.db', versionApp: '0.1.0',
    rutas: { raiz: '/', datos: '/', adjuntos: '/adjuntos', respaldos: '/respaldos', registros: '/registros' },
    reabrirBase() {
      if (db.open) db.close();
      db = abrir(); ctx.db = db as unknown as ContextoApp['db'];
      aplicarMigraciones(ctx.db);
    }
  };
  let premigracion = false;
  try {
    if (existente) {
      const hayTabla = db.prepare("SELECT 1 AS x FROM sqlite_master WHERE name = '_migracion'").get();
      const aplicadas = new Set(hayTabla ? db.prepare('SELECT version FROM _migracion').all().map(r => Number(r.version)) : []);
      if ([...aplicadas].some(v => v > migraciones.at(-1)!.version)) throw new Error('La base usa un esquema más nuevo. Actualiza la app para abrirlo.');
      if (migraciones.some(m => !aplicadas.has(m.version))) {
        await pool.importDb('/arkon-premigracion.db', pool.exportFile('/arkon.db'));
        await adjuntos.guardarEstado({ ...estado, pendiente: { anterior: estado.activo, copia: '/arkon-premigracion.db' } });
        premigracion = true;
      }
    }
    aplicarMigraciones(ctx.db);
    sembrarCatalogoBase(ctx.db, 'sistema');
    db.prepare("INSERT OR IGNORE INTO ambito (id, nombre, tipo) VALUES ('administrativo', 'Administrativo', 'administrativo')").run();
    if (premigracion) await adjuntos.guardarEstado(estado);
  } catch (error) {
    db.close();
    if (premigracion) {
      try {
        await pool.importDb('/arkon.db', pool.exportFile('/arkon-premigracion.db'));
        await adjuntos.guardarEstado(estado);
      } catch (recuperacion) {
        pool.pauseVfs();
        throw new Error(`Migración fallida: ${String(error)}. Recuperación pendiente: ${String(recuperacion)}`);
      }
    }
    pool.pauseVfs();
    throw new Error(`${String(error)}${premigracion ? '. Se recuperó la base anterior a la migración.' : ''}`);
  }
  async function contextoVirtual() {
    const p = crearPlataformaMemoria(sqlite as unknown as ModuloWasmRespaldo, sha256);
    const rutas = p.prepararRutasDatos('/virtual');
    p.archivos.writeFileSync('/virtual/datos/arkon.db', pool.exportFile('/arkon.db'));
    const copia = await crearContextoBase(rutas, '/virtual/datos/arkon.db', ctx.versionApp, p);
    return copia;
  }
  let recuperacionBloqueada = false;
  async function importar(bytes: Uint8Array) {
    if (!(bytes instanceof Uint8Array)) throw new Error('El traspaso requiere bytes Uint8Array');
    const copia = await contextoVirtual();
    try {
      // Toda la validación y las migraciones existentes ocurren en una copia virtual.
      await importarTraspaso(copia, bytes);
      const p = copia.plataforma!;
      await p.copiarBase(copia.db, '/nueva.db');
      const nueva = `adjuntos-${crypto.randomUUID()}`;
      await adjuntos.guardar(nueva, copia.db, p, copia.rutas.adjuntos);
      await pool.importDb('/arkon-anterior.db', pool.exportFile('/arkon.db'));
      const anterior = estado;
      await adjuntos.guardarEstado({ ...estado, pendiente: { anterior: estado.activo, copia: '/arkon-anterior.db' } });
      try {
        db.close();
        // Punto de sustitución aislable en pruebas de corte; no es un comando Worker.
        if (antesInstalar) await antesInstalar();
        await pool.importDb('/arkon.db', p.archivos.readFileSync('/nueva.db'));
        ctx.reabrirBase();
        await adjuntos.guardarEstado({ activo: nueva, previo: anterior.activo });
        estado = { activo: nueva, previo: anterior.activo };
      } catch (error) {
        try {
          if (db.open) db.close();
          await pool.importDb('/arkon.db', pool.exportFile('/arkon-anterior.db'));
          ctx.reabrirBase();
          await adjuntos.guardarEstado(anterior);
          estado = anterior;
        } catch (recuperacion) {
          recuperacionBloqueada = true;
          if (db.open) db.close();
          pool.pauseVfs();
          throw new Error(`Importación fallida: ${String(error)}. Recuperación pendiente: ${String(recuperacion)}. Vuelve a abrir la app.`);
        }
        throw new Error(`Importación fallida: ${String(error)}. Se recuperó la base anterior.`);
      }
      // Retener la generación de /arkon-anterior.db, no acumular un historial de adjuntos.
      if (anterior.previo && anterior.previo !== anterior.activo) {
        try { await adjuntos.descartar(anterior.previo); } catch { /* no invalidar una importación ya confirmada */ }
      }
      return { ok: true, detalle: 'Base importada; copia previa en /arkon-anterior.db' };
    } finally { if (copia.db.open) copia.db.close(); }
  }
  return {
    get db() { return db; },
    async invocar(comando: string, datos?: unknown) {
      if (recuperacionBloqueada) throw new Error('Recuperación pendiente. Vuelve a abrir la app; no se permiten escrituras.');
      if (comando === 'traspaso:importar') return importar((datos as { bytes: Uint8Array })?.bytes);
      if (comando === 'traspaso:exportar') {
        const copia = await contextoVirtual();
        try {
          await adjuntos.cargar(estado.activo, copia.db, copia.plataforma!, copia.rutas.adjuntos);
          return await exportarTraspaso(copia);
        } finally { copia.db.close(); }
      }
      if (!Object.hasOwn(comandos, comando)) throw new Error(`Comando desconocido: ${comando}`);
      if (/^(respaldo:|adjunto:|config:respaldo|vigencia:|fiscal:|retencion:)/.test(comando)) {
        throw new Error('Esta función no está disponible aún en Android (solo ámbito administrativo)');
      }
      if (datos && typeof datos === 'object' && 'ambitoId' in datos && datos.ambitoId !== undefined && datos.ambitoId !== 'administrativo') {
        throw new Error('Android solo admite el ámbito administrativo');
      }
      return despachar(ctx, comando, datos);
    },
    cerrar() { db.close(); pool.pauseVfs(); }
  };
}
