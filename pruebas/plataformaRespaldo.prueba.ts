import { describe, expect, it } from 'vitest';
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { crearPlataformaMemoria } from '../src/plataforma/memoria';
import { crearPlataformaEscritorio } from '../src/plataforma/escritorio';
import type { BaseDatos, Plataforma } from '../src/plataforma/plataforma';
import { crearRespaldo, descubrirRespaldos, leerVersionEsquema } from '../src/main/servicios/respaldo';
import { crearContextoBase, manejarRestauracion, respaldoPeriodicoSiCorresponde } from '../src/main/servicios/restauracion';
import { versionEsquemaActual } from '../src/main/db/aplicarMigraciones';
import { sembrarCatalogoBase } from '../src/main/servicios/cuentas';
import { contabilizarAsiento } from '../src/main/servicios/motorAsientos';
import { balanceResumen } from '../src/main/servicios/estadosFinancieros';

const sqlite = await sqlite3InitModule();
const sha256 = (datos: Uint8Array) => crypto.createHash('sha256').update(datos).digest('hex');
const memoria = () => crearPlataformaMemoria(sqlite, sha256);
const escritorio = crearPlataformaEscritorio();

function aporte(db: BaseDatos, importe: string) {
  const cuenta = (codigo: string) => (db.prepare('SELECT id FROM cuenta WHERE codigo = ?').get(codigo) as { id: number }).id;
  contabilizarAsiento(db, {
    fechaOperacion: '2026-02-01', concepto: 'Aporte sintético AND2', responsable: 'prueba', ambitoId: 'administrativo',
    lineas: [
      { cuentaId: cuenta('1101'), debeMinor: importe, haberMinor: '' },
      { cuentaId: cuenta('3101'), debeMinor: '', haberMinor: importe }
    ]
  });
}

function sembrar(db: BaseDatos) {
  sembrarCatalogoBase(db, 'prueba');
  db.prepare("INSERT INTO ambito (id, nombre, tipo) VALUES ('administrativo', 'Sintético AND2', 'administrativo')").run();
  aporte(db, '123.45');
  aporte(db, '76.55');
  db.exec('CREATE TABLE entero_sintetico (importe INTEGER)');
  db.prepare('INSERT INTO entero_sintetico VALUES (?)').run(9007199254740993n);
}

function cifras(db: BaseDatos) {
  // 12345 + 7655 = 20000 menores: activo y patrimonio 200.00, sin resultado.
  expect(balanceResumen(db)).toEqual({
    totalActivoMinor: '200.00', totalPasivoMinor: '0.00', totalPatrimonioMinor: '200.00', totalResultadoMinor: '0.00', cuadra: true
  });
  expect(db.prepare('SELECT COUNT(*) AS n FROM asiento').get()).toEqual({ n: 2 });
  expect(db.prepare('SELECT importe FROM entero_sintetico').safeIntegers().get()).toEqual({ importe: 9007199254740993n });
}

describe('AND2: respaldo SQLite único intercambiable entre PC y teléfono', () => {
  for (const [origenNombre, destinoNombre] of [['WASM', 'WASM'], ['WASM', 'PC'], ['PC', 'WASM']] as const) {
    it(`${origenNombre} → ${destinoNombre}: restaura cifras, hash, manifiesto y esquema`, async () => {
      const dir = fs.mkdtempSync(path.join(process.cwd(), '.and2-'));
      const origen: Plataforma = origenNombre === 'PC' ? escritorio : memoria();
      const destino: Plataforma = destinoNombre === 'PC' ? escritorio : memoria();
      const rutasOrigen = origen.prepararRutasDatos(origenNombre === 'PC' ? path.join(dir, 'origen') : '/origen');
      const rutasDestino = destino.prepararRutasDatos(destinoNombre === 'PC' ? path.join(dir, 'destino') : '/destino');
      const ctxOrigen = await crearContextoBase(rutasOrigen, origen.rutas.join(rutasOrigen.datos, 'arkon.db'), 'and2', origen);
      const ctxDestino = await crearContextoBase(rutasDestino, destino.rutas.join(rutasDestino.datos, 'arkon.db'), 'and2', destino);
      try {
        sembrar(ctxOrigen.db);
        const info = await crearRespaldo(ctxOrigen.db, rutasOrigen.respaldos, 'and2', rutasOrigen.adjuntos, origen);
        const rutaOrigen = origen.rutas.join(rutasOrigen.respaldos, info.nombre);
        const rutaDestino = destino.rutas.join(rutasDestino.respaldos, info.nombre);
        const imagen = origen.archivos.readFileSync(rutaOrigen);
        const manifiesto = origen.archivos.readFileSync(`${rutaOrigen}.manifest.json`, 'utf8');
        expect(new TextDecoder().decode(imagen.slice(0, 16))).toBe('SQLite format 3\0');
        expect(JSON.parse(manifiesto)).toMatchObject({ nombre: info.nombre, hashSha256: sha256(imagen), versionEsquema: versionEsquemaActual(), versionApp: 'and2', adjuntos: [] });
        destino.archivos.writeFileSync(rutaDestino, imagen);
        destino.archivos.writeFileSync(`${rutaDestino}.manifest.json`, manifiesto, 'utf8');
        expect(destino.hashArchivo(rutaDestino)).toBe(info.hashSha256);
        expect(leerVersionEsquema(rutaDestino, destino)).toBe(versionEsquemaActual());
        expect(descubrirRespaldos(rutasDestino.respaldos, destino)).toHaveLength(1);
        // Cambiar el origen después no puede alterar la imagen ya serializada.
        aporte(ctxOrigen.db, '25.00');
        expect(balanceResumen(ctxOrigen.db).totalActivoMinor).toBe('225.00');
        const resultado = await manejarRestauracion(ctxDestino, info.nombre);
        expect(resultado.ok).toBe(true);
        cifras(ctxDestino.db);
        expect(destino.archivos.existsSync(`${ctxDestino.rutaDb}.antes-restauracion`)).toBe(true);
        expect(destino.hashArchivo(rutaDestino)).toBe(info.hashSha256);
        // Persistencia de la simulación: cerrar y abrir conserva los datos restaurados.
        ctxDestino.reabrirBase();
        cifras(ctxDestino.db);
      } finally {
        if (ctxOrigen.db.open) ctxOrigen.db.close();
        if (ctxDestino.db.open) ctxDestino.db.close();
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  }

  it('WASM rechaza hash alterado y esquema futuro sin reemplazar la base activa', async () => {
    const plataforma = memoria();
    const rutas = plataforma.prepararRutasDatos('/rechazo');
    const ctx = await crearContextoBase(rutas, '/rechazo/datos/arkon.db', 'and2', plataforma);
    try {
      sembrar(ctx.db);
      const info = await crearRespaldo(ctx.db, rutas.respaldos, 'and2', rutas.adjuntos, plataforma);
      const ruta = plataforma.rutas.join(rutas.respaldos, info.nombre);
      const original = plataforma.archivos.readFileSync(ruta);
      const alterado = original.slice();
      alterado[100] = alterado[100]! ^ 1;
      plataforma.archivos.writeFileSync(ruta, alterado);
      await expect(manejarRestauracion(ctx, info.nombre)).rejects.toThrow();
      expect(ctx.db.open).toBe(true);
      cifras(ctx.db);
      plataforma.archivos.writeFileSync(ruta, original);
      ctx.db.prepare('INSERT INTO _migracion (version, nombre) VALUES (?, ?)').run(versionEsquemaActual() + 1, 'futura-sintetica');
      const futuro = await crearRespaldo(ctx.db, rutas.respaldos, 'and2', rutas.adjuntos, plataforma);
      await expect(manejarRestauracion(ctx, futuro.nombre)).rejects.toThrow(/superior al soportado/);
      expect(ctx.db.open).toBe(true);
      cifras(ctx.db);
    } finally { ctx.db.close(); }
  });

  it('respaldo periódico WASM conserva la misma imagen y manifiesto', async () => {
    const plataforma = memoria();
    const rutas = plataforma.prepararRutasDatos('/periodico');
    const ctx = await crearContextoBase(rutas, '/periodico/datos/arkon.db', 'and2', plataforma);
    try {
      sembrar(ctx.db);
      ctx.db.prepare("INSERT OR REPLACE INTO configuracion (clave, valor) VALUES ('respaldo_intervalo_minutos', '1')").run();
      const resultado = await respaldoPeriodicoSiCorresponde(ctx);
      expect(resultado.creado).toBe(true);
      const ruta = plataforma.rutas.join(rutas.respaldos, resultado.nombre!);
      const manifiesto = JSON.parse(plataforma.archivos.readFileSync(`${ruta}.manifest.json`, 'utf8'));
      expect(manifiesto.hashSha256).toBe(plataforma.hashArchivo(ruta));
      expect(manifiesto.versionEsquema).toBe(versionEsquemaActual());
      await manejarRestauracion(ctx, resultado.nombre!);
      cifras(ctx.db);
    } finally { if (ctx.db.open) ctx.db.close(); }
  });
});
