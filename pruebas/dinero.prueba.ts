import { describe, expect, it } from 'vitest';
import {
  parseMontoMinor,
  minorATexto,
  parseTasa,
  desglosarIvaIncluido,
  desglosarIvaSeparado,
  ivaDesdeBase
} from '../src/shared/dinero';

describe('parseo y formato de dinero exacto', () => {
  it('convierte texto a unidades mínimas sin aritmética binaria', () => {
    expect(parseMontoMinor('123.45')).toBe(12345n);
    expect(parseMontoMinor('0.10')).toBe(10n);
    expect(parseMontoMinor('100')).toBe(10000n);
    expect(minorATexto(12345n)).toBe('123.45');
  });

  it('rechaza montos inválidos o con exceso de decimales', () => {
    expect(() => parseMontoMinor('abc')).toThrow();
    expect(() => parseMontoMinor('10.123')).toThrow();
    expect(() => parseMontoMinor('-5')).toThrow();
  });

  it('evita el error clásico de punto flotante', () => {
    expect(parseMontoMinor('0.1') + parseMontoMinor('0.2')).toBe(30n);
  });
});

describe('desglose de IVA', () => {
  it('IVA incluido: base + IVA reconcilian exactamente con el total sin aumentarlo', () => {
    const tasa = parseTasa('13');
    const total = parseMontoMinor('113.00');
    const d = desglosarIvaIncluido(total, tasa);
    expect(d.base + d.iva).toBe(total);
    expect(d.base).toBe(parseMontoMinor('100.00'));
    expect(d.iva).toBe(parseMontoMinor('13.00'));
  });

  it('IVA incluido con redondeo determinista: el impuesto es total menos base', () => {
    const tasa = parseTasa('13');
    const total = parseMontoMinor('1.00');
    const d = desglosarIvaIncluido(total, tasa);
    expect(d.base + d.iva).toBe(total);
    expect(d.base).toBe(88n);
    expect(d.iva).toBe(12n);
  });

  it('IVA separado: aplica el impuesto una sola vez sobre la base', () => {
    const tasa = parseTasa('13');
    const base = parseMontoMinor('230.77');
    const d = desglosarIvaSeparado(base, tasa);
    expect(d.total).toBe(base + ivaDesdeBase(base, tasa));
    expect(d.iva).toBe(parseMontoMinor('30.00'));
    expect(d.total).toBe(parseMontoMinor('260.77'));
  });

  it('tasa cero y tasas con decimales se representan exactamente', () => {
    expect(ivaDesdeBase(10000n, parseTasa('0'))).toBe(0n);
    expect(ivaDesdeBase(10000n, parseTasa('10.5'))).toBe(1050n);
  });
});
