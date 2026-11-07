import { SqliteWasmDatabaseAdapter } from './sqliteWasm';
import { comprobarIntegridad, type BaseDatos, type Plataforma } from './plataforma';
import * as adjuntos from '../main/servicios/adjuntos';

type ConexionWasm = ConstructorParameters<typeof SqliteWasmDatabaseAdapter>[0] & { pointer: number };
export interface ModuloWasmRespaldo {
  oo1: { DB: new (nombre: string, flags: string) => ConexionWasm };
  capi: {
    sqlite3_js_db_export(db: number): Uint8Array;
    sqlite3_deserialize(db: number, esquema: string, datos: number, tamano: number, capacidad: number, flags: number): number;
  };
  wasm: { allocFromTypedArray(datos: Uint8Array): number; dealloc(puntero: number): void };
}

// Banco de prueba Android: archivos virtuales, una conexión por base y una imagen
// SQLite completa por archivo. El hash síncrono se inyecta igual que SQLite ya iniciado.
export function crearPlataformaMemoria(sqlite: ModuloWasmRespaldo, sha256: (datos: Uint8Array) => string): Plataforma {
  const archivos = new Map<string, Uint8Array>();
  const directorios = new Set<string>(['/']);
  const conexiones = new WeakMap<BaseDatos, ConexionWasm>();
  const normalizar = (ruta: string) => '/' + ruta.split('/').filter(Boolean).join('/');
  const leer = (ruta: string): Uint8Array => {
    const datos = archivos.get(normalizar(ruta));
    if (!datos) throw new Error(`No existe el archivo: ${ruta}`);
    return new Uint8Array(datos);
  };
  const abrir = (ruta: string, copia: boolean, soloLectura = false): BaseDatos => {
    if (copia && !archivos.has(normalizar(ruta))) throw new Error(`No existe el archivo: ${ruta}`);
    const conexion = new sqlite.oo1.DB(':memory:', 'c');
    try {
      if (archivos.has(normalizar(ruta))) {
        const datos = leer(ruta);
        // backup nativo puede conservar la cabecera WAL aunque la imagen sea
        // autocontenida. En memoria no hay VFS WAL: importar en modo rollback.
        if (datos.length >= 100) { datos[18] = 1; datos[19] = 1; }
        const puntero = sqlite.wasm.allocFromTypedArray(datos);
        const codigo = sqlite.capi.sqlite3_deserialize(conexion.pointer, 'main', puntero, datos.length, datos.length, 3);
        if (codigo !== 0) {
          sqlite.wasm.dealloc(puntero);
          throw new Error(`No se pudo importar SQLite: ${codigo}`);
        }
      }
      const adaptador = new SqliteWasmDatabaseAdapter(conexion);
      adaptador.pragma('foreign_keys = ON');
      if (copia) adaptador.pragma('query_only = ON');
      const cerrar = adaptador.close.bind(adaptador);
      adaptador.close = () => {
        if (adaptador.open && !copia && !soloLectura) archivos.set(normalizar(ruta), sqlite.capi.sqlite3_js_db_export(conexion.pointer).slice());
        cerrar();
      };
      const db = adaptador as unknown as BaseDatos;
      conexiones.set(db, conexion);
      return db;
    } catch (error) {
      conexion.close();
      throw error;
    }
  };
  const plataforma: Plataforma = {
    archivos: {
      existsSync: ruta => archivos.has(normalizar(ruta)) || directorios.has(normalizar(ruta)),
      statSync(ruta) {
        if (!this.existsSync(ruta)) throw new Error(`No existe: ${ruta}`);
        return { size: archivos.get(normalizar(ruta))?.length ?? 0, isFile: () => archivos.has(normalizar(ruta)) };
      },
      readFileSync: ((ruta: string, codificacion?: 'utf8') => codificacion ? new TextDecoder().decode(leer(ruta)) : leer(ruta)) as Plataforma['archivos']['readFileSync'],
      writeFileSync(ruta, datos) { archivos.set(normalizar(ruta), typeof datos === 'string' ? new TextEncoder().encode(datos) : new Uint8Array(datos)); },
      mkdirSync(ruta) {
        const partes = normalizar(ruta).split('/');
        for (let i = 1; i <= partes.length; i++) directorios.add(normalizar(partes.slice(0, i).join('/')));
      },
      readdirSync(ruta) {
        const prefijo = normalizar(ruta) + '/';
        return [...new Set([...archivos.keys(), ...directorios].filter(r => r.startsWith(prefijo)).map(r => r.slice(prefijo.length).split('/')[0]!))];
      },
      copyFileSync(origen, destino) { archivos.set(normalizar(destino), leer(origen)); },
      renameSync(origen, destino) {
        const desde = normalizar(origen), hasta = normalizar(destino);
        if (archivos.has(desde)) { this.copyFileSync(desde, hasta); archivos.delete(desde); return; }
        if (!directorios.has(desde)) throw new Error(`No existe: ${origen}`);
        for (const [ruta, datos] of [...archivos]) if (ruta.startsWith(desde + '/')) { archivos.set(hasta + ruta.slice(desde.length), datos); archivos.delete(ruta); }
        for (const ruta of [...directorios]) if (ruta === desde || ruta.startsWith(desde + '/')) { directorios.add(hasta + ruta.slice(desde.length)); directorios.delete(ruta); }
      },
      rmSync(ruta, opciones) {
        const nombre = normalizar(ruta);
        archivos.delete(nombre);
        if (opciones.recursive) {
          for (const clave of archivos.keys()) if (clave.startsWith(nombre + '/')) archivos.delete(clave);
          for (const clave of directorios) if (clave.startsWith(nombre + '/')) directorios.delete(clave);
        }
        directorios.delete(nombre);
      }
    },
    rutas: {
      join: (...partes) => normalizar(partes.join('/')),
      basename: ruta => ruta.split('/').filter(Boolean).pop() ?? '',
      extname: ruta => /\.[^./]+$/.exec(ruta)?.[0] ?? '',
      isAbsolute: ruta => /^(?:\/|[a-zA-Z]:)/.test(ruta),
      sep: '/'
    },
    prepararRutasDatos(raiz) {
      const rutas = { raiz, datos: this.rutas.join(raiz, 'datos'), adjuntos: this.rutas.join(raiz, 'adjuntos'), respaldos: this.rutas.join(raiz, 'respaldos'), registros: this.rutas.join(raiz, 'registros') };
      for (const ruta of Object.values(rutas)) this.archivos.mkdirSync(ruta, { recursive: true });
      return rutas;
    },
    abrirBase: ruta => abrir(ruta, false),
    abrirCopia: (ruta, soloLectura) => abrir(ruta, true, soloLectura),
    async copiarBase(db, destino) {
      const conexion = conexiones.get(db);
      if (!conexion || !db.open) throw new Error('La base WASM no está abierta en esta plataforma');
      archivos.set(normalizar(destino), sqlite.capi.sqlite3_js_db_export(conexion.pointer).slice());
    },
    verificarIntegridad(ruta) {
      const db = abrir(ruta, true);
      try { comprobarIntegridad(db); } finally { db.close(); }
    },
    hashArchivo: ruta => sha256(leer(ruta)),
    copiarAdjuntosRespaldo: (db, origen, destino) => adjuntos.copiarAdjuntosRespaldo(db, origen, destino, plataforma),
    restaurarAdjuntosRespaldo: (origen, destino, esperados) => adjuntos.restaurarAdjuntosRespaldo(origen, destino, esperados, plataforma),
    retencionRespaldosAutomaticos: (db, dir) => adjuntos.retencionRespaldosAutomaticos(db, dir, plataforma),
    inventarioAdjuntosRegistrado: adjuntos.inventarioAdjuntosRegistrado,
    validarRutasRelativas: rutas => adjuntos.validarRutasRelativas(rutas, plataforma)
  };
  return plataforma;
}
