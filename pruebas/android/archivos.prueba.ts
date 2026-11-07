import { expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { crearPuenteAndroid } from '../../src/plataforma/puenteAndroid';
import { aBase64, TAMANO_TROZO, type ArkonArchivos } from '../../src/plataforma/archivosAndroid';
import { construirHtmlReporte } from '../../src/main/servicios/reportesPdf';
import { nombreTraspaso } from '../../src/shared/nombreTraspaso';
import { formatearFechaHoraElSalvador } from '../../src/shared/fechas';
import { debeMostrarRecordatorioRespaldo } from '../../src/shared/recordatorioRespaldo';
import Database from 'better-sqlite3';
import { aplicarMigraciones } from '../../src/main/db/aplicarMigraciones';
import { sembrarCatalogoBase } from '../../src/main/servicios/cuentas';
import { crearContraparte, registrarVenta } from '../../src/main/servicios/operacion';
import { generarCsvLibro } from '../../src/main/servicios/fiscal';
import { crearCotizacion, generarHtmlCotizacion, listarCotizaciones } from '../../src/main/servicios/cotizaciones';
import { vestirHtmlCotizacion } from '../../src/main/servicios/reportesPdf';

function preparar(bytes = new Uint8Array([1, 2, 3])) {
  let offset = 0;
  const comandos: Array<{ comando: string; datos: any }> = [];
  const base = { saldo: '200.00', exportacion: '' };
  const worker = {
    onmessage: null as any, onerror: null as any, onmessageerror: null as any,
    postMessage(p: { id: number; comando: string; datos: any }) {
      comandos.push(p);
      queueMicrotask(() => {
        let resultado: unknown;
        if (p.comando === 'traspaso:exportar') resultado = { bytes, nombre: 'ARKON-2026-11-07.arkon' };
        if (p.comando === 'traspaso:inspeccionar') resultado = { fecha: '2026-11-07T20:30:00.000Z', saldos: 'Activo: 200.00; Pasivo: 0.00; Patrimonio: 200.00; Resultado: 0.00 USD' };
        if (p.comando === 'traspaso:registrarExportacion') base.exportacion = p.datos.nombre;
        if (p.comando === 'traspaso:importar') { base.saldo = 'reemplazado'; resultado = { detalle: 'Importado' }; }
        if (p.comando === 'android:csvAuxiliar' || p.comando === 'android:csvLibro') resultado = { csv: 'saldo\n200.00', version: 'prueba' };
        worker.onmessage({ data: { id: p.id, resultado } });
      });
    }
  };
  const plugin: ArkonArchivos = {
    guardar: vi.fn(async () => ({ estado: 'listo' })), abrir: vi.fn(async () => ({ estado: 'listo' })),
    escribirTrozo: vi.fn(async (datos: { base64: string }) => {
      if (Buffer.from(datos.base64, 'base64').length > 1024 * 1024) throw new Error('Trozo mayor que 1 MB');
    }),
    leerTrozo: vi.fn(async () => {
      const trozo = bytes.subarray(offset, offset + TAMANO_TROZO); offset += trozo.length;
      return { base64: aBase64(trozo), fin: trozo.length < TAMANO_TROZO };
    }),
    cerrar: vi.fn(async () => undefined), imprimir: vi.fn(async () => ({ estado: 'impresion' }))
  };
  const confirmar = vi.fn((_mensaje: string) => true);
  const recursos = { logoSvg: '<svg></svg>', fuentesCss: '/* fuentes locales */' };
  const api = crearPuenteAndroid(worker as unknown as Worker, { plugin: () => plugin, confirmar, recursosPdf: async () => recursos });
  return { api, plugin, comandos, base, confirmar, recursos, worker };
}

it('AND5: guarda por trozos de 1 MB y registra fecha/nombre solo después del cierre', async () => {
  const bytes = new Uint8Array(TAMANO_TROZO * 2 + 17); bytes[0] = 255; bytes[bytes.length - 1] = 127;
  const p = preparar(bytes);
  await expect(p.api.invocar('traspaso:exportar')).resolves.toMatchObject({ guardado: true });
  const trozos = vi.mocked(p.plugin.escribirTrozo).mock.calls.map(([r]) => Buffer.from(r.base64, 'base64'));
  expect(trozos.map(b => b.length)).toEqual([TAMANO_TROZO, TAMANO_TROZO, 17]);
  expect(Buffer.compare(Buffer.concat(trozos), Buffer.from(bytes))).toBe(0);
  expect(p.plugin.guardar).toHaveBeenCalledWith({ nombre: 'ARKON-2026-11-07.arkon', mime: 'application/octet-stream' });
  expect(p.base).toEqual({ saldo: '200.00', exportacion: 'ARKON-2026-11-07.arkon' });
  expect(nombreTraspaso(new Date('2026-11-07T12:00:00Z'))).toBe('ARKON-2026-11-07.arkon');
  // AND5C: de noche en El Salvador (UTC-6) el nombre usa la fecha local, no la UTC.
  expect(nombreTraspaso(new Date('2026-11-07T03:00:00Z'))).toBe('ARKON-2026-11-06.arkon');
  expect(nombreTraspaso(new Date('2026-11-07T05:59:00Z'))).toBe('ARKON-2026-11-06.arkon');
  expect(nombreTraspaso(new Date('2026-11-07T06:00:00Z'))).toBe('ARKON-2026-11-07.arkon');
});

it('AND5: abre por trozos, inspecciona y confirma fecha y saldos antes de importar', async () => {
  const bytes = new Uint8Array(TAMANO_TROZO * 2); bytes[bytes.length - 1] = 254;
  const p = preparar(bytes);
  await p.api.invocar('traspaso:importar');
  expect(p.plugin.leerTrozo).toHaveBeenCalledTimes(3); // múltiplo exacto: lectura final vacía
  expect(p.comandos.map(c => c.comando)).toEqual(['traspaso:inspeccionar', 'traspaso:importar']);
  expect(Buffer.compare(Buffer.from(p.comandos[1]!.datos.bytes), Buffer.from(bytes))).toBe(0);
  expect(p.confirmar).toHaveBeenCalledWith(expect.stringContaining('La base del teléfono será reemplazada'));
  expect(p.confirmar.mock.calls[0]![0]).toContain('07/11/2026 14:30');
  expect(p.confirmar.mock.calls[0]![0]).not.toContain('2026-11-07');
  expect(p.confirmar.mock.calls[0]![0]).toContain('Activo: 200.00; Pasivo: 0.00; Patrimonio: 200.00; Resultado: 0.00 USD');
});

it('AND5C: fecha legible en hora de El Salvador, no ISO', () => {
  expect(formatearFechaHoraElSalvador('2026-11-07T20:30:00.000Z')).toBe('07/11/2026 14:30');
  expect(formatearFechaHoraElSalvador(new Date('2026-11-07T03:00:00Z'))).toBe('06/11/2026 21:00');
});

it('AND5C: recordatorio solo con partidas y sin exportación reciente', () => {
  const ahora = new Date('2026-11-14T12:00:00Z');
  expect(debeMostrarRecordatorioRespaldo(0, null, ahora)).toBe(false);
  expect(debeMostrarRecordatorioRespaldo(1, null, ahora)).toBe(true);
  expect(debeMostrarRecordatorioRespaldo(0, '2026-11-01T12:00:00Z', ahora)).toBe(false);
  // 13 días: muestra.
  expect(debeMostrarRecordatorioRespaldo(1, '2026-11-01T12:00:00Z', ahora)).toBe(true);
  // 7 días exactos y 6 días: no muestra.
  expect(debeMostrarRecordatorioRespaldo(1, '2026-11-07T12:00:00Z', ahora)).toBe(false);
  expect(debeMostrarRecordatorioRespaldo(1, '2026-11-08T12:00:00Z', ahora)).toBe(false);
  // Poco más de 7 días: muestra.
  expect(debeMostrarRecordatorioRespaldo(1, '2026-11-07T11:59:59Z', ahora)).toBe(true);
});

it('AND5: cancelar guardar/abrir no es error y no toca la base', async () => {
  const p = preparar();
  vi.mocked(p.plugin.guardar).mockResolvedValue({ estado: 'cancelado' });
  vi.mocked(p.plugin.abrir).mockResolvedValue({ estado: 'cancelado' });
  await expect(p.api.invocar('traspaso:exportar')).resolves.toMatchObject({ estado: 'cancelado' });
  await expect(p.api.invocar('traspaso:importar')).resolves.toMatchObject({ estado: 'cancelado' });
  expect(p.comandos.map(c => c.comando)).toEqual(['traspaso:exportar']);
  expect(p.base).toEqual({ saldo: '200.00', exportacion: '' });
});

it.each(['lectura', 'base64', 'trozo', 'sin progreso', 'cierre', 'confirmacion', 'inspeccion'])('AND5: falla %s sin enviar importación ni modificar la base', async fallo => {
  const p = preparar();
  if (fallo === 'lectura') vi.mocked(p.plugin.leerTrozo).mockRejectedValue(new Error('Error de lectura'));
  if (fallo === 'base64') vi.mocked(p.plugin.leerTrozo).mockResolvedValue({ base64: '!!', fin: true });
  if (fallo === 'trozo') vi.mocked(p.plugin.leerTrozo).mockResolvedValue({ base64: aBase64(new Uint8Array(TAMANO_TROZO + 1)), fin: true });
  if (fallo === 'sin progreso') vi.mocked(p.plugin.leerTrozo).mockResolvedValue({ base64: '', fin: false });
  if (fallo === 'cierre') vi.mocked(p.plugin.cerrar).mockRejectedValue(new Error('Error de cierre'));
  if (fallo === 'confirmacion') p.confirmar.mockReturnValue(false);
  if (fallo === 'inspeccion') {
    p.worker.postMessage = solicitud => queueMicrotask(() => p.worker.onmessage({ data: { id: solicitud.id, error: 'Paquete inválido' } }));
  }
  if (fallo === 'confirmacion') await expect(p.api.invocar('traspaso:importar')).resolves.toMatchObject({ estado: 'cancelado' });
  else await expect(p.api.invocar('traspaso:importar')).rejects.toThrow();
  expect(p.comandos.some(c => c.comando === 'traspaso:importar')).toBe(false);
  expect(p.base).toEqual({ saldo: '200.00', exportacion: '' });
  expect(p.plugin.cerrar).toHaveBeenCalled();
});

it.each(['escritura', 'cierre'])('AND5: error de %s no registra exportación ni cambia la base', async fallo => {
  const p = preparar();
  vi.mocked(fallo === 'escritura' ? p.plugin.escribirTrozo : p.plugin.cerrar).mockRejectedValue(new Error(fallo));
  await expect(p.api.invocar('traspaso:exportar')).rejects.toThrow(fallo);
  expect(p.base).toEqual({ saldo: '200.00', exportacion: '' });
  expect(p.comandos.map(c => c.comando)).toEqual(['traspaso:exportar']);
  // AND5C: al fallar la escritura el archivo incompleto se descarta.
  if (fallo === 'escritura') expect(p.plugin.cerrar).toHaveBeenCalledWith({ descartar: true });
});

it('AND5: PDF usa exactamente el HTML de escritorio, con importes de pantalla y recursos embebidos', async () => {
  const p = preparar();
  const raiz = path.resolve('src/renderer/recursos');
  p.recursos.logoSvg = fs.readFileSync(path.join(raiz, 'arkon-logo-azul.svg'), 'utf8');
  p.recursos.fuentesCss = [
    ['barlow-condensed-latin-700-normal.woff2', 'Barlow Condensed', '700'],
    ['ibm-plex-sans-latin-400-normal.woff2', 'IBM Plex Sans', '400'],
    ['ibm-plex-sans-latin-600-normal.woff2', 'IBM Plex Sans', '600'],
    ['ibm-plex-mono-latin-400-normal.woff2', 'IBM Plex Mono', '400']
  ].map(([archivo, familia, peso]) => `@font-face { font-family: '${familia}'; font-style: normal; font-weight: ${peso}; src: url(data:font/woff2;base64,${fs.readFileSync(path.join(raiz, 'fuentes', archivo!)).toString('base64')}) format('woff2'); }`).join('\n');
  const solicitud = { titulo: 'Balance <sintético>', tablas: [{ encabezados: ['Cuenta', 'Saldo'], filas: [['Caja', '$200.00']], total: ['Total', '$200.00'] }] };
  await p.api.reportePdf(solicitud);
  const html = vi.mocked(p.plugin.imprimir).mock.calls[0]![0].html;
  expect(html).toBe(construirHtmlReporte(solicitud, p.recursos.logoSvg, p.recursos.fuentesCss));
  expect(html).toContain('$200.00'); expect(html).toContain('data:font/woff2;base64,');
  expect(html).toContain(p.recursos.logoSvg);
  expect(html).not.toMatch(/url\(https?:/);
});

it('AND5: CSV de libros y auxiliares se guarda por el plugin', async () => {
  const p = preparar();
  await p.api.guardarCsv('compra', '2026-11');
  await p.api.guardarCsvAuxiliar({ tipo: 'cliente', alcance: 'detalle', contraparteId: 1 });
  expect(p.comandos.map(c => c.comando)).toEqual(['android:csvLibro', 'android:csvAuxiliar']);
  expect(vi.mocked(p.plugin.escribirTrozo).mock.calls.map(([r]) => Buffer.from(r.base64, 'base64').toString())).toEqual(['saldo\n200.00\n', 'saldo\n200.00\n']);
  expect(p.base).toEqual({ saldo: '200.00', exportacion: '' });
});

it('AND5: cotización usa el mismo generador de escritorio y conserva menores grandes exactos como pantalla', async () => {
  const db = new Database(':memory:');
  try {
    aplicarMigraciones(db);
    const cliente = Number(db.prepare("INSERT INTO contraparte (nombre, es_cliente) VALUES ('Cliente sintético AND5', 1)").run().lastInsertRowid);
    const cotizacion = crearCotizacion(db, { contraparteId: cliente, fecha: '2026-11-07', responsable: 'prueba', lineas: [
      { tipo: 'servicio', descripcion: 'Sintético', cantidad: '1', precioUnitario: '90071992547409.93', precioConIva: false, tasa: '0' }
    ] });
    const p = preparar();
    const htmlEscritorio = generarHtmlCotizacion(db, cotizacion.id);
    p.worker.postMessage = solicitud => {
      p.comandos.push(solicitud);
      queueMicrotask(() => p.worker.onmessage({ data: { id: solicitud.id, resultado: { html: htmlEscritorio } } }));
    };
    await p.api.pdfCotizacion(cotizacion.id);
    expect(p.comandos.map(c => c.comando)).toEqual(['cotizacion:html']);
    const html = vi.mocked(p.plugin.imprimir).mock.calls[0]![0].html;
    expect(html).toBe(vestirHtmlCotizacion(htmlEscritorio, p.recursos.logoSvg, p.recursos.fuentesCss));
    expect(listarCotizaciones(db)[0]!.totalMinor).toBe('90071992547409.93');
    expect(html).toContain('90071992547409.93');
    expect(html).not.toContain('90071992547409.92');
  } finally { db.close(); }
});

it('AND5C: CSV de libro conserva exacto 90071992547409.93', () => {
  const db = new Database(':memory:');
  try {
    aplicarMigraciones(db);
    db.prepare("INSERT INTO ambito (id, nombre, tipo) VALUES ('administrativo', 'Prueba AND5C', 'administrativo')").run();
    sembrarCatalogoBase(db, 'prueba');
    const cliente = crearContraparte(db, { nombre: 'Cliente sintético AND5C', esCliente: true, esProveedor: false, responsable: 'prueba' });
    registrarVenta(db, {
      contraparteId: cliente,
      fechaOperacion: '2026-11-07',
      concepto: 'Venta sintética AND5C',
      tipoIngreso: 'instalaciones',
      base: '90071992547409.93',
      tasa: '0',
      clasificacionDocumento: 'contribuyente',
      tipoDocumento: 'factura',
      claveIdempotencia: 'AND5C-grande',
      responsable: 'prueba'
    });
    // 90071992547409.93 = 9007199254740993 centavos > Number.MAX_SAFE_INTEGER: sin safeIntegers saldría ...92.
    const csv = generarCsvLibro(db, 'venta', '2026-11');
    expect(csv.csv).toContain('V-000001,2026-11-07,contribuyente,factura,90071992547409.93,0.00,90071992547409.93');
    expect(csv.csv).not.toContain('90071992547409.92');
  } finally { db.close(); }
});
