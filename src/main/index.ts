import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'path';
import fs from 'fs';
import { prepararRutasDatos } from './db/conexion';
import { sembrarCatalogoBase } from './servicios/cuentas';
import { registrarIpc } from './ipc';
import { crearContextoBase, type ContextoApp, ErrorRecuperacionPendiente, respaldoPeriodicoSiCorresponde } from './servicios/restauracion';
import { decidirPerfil } from './perfilQa';

const RUTA_BASE_DATOS = 'arkon.db';

function rutaOperativaCalculada(): string {
  const local = process.env.LOCALAPPDATA;
  if (local && process.platform === 'win32') {
    return path.join(local, 'ARKON Contabilidad');
  }
  return path.join(app.getPath('home'), '.arkon-contabilidad');
}

function leerCanalEmpaquetado(): string | undefined {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(app.getAppPath(), 'package.json'), 'utf8')) as { arkonCanal?: unknown };
    return typeof pkg.arkonCanal === 'string' ? pkg.arkonCanal : undefined;
  } catch {
    return undefined;
  }
}

function accesoArchivosPerfil() {
  return {
    resolverRealpath(ruta: string): string {
      try {
        return fs.realpathSync(ruta);
      } catch {
        return ruta;
      }
    },
    leerArchivo(ruta: string): string | null {
      try {
        return fs.readFileSync(ruta, 'utf8');
      } catch {
        return null;
      }
    }
  };
}

// Barrera QA: se evalúa ANTES del bloqueo de instancia, de crear carpetas o de abrir SQLite.
// Canal ausente (desarrollo/producción): comportamiento histórico sin cambios.
const decisionPerfil = decidirPerfil({
  canal: leerCanalEmpaquetado(),
  rutaEnv: process.env.ARKON_RUTA_DATOS,
  rutaOperativa: rutaOperativaCalculada(),
  archivos: accesoArchivosPerfil()
});

if (decisionPerfil.canal === 'qa' && !decisionPerfil.valido) {
  dialog.showErrorBox(
    'ARKON Contabilidad QA — perfil no válido',
    'Esta versión de prueba solo abre con su lanzador y un perfil QA válido. No se abrió ningún dato.'
  );
  app.exit(78);
} else {
  if (decisionPerfil.canal === 'qa') {
    // userData aislado del perfil QA antes del bloqueo de instancia.
    app.setPath('userData', decisionPerfil.rutaChromium);
  }

  let ctx: ContextoApp | null = null;
  let temporizadorRespaldo: NodeJS.Timeout | null = null;
  // Ruta ya validada por la barrera: en esta rama no puede ser null.
  const rutaDatosArranque = decisionPerfil.rutaDatos!;

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
      try {
        ctx = await crearContexto();
        const contextoVigente = ctx;
        temporizadorRespaldo = setInterval(() => {
          void respaldoPeriodicoSeguro(contextoVigente);
        }, 60_000);
      } catch (err) {
        if (err instanceof ErrorRecuperacionPendiente) {
          await dialog.showMessageBox({
            type: 'error',
            title: 'ARKON Contabilidad — recuperación pendiente',
            message: 'La aplicación no puede abrir con garantías mientras exista una restauración sin resolver.',
            detail: err.message,
            buttons: ['Cerrar']
          });
          app.quit();
          return;
        }
        throw err;
      }
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
    }).catch(async (err: unknown) => {
      // Error fatal de arranque (p. ej. módulo nativo con ABI incompatible): visible y salida controlada.
      const detalle = err instanceof Error ? `${err.message}\n\n${err.stack ?? ''}` : String(err);
      try {
        await dialog.showMessageBox({
          type: 'error',
          title: 'ARKON Contabilidad — error de arranque',
          message: 'La aplicación no pudo iniciar. El proceso se cerrará de forma controlada.',
          detail: `Si el detalle menciona NODE_MODULE_VERSION, el módulo nativo (better-sqlite3) fue compilado para otra versión de Node/Electron: reinstale el paquete o regenere el instalador con el ABI correcto.\n\n${detalle}`,
          buttons: ['Cerrar']
        });
      } catch {
        // Sin diálogo disponible (arranque muy temprano): registrar en stderr antes de salir.
        process.stderr.write(`ARKON error de arranque: ${detalle}\n`);
      }
      app.exit(1);
    });

    process.on('uncaughtException', (err: Error) => {
      process.stderr.write(`ARKON excepción no capturada: ${err.message}\n${err.stack ?? ''}\n`);
      try {
        dialog.showErrorBox('ARKON Contabilidad — error inesperado', `${err.message}\n\n${err.stack ?? ''}`);
      } catch {
        // Sin diálogo: ya se registró en stderr.
      }
      app.exit(1);
    });

    app.on('window-all-closed', () => {
      app.quit();
    });

    app.on('before-quit', () => {
      if (temporizadorRespaldo) {
        clearInterval(temporizadorRespaldo);
      }
      ctx?.db.close();
    });

    // Definiciones posteriores al bloqueo: la primera escritura (carpetas/SQLite) ocurre tras él.
    async function crearContexto(): Promise<ContextoApp> {
      const rutas = prepararRutasDatos(rutaDatosArranque);
      const rutaDb = path.join(rutas.datos, RUTA_BASE_DATOS);
      const ctx = await crearContextoBase(rutas, rutaDb, app.getVersion());
      ctx.db.prepare(
        "INSERT OR IGNORE INTO ambito (id, nombre, tipo) VALUES ('administrativo', 'ARKON · control administrativo previo a la constitución', 'administrativo')"
      ).run();
      sembrarCatalogoBase(ctx.db);
      return ctx;
    }

    async function respaldoPeriodicoSeguro(contexto: ContextoApp): Promise<void> {
      try {
        await respaldoPeriodicoSiCorresponde(contexto);
      } catch (err) {
        try {
          contexto.db
            .prepare('INSERT INTO bitacora_evento (actor, tipo, entidad, entidad_id, detalle) VALUES (?, ?, ?, ?, ?)')
            .run('sistema', 'respaldo_periodico_fallo', 'respaldo', 'periodico', JSON.stringify({ error: String(err instanceof Error ? err.message : err) }));
        } catch {
          return;
        }
      }
    }
  }
}
