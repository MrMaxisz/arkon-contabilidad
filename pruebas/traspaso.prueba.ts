import { expect, it } from 'vitest';
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import fs from 'node:fs';
import path from 'node:path';
import { crearPlataformaMemoria } from '../src/plataforma/memoria';
import { crearPlataformaEscritorio } from '../src/plataforma/escritorio';
import { crearContextoBase } from '../src/main/servicios/restauracion';
import { exportarTraspaso, importarTraspaso } from '../src/main/servicios/traspaso';
import { sha256 } from '../src/shared/sha256';
import { sembrarTraspaso, estadoTraspaso } from './traspasoSintetico';
import { crearPaqueteTraspaso, leerPaqueteTraspaso } from '../src/shared/paqueteTraspaso';

it('AND4: PC → WASM → PC, saldos, partidas, numeración, inventario, adjunto y entero grande idénticos', async () => {
  const dir = fs.mkdtempSync(path.resolve('.and4-'));
  const pc = crearPlataformaEscritorio(), wasm = crearPlataformaMemoria(await sqlite3InitModule(), sha256);
  const rutas = pc.prepararRutasDatos(dir), rutasWasm = wasm.prepararRutasDatos('/android');
  const origen = await crearContextoBase(rutas, path.join(rutas.datos,'arkon.db'), 'and4',pc);
  const android = await crearContextoBase(rutasWasm, '/android/datos/arkon.db','and4',wasm);
  try {
    sembrarTraspaso(origen);
    const esperado = estadoTraspaso(origen);
    expect(esperado.balance).toEqual({ totalActivoMinor: '200.00', totalPasivoMinor: '0.00', totalPatrimonioMinor: '200.00', totalResultadoMinor: '0.00', cuadra: true });
    expect(esperado.enteros).toEqual([{ importe: 9007199254740993n }]);
    const paquete = await exportarTraspaso(origen);
    await importarTraspaso(android,paquete.bytes);
    expect(estadoTraspaso(android)).toEqual(esperado);
    const vuelta = await exportarTraspaso(android);
    await importarTraspaso(origen,vuelta.bytes);
    origen.reabrirBase();
    expect(estadoTraspaso(origen)).toEqual(esperado);
    expect(pc.archivos.existsSync(`${origen.rutaDb}.antes-restauracion`)).toBe(true);
    // Recalcular el hash del contenedor no permite saltarse el manifiesto existente.
    const entradas = leerPaqueteTraspaso(vuelta.bytes);
    const manifest = entradas.find(e => e.ruta.endsWith('.manifest.json'))!;
    const m = JSON.parse(new TextDecoder().decode(manifest.datos)); m.hashSha256 = '0'.repeat(64);
    manifest.datos = new TextEncoder().encode(JSON.stringify(m));
    await expect(importarTraspaso(origen,crearPaqueteTraspaso(entradas))).rejects.toThrow(/manifiesto/);
    expect(estadoTraspaso(origen)).toEqual(esperado);
  } finally {
    if (origen.db.open) origen.db.close(); if (android.db.open) android.db.close();
    fs.rmSync(dir,{ recursive:true,force:true });
  }
});
