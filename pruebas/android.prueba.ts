import { expect, it } from 'vitest';
import { build } from 'vite';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import electron from 'electron';
import { crearPlataformaEscritorio } from '../src/plataforma/escritorio';
import { crearContextoBase, type ContextoApp } from '../src/main/servicios/restauracion';
import { exportarTraspaso, importarTraspaso } from '../src/main/servicios/traspaso';
import { versionEsquemaActual } from '../src/main/db/aplicarMigraciones';
import { sembrarTraspaso, estadoTraspaso } from './traspasoSintetico';

it('AND3: build sin Node/Electron, OPFS real sin aislamiento, reinicio, corte y anchuras 360/800 en todas las secciones', async () => {
  const temporal = fs.mkdtempSync(path.resolve('dist/and3-'));
  const www = path.join(temporal, 'www');
  let proceso: ReturnType<typeof spawn> | undefined;
  let pc: ContextoApp | undefined;
  const paquetes = new Map<string, Uint8Array>();
  const servidor = createServer((req, res) => {
    const url = new URL(req.url!, 'http://localhost').pathname;
    if (req.method === 'POST' && ['/retorno.arkon','/recuperado.arkon'].includes(url)) {
      const chunks: Buffer[] = [];
      req.on('data', b => chunks.push(b));
      req.on('end', () => { paquetes.set(url, new Uint8Array(Buffer.concat(chunks))); res.end('ok'); });
      return;
    }
    if (paquetes.has(url)) { res.end(paquetes.get(url)); return; }
    const archivo = path.join(www, decodeURIComponent(new URL(req.url!, 'http://localhost').pathname));
    if (!archivo.startsWith(www + path.sep) || !fs.existsSync(archivo)) { res.writeHead(404).end(); return; }
    const mime: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm', '.css': 'text/css', '.svg': 'image/svg+xml' };
    res.setHeader('Content-Type', mime[path.extname(archivo)] ?? 'application/octet-stream');
    res.end(fs.readFileSync(archivo));
  });
  try {
    const p = crearPlataformaEscritorio(), rutas = p.prepararRutasDatos(path.join(temporal,'pc'));
    pc = await crearContextoBase(rutas,path.join(rutas.datos,'arkon.db'),'and4',p);
    sembrarTraspaso(pc);
    const esperado = estadoTraspaso(pc);
    paquetes.set('/and4.arkon',(await exportarTraspaso(pc)).bytes);
    pc.db.prepare('INSERT INTO _migracion (version,nombre) VALUES (?,?)').run(versionEsquemaActual()+1,'futura-sintetica');
    paquetes.set('/futuro.arkon',(await exportarTraspaso(pc)).bytes);
    pc.db.prepare('DELETE FROM _migracion WHERE version = ?').run(versionEsquemaActual()+1);
    await build({ configFile: 'vite.movil.config.ts', logLevel: 'error', build: {
      outDir: www, rollupOptions: { input: ['src/renderer/movil.html', 'pruebas/android/persistencia.ts'] }
    }, plugins: [{ name: 'prueba-html', generateBundle(_o, archivos) {
      const entrada = Object.values(archivos).find(a => a.type === 'chunk' && a.isEntry && a.name === 'persistencia')!;
      this.emitFile({ type: 'asset', fileName: 'pruebas/android/persistencia.html', source: `<!doctype html><html><body><script type="module" src="/${entrada.fileName}"></script></body></html>` });
    } }] });
    const assets = fs.readdirSync(path.join(www, 'assets'));
    expect(assets.some(a => a.endsWith('.wasm'))).toBe(true);
    for (const archivo of assets.filter(a => a.endsWith('.js'))) {
      expect(fs.readFileSync(path.join(www, 'assets', archivo), 'utf8')).not.toMatch(/require\(|from\s*["'](?:node:|electron|better-sqlite3)|__vite-browser-external/);
    }
    await new Promise<void>(resolve => servidor.listen(0, '127.0.0.1', resolve));
    const puerto = (servidor.address() as { port: number }).port;
    const perfil = path.join(temporal, 'perfil');
    fs.mkdirSync(perfil, { recursive: true });
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    proceso = spawn(electron as unknown as string, [path.resolve('pruebas/android/chromium.cjs'), `http://127.0.0.1:${puerto}`, '--enable-logging=stderr', '--disable-gpu', `--user-data-dir=${perfil}`], { env });
    let salida = '';
    proceso.stdout!.on('data', dato => { salida += dato; });
    proceso.stderr!.on('data', dato => { salida += dato; });
    const codigo = await new Promise<number | null>((resolve, reject) => { proceso!.on('error', reject); proceso!.on('close', resolve); });
    expect(codigo, salida).toBe(0);
    const resultado = JSON.parse(salida.match(/AND3_JSON=(.*)/)![1]!);
    const balance = { totalActivoMinor: '123.45', totalPasivoMinor: '0.00', totalPatrimonioMinor: '123.45', totalResultadoMinor: '0.00', cuadra: true };
    expect(resultado.persistencia.persistido).toEqual(balance);
    expect(resultado.persistencia.trasCorte).toEqual(balance);
    const balanceAnd4 = { ...balance, totalActivoMinor: '200.00', totalPatrimonioMinor: '200.00' };
    for (const clave of ['persistido','trasAlterado','trasFuturo','trasCorte','trasFallo','trasMigracion']) expect(resultado.persistencia.traspaso[clave]).toEqual(balanceAnd4);
    expect(resultado.persistencia.traspaso.fallo.balance).toEqual(balanceAnd4);
    expect(resultado.persistencia.traspaso.fallo.errorImportacion).toMatch(/Se recuperó la base anterior/);
    expect(resultado.persistencia.traspaso.errorMigracion).toMatch(/Se recuperó la base anterior a la migración/);
    expect(resultado.persistencia.traspaso.migracion).toEqual({ huella: resultado.persistencia.traspaso.huellaPrevia, copia: resultado.persistencia.traspaso.huellaPrevia, ausente: true });
    expect(resultado.persistencia.traspaso.errores).toHaveLength(3);
    expect(resultado.persistencia.traspaso.errores[0]).toMatch(/alterada/);
    expect(resultado.persistencia.traspaso.errores[1]).toMatch(/Actualiza la app/);
    expect(resultado.persistencia.traspaso.errores[2]).toMatch(/se recuperó la base anterior/);
    expect(resultado.persistencia.traspaso.nombre).toMatch(/\.arkon$/);
    for (const nombre of ['/retorno.arkon','/recuperado.arkon']) {
      expect(paquetes.has(nombre)).toBe(true);
      await importarTraspaso(pc,paquetes.get(nombre)!);
      expect(estadoTraspaso(pc)).toEqual(esperado);
    }
    expect(resultado.persistencia.contrapartes).toEqual([]);
    // Mensaje exacto de cada rechazo: si se quita «respaldo:» del filtro de motorAndroid.ts, esta línea falla.
    expect(resultado.persistencia.rechazos).toEqual([
      'Android solo admite el ámbito administrativo',
      'Esta función no está disponible aún en Android (solo ámbito administrativo)',
      'Comando desconocido: toString',
      'PDF, archivos y diálogos de Electron no disponibles aún en Android'
    ]);
    expect(resultado.persistencia.aislado).toBe(false);
    expect(resultado.pantallas).toEqual([
      { ancho: 360, plegable: true, abierto: true, cerrado: true, pagina: true, scrollTabla: true },
      { ancho: 800, plegable: false, abierto: true, cerrado: false, pagina: true, scrollTabla: true }
    ]);
    // Todas las secciones a 360 y 800 px: sin desbordamiento de página, sin elementos fuera de pantalla (salvo dentro de tablas) ni controles <44 px.
    expect(resultado.secciones.length).toBeGreaterThan(0);
    const anchos = [...new Set(resultado.secciones.map((s: { ancho: number }) => s.ancho))].sort((a: number, b: number) => a - b);
    expect(anchos).toEqual([360, 800]);
    for (const entrada of resultado.secciones as Array<{ ancho: number; seccion: string; pagina: boolean; sinFuera: boolean; controles44: boolean; fuera: string[]; controlesBajos: string[] }>) {
      expect(entrada.pagina, `${entrada.ancho}px ${entrada.seccion}`).toBe(true);
      expect(entrada.sinFuera, `${entrada.ancho}px ${entrada.seccion}: ${entrada.fuera.join(' | ')}`).toBe(true);
      expect(entrada.controles44, `${entrada.ancho}px ${entrada.seccion}: controles bajos ${entrada.controlesBajos.join(' | ')}`).toBe(true);
    }
    // Cabecera de teléfono (360 px): logo visible, botón con aria-label, velo que cierra y Debe/Haber en la misma fila.
    expect(resultado.cabecera.logoVisible).toBe(true);
    expect(['Abrir menú', 'Cerrar menú']).toContain(resultado.cabecera.ariaLabel);
    expect(resultado.cabecera.veloCierra).toBe(true);
    expect(resultado.cabecera.mismaFila).toBe(true);
    // Privacidad del APK: sin copia automática de Google y sin permiso de red.
    const manifiesto = fs.readFileSync(path.resolve('movil/android/app/src/main/AndroidManifest.xml'), 'utf8');
    expect(manifiesto).toContain('android:allowBackup="false"');
    expect(manifiesto).not.toContain('android.permission.INTERNET');
  } finally {
    proceso?.kill();
    if (pc?.db.open) pc.db.close();
    await new Promise<void>(resolve => servidor.close(() => resolve()));
    fs.rmSync(temporal, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
}, 180000);
