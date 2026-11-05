import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import { prepararRutasDatos } from './db/conexion';
import { sembrarCatalogoBase } from './servicios/cuentas';
import { registrarIpc } from './ipc';
import { crearContextoBase, type ContextoApp } from './servicios/restauracion';

const RUTA_BASE_DATOS = 'arkon.db';

function rutaDatosUsuario(): string {
  const local = process.env.LOCALAPPDATA;
  if (local && process.platform === 'win32') {
    return path.join(local, 'ARKON Contabilidad');
  }
  return path.join(app.getPath('home'), '.arkon-contabilidad');
}

let ctx: ContextoApp | null = null;

async function crearContexto(): Promise<ContextoApp> {
  const rutas = prepararRutasDatos(rutaDatosUsuario());
  const rutaDb = path.join(rutas.datos, RUTA_BASE_DATOS);
  const ctx = await crearContextoBase(rutas, rutaDb, app.getVersion());
  ctx.db.prepare(
    "INSERT OR IGNORE INTO ambito (id, nombre, tipo) VALUES ('administrativo', 'ARKON · control administrativo previo a la constitución', 'administrativo')"
  ).run();
  sembrarCatalogoBase(ctx.db);
  return ctx;
}

const obtuvoUnico = app.requestSingleInstanceLock();
if (!obtuvoUnico) {
  app.quit();
} else {
  app.on('second-instance', () => {
    for (const ventana of BrowserWindow.getAllWindows()) {
      if (ventana.isMinimized()) {
        ventana.restore();
      }
      ventana.focus();
    }
  });

  app.whenReady().then(async () => {
    ctx = await crearContexto();
    const ventana = new BrowserWindow({
      width: 1280,
      height: 800,
      title: 'ARKON Contabilidad',
      webPreferences: {
        preload: path.join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });
    registrarIpc(ctx, ventana.webContents.id);
    void ventana.loadFile(path.join(__dirname, '../renderer/index.html'));
    ventana.on('closed', () => {
      ipcMain.removeHandler('arkon');
    });
  });

  app.on('window-all-closed', () => {
    app.quit();
  });

  app.on('before-quit', () => {
    ctx?.db.close();
  });
}
