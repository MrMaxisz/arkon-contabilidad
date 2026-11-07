import { expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { crearPaqueteTraspaso, leerPaqueteTraspaso } from '../src/shared/paqueteTraspaso';
import { sha256 } from '../src/shared/sha256';

const datos = new TextEncoder().encode('Adjunto sintético AND4 áé\0');
const paquete = () => crearPaqueteTraspaso([{ ruta: 'base.db', datos }, { ruta: 'adjuntos/a.bin', datos: new Uint8Array([0,255,1]) }]);
function indice(rutas: string[]) {
  const json = new TextEncoder().encode(JSON.stringify(rutas.map(ruta => ({ ruta, tamano: 0, sha256: sha256(new Uint8Array()) }))));
  const p = paquete().slice(0,16);
  new DataView(p.buffer).setUint32(12,json.length);
  const bytes = new Uint8Array(16 + json.length); bytes.set(p); bytes.set(json,16); return bytes;
}
it('AND4: SHA-256 coincide con vectores y Node, incluidos bloques y padding', () => {
  expect(sha256(new TextEncoder().encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  for (const n of [0,1,55,56,63,64,65,128,10000]) {
    const bytes = Uint8Array.from({ length: n }, (_,i) => i % 251);
    expect(sha256(bytes)).toBe(createHash('sha256').update(bytes).digest('hex'));
  }
});
it('AND4: ida y vuelta binaria y vista con offset', () => {
  const original = paquete(); const vista = new Uint8Array(original.length + 10); vista.set(original,5);
  expect(leerPaqueteTraspaso(vista.subarray(5,-5))).toEqual([{ ruta: 'base.db', datos }, { ruta: 'adjuntos/a.bin', datos: new Uint8Array([0,255,1]) }]);
});
it('AND4: rechaza firma y versión ajenas, truncados, alteración y bytes sobrantes', () => {
  const p = paquete(); const firma = p.slice(); firma[0] ^= 1;
  expect(() => leerPaqueteTraspaso(firma)).toThrow(/Firma/);
  const version = p.slice(); new DataView(version.buffer).setUint32(8,2);
  expect(() => leerPaqueteTraspaso(version)).toThrow(/Versión/);
  for (const n of [0,8,15,16,p.length-1]) expect(() => leerPaqueteTraspaso(p.slice(0,n))).toThrow();
  const alterado = p.slice(); alterado[alterado.length-1] ^= 1;
  expect(() => leerPaqueteTraspaso(alterado)).toThrow(/alterada/);
  const extra = new Uint8Array(p.length+1); extra.set(p);
  expect(() => leerPaqueteTraspaso(extra)).toThrow(/sobrante/);
});
it('AND4: rechaza rutas absolutas, traversal, alias y duplicados al leer y escribir', () => {
  for (const ruta of ['/a','C:/a','../a','a/../b','a\\b','//servidor/a','a/./b','a//b','a.','a\0b']) {
    expect(() => leerPaqueteTraspaso(indice([ruta]))).toThrow(/Ruta/);
    expect(() => crearPaqueteTraspaso([{ ruta, datos }])).toThrow(/Ruta/);
  }
  expect(() => leerPaqueteTraspaso(indice(['a','a']))).toThrow(/duplicadas/);
  expect(() => crearPaqueteTraspaso([{ ruta: 'a', datos }, { ruta: 'A', datos }])).toThrow(/duplicadas/);
});
