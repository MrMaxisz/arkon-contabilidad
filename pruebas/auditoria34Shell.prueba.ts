import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const manejadores = vi.hoisted(() => new Map<string, (evento: unknown, solicitud: unknown) => unknown>());
const openPath = vi.hoisted(() => vi.fn());
const showOpenDialog = vi.hoisted(() => vi.fn());

vi.mock('electron', () => ({
  ipcMain: {
    handle: (canal: string, fn: (evento: unknown, solicitud: unknown) => unknown) => {
      manejadores.set(canal, fn);
    }
  },
  dialog: { showSaveDialog: vi.fn(), showOpenDialog: (o: unknown) => showOpenDialog(o) },
  BrowserWindow: { fromWebContents: () => null },
  shell: { openPath: (p: string) => openPath(p) }
}));

import { abrirBase, prepararRutasDatos } from '../src/main/db/conexion';
import { aplicarMigraciones } from '../src/main/db/aplicarMigraciones';
import { sembrarCatalogoBase } from '../src/main/servicios/cuentas';
import { registrarIpc } from '../src/main/ipc';
import { registrarAdjunto } from '../src/main/servicios/adjuntos';
import { crearContraparte, registrarCompra } from '../src/main/servicios/operacion';
import type BetterSqlite3 from 'better-sqlite3';

let dir: string;
let rutaDb: string;
let rutas: ReturnType<typeof prepararRutasDatos>;
const abiertas: Array<BetterSqlite3.Database> = [];

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arkon-a34s-'));
  rutas = prepararRutasDatos(path.join(dir, 'datos'));
  rutaDb = path.join(rutas.datos, 'op.db');
  fs.mkdirSync(rutas.datos, { recursive: true });
  const db = abrirBase(rutaDb);
  aplicarMigraciones(db);
  sembrarCatalogoBase(db);
  db.prepare("INSERT INTO ambito (id, nombre, tipo) VALUES ('administrativo', 'Prueba a34s', 'administrativo')").run();
  const proveedor = crearContraparte(db, { nombre: 'Proveedor Shell A34', esCliente: false, esProveedor: true, responsable: 'p' });
  registrarCompra(db, {
    contraparteId: proveedor,
    fechaOperacion: '2026-11-02',
    concepto: 'Compra shell sintética',
    condicion: 'contado',
    lineas: [{ descripcion: 'Material sintético', cuentaCodigo: '5101', cantidad: '1', precioUnitario: '10.00', tasa: '0', tratamiento: 'exento' }],
    claveIdempotencia: 'c-a34s',
    responsable: 'p'
  });
  const origen = path.join(dir, 'doc-shell.txt');
  fs.writeFileSync(origen, 'contenido shell sintético', 'utf8');
  registrarAdjunto(db, rutas.adjuntos, {
    entidad: 'compra',
    entidadId: 'CMP-000001',
    nombreOriginal: 'doc-shell.txt',
    rutaOrigen: origen,
    responsable: 'p'
  });
  abiertas.push(db);
  openPath.mockReset();
  registrarIpc(
    {
      db,
      rutas,
      versionApp: 'prueba',
      rutaDb,
      reabrirBase() {
        return;
      }
    },
    4242
  );
});

afterEach(() => {
  for (const db of abiertas.splice(0)) {
    if (db.open) {
      db.close();
    }
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

const evento = { sender: { id: 4242 } };
const eventoAjeno = { sender: { id: 9999 } };

function adjuntoId(): number {
  const db = abiertas[0];
  return (db.prepare('SELECT id FROM adjunto ORDER BY id LIMIT 1').get() as { id: number }).id;
}

describe('auditoría 34: abrirAdjunto sin éxito falso', () => {
  it('shell.openPath con texto de error se comunica como fallo, no como abierto', async () => {
    openPath.mockResolvedValue('No application is associated with the specified file');
    const handler = manejadores.get('arkon:abrirAdjunto')!;
    await expect(handler(evento, { id: adjuntoId() })).rejects.toThrow(
      /No se pudo abrir el adjunto doc-shell\.txt: No application is associated/
    );
  });

  it('shell.openPath con texto vacío reporta apertura correcta', async () => {
    openPath.mockResolvedValue('');
    const handler = manejadores.get('arkon:abrirAdjunto')!;
    const r = (await handler(evento, { id: adjuntoId() })) as { abierto: boolean; nombreOriginal: string };
    expect(r.abierto).toBe(true);
    expect(r.nombreOriginal).toBe('doc-shell.txt');
  });

  it('el rechazo de shell.openPath y el remitente ajeno se propagan como error', async () => {
    openPath.mockRejectedValue(new Error('fallo sintético del sistema'));
    const handler = manejadores.get('arkon:abrirAdjunto')!;
    await expect(handler(evento, { id: adjuntoId() })).rejects.toThrow(/fallo sintético del sistema/);
    openPath.mockResolvedValue('');
    await expect(handler(eventoAjeno, { id: adjuntoId() })).rejects.toThrow(/Remitente no autorizado/);
  });

  it('guardarPaqueteContador escribe los archivos del paquete en la carpeta elegida', async () => {
    const carpetaDestino = path.join(dir, 'destino-contador');
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [carpetaDestino] });
    const handler = manejadores.get('arkon:guardarPaqueteContador')!;
    const r = (await handler(evento, { desde: '2026-11-01', hasta: '2026-11-30' })) as {
      guardado: boolean;
      ruta: string;
      archivos: string[];
    };
    expect(r.guardado).toBe(true);
    expect(r.archivos).toContain('LEEME.txt');
    expect(r.archivos).toContain('auxiliar-clientes.csv');
    const leeme = fs.readFileSync(path.join(r.ruta, 'LEEME.txt'), 'utf8');
    expect(leeme).toContain('paquete-contador-v1');
    const clientes = fs.readFileSync(path.join(r.ruta, 'auxiliar-clientes.csv'), 'utf8');
    expect(clientes).toContain('contraparte,folio,fecha,concepto,total,aplicado,saldo');
    const bitacora = abiertas[0]
      .prepare("SELECT COUNT(*) AS n FROM bitacora_evento WHERE tipo = 'paquete_contador'")
      .get() as { n: number };
    expect(bitacora.n).toBe(1);
  });

  it('la cancelación del diálogo de paquete no escribe nada', async () => {
    showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });
    const handler = manejadores.get('arkon:guardarPaqueteContador')!;
    const r = (await handler(evento, { desde: '2026-11-01', hasta: '2026-11-30' })) as { guardado: boolean };
    expect(r.guardado).toBe(false);
    expect(fs.existsSync(path.join(dir, 'destino-contador'))).toBe(false);
  });

  it('un adjunto con hash alterado no se abre aunque shell funcione', async () => {
    const db = abiertas[0];
    const fila = db.prepare('SELECT ruta_relativa FROM adjunto ORDER BY id LIMIT 1').get() as { ruta_relativa: string };
    fs.writeFileSync(path.join(rutas.adjuntos, fila.ruta_relativa), 'contenido alterado sintético', 'utf8');
    openPath.mockResolvedValue('');
    const handler = manejadores.get('arkon:abrirAdjunto')!;
    await expect(handler(evento, { id: adjuntoId() })).rejects.toThrow(/no coincide/);
  });
});
