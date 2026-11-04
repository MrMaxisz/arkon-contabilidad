import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import { abrirBase, prepararRutasDatos } from './db/conexion';
import { aplicarMigraciones } from './db/aplicarMigraciones';
import { sembrarCatalogoBase } from './servicios/cuentas';
import { registrarIpc, type ContextoApp } from './ipc';

const RUTA_BASE_DATOS = 'arkon.db';

function rutaDatosUsuario(): string {
  const local = process.env.LOCALAPPDATA;
  if (local && process.platform === 'win32') {
    return path.join(local, 'ARKON Contabilidad');
  }
  return path.join(app.getPath('home'), '.arkon-contabilidad');
}

let ctx: ContextoApp | null = null;

function crearContexto(): ContextoApp {
  const rutas = prepararRutasDatos(rutaDatosUsuario());
  const rutaDb = path.join(rutas.datos, RUTA_BASE_DATOS);
  const db = abrirBase(rutaDb);
  aplicarMigraciones(db);
  db.prepare(
    "INSERT OR IGNORE INTO ambito (id, nombre, tipo) VALUES ('administrativo', 'ARKON · control administrativo previo a la constitución', 'administrativo')"
  ).run();
  sembrarCatalogoBase(db);
  return {
    db,
    rutas,
    versionApp: app.getVersion(),
    rutaDb,
    reabrirBase() {
      this.db = abrirBase(rutaDb);
      aplicarMigraciones(this.db);
    }
  };
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

  app.whenReady().then(() => {
    ctx = crearContexto();
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
