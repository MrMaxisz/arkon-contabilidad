import { expect, it } from 'vitest';
import { build } from 'vite';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import electron from 'electron';

it('AND3: build sin Node/Electron, OPFS real sin aislamiento, reinicio, corte y anchuras 360/800', async () => {
  const temporal = fs.mkdtempSync(path.resolve('dist/and3-'));
  const www = path.join(temporal, 'www');
  let proceso: ReturnType<typeof spawn> | undefined;
  const servidor = createServer((req, res) => {
    const archivo = path.join(www, decodeURIComponent(new URL(req.url!, 'http://localhost').pathname));
    if (!archivo.startsWith(www + path.sep) || !fs.existsSync(archivo)) { res.writeHead(404).end(); return; }
    const mime: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm', '.css': 'text/css', '.svg': 'image/svg+xml' };
    res.setHeader('Content-Type', mime[path.extname(archivo)] ?? 'application/octet-stream');
    res.end(fs.readFileSync(archivo));
  });
  try {
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
    expect(resultado.persistencia.contrapartes).toEqual([]);
    expect(resultado.persistencia.rechazos).toHaveLength(4);
    expect(resultado.persistencia.aislado).toBe(false);
    expect(resultado.pantallas).toEqual([
      { ancho: 360, plegable: true, abierto: true, cerrado: true, pagina: true, scrollTabla: true },
      { ancho: 800, plegable: false, abierto: true, cerrado: false, pagina: true, scrollTabla: true }
    ]);
  } finally {
    proceso?.kill();
    await new Promise<void>(resolve => servidor.close(() => resolve()));
    fs.rmSync(temporal, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
}, 90000);
