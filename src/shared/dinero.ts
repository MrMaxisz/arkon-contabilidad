export type EnteroMinor = bigint;

export const DECIMALES_MONEDA = 2;
export const ESCALA: bigint = 100n;

export class ErrorDinero extends Error {}

export function parseMontoMinor(texto: string, decimales = DECIMALES_MONEDA): EnteroMinor {
  const limpio = texto.trim().replace(/,/g, '').replace(/^\$/, '');
  if (!/^\d+(\.\d+)?$/.test(limpio)) {
    throw new ErrorDinero(`Monto inválido: ${texto}`);
  }
  const [entero, frac = ''] = limpio.split('.');
  if (frac.length > decimales) {
    throw new ErrorDinero(`Monto con más de ${decimales} decimales: ${texto}`);
  }
  const fracPadded = frac.padEnd(decimales, '0');
  return BigInt(entero + fracPadded);
}

export function minorATexto(minor: EnteroMinor, decimales = DECIMALES_MONEDA): string {
  const escala = 10n ** BigInt(decimales);
  if (minor < 0n) {
    return `-${minorATexto(-minor, decimales)}`;
  }
  const entero = minor / escala;
  const frac = (minor % escala).toString().padStart(decimales, '0');
  return decimales > 0 ? `${entero}.${frac}` : entero.toString();
}

export function redondearDivision(numerador: bigint, denominador: bigint): bigint {
  if (denominador === 0n) {
    throw new ErrorDinero('División por cero');
  }
  if (numerador < 0n || denominador < 0n) {
    throw new ErrorDinero('Valores negativos no soportados');
  }
  const cociente = numerador / denominador;
  const residuo = numerador % denominador;
  if (residuo * 2n >= denominador) {
    return cociente + 1n;
  }
  return cociente;
}

export type Tasa = { puntosBase: bigint };

export function parseTasa(texto: string): Tasa {
  const limpio = texto.trim().replace('%', '');
  if (!/^\d+(\.\d+)?$/.test(limpio)) {
    throw new ErrorDinero(`Tasa inválida: ${texto}`);
  }
  const [entero, frac = ''] = limpio.split('.');
  if (frac.length > 2) {
    throw new ErrorDinero('Tasa con más de 2 decimales');
  }
  const fracPadded = frac.padEnd(2, '0');
  return { puntosBase: BigInt(entero + fracPadded) };
}

export function ivaDesdeBase(base: EnteroMinor, tasa: Tasa): EnteroMinor {
  return redondearDivision(base * tasa.puntosBase, 10000n);
}

export function baseDesdeTotalIncluido(totalIncluido: EnteroMinor, tasa: Tasa): EnteroMinor {
  return redondearDivision(totalIncluido * 10000n, 10000n + tasa.puntosBase);
}

export interface DesgloseIva {
  base: EnteroMinor;
  iva: EnteroMinor;
  total: EnteroMinor;
}

export function desglosarIvaIncluido(totalIncluido: EnteroMinor, tasa: Tasa): DesgloseIva {
  const base = baseDesdeTotalIncluido(totalIncluido, tasa);
  const iva = totalIncluido - base;
  return { base, iva, total: totalIncluido };
}

export function desglosarIvaSeparado(base: EnteroMinor, tasa: Tasa): DesgloseIva {
  const iva = ivaDesdeBase(base, tasa);
  return { base, iva, total: base + iva };
}
