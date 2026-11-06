import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { limpiarMensajeError } from '../src/renderer/limpiarMensajeError';

describe('auditoría 59 (AMP-1): limpieza de nombres técnicos en mensajes de error', () => {
  const prefijos = [
    'ErrorContable', 'ErrorOperacion', 'ErrorTesoreria', 'ErrorValidacion', 'ErrorCierre',
    'ErrorAdjunto', 'ErrorRespaldo', 'ErrorCotizacion', 'ErrorPaquete', 'ErrorFiscal',
    'ErrorAnexo', 'ErrorF14', 'ErrorCatalogo', 'ErrorEjercicio', 'ErrorRecuperacionPendiente', 'Error'
  ];

  it('tabla: quita un único prefijo técnico tras el prefijo IPC', () => {
    for (const prefijo of prefijos) {
      const mensaje = 'El ejercicio 2026 está cerrado; reábrelo con motivo auditado antes de anular';
      expect(limpiarMensajeError(`Error invoking remote method 'arkon': ${prefijo}: ${mensaje}`)).toBe(mensaje);
      expect(limpiarMensajeError(new Error(`${prefijo}: ${mensaje}`))).toBe(mensaje);
    }
  });

  it('conserva mensajes que no son prefijos técnicos (encabezados propios)', () => {
    expect(limpiarMensajeError('Error al cerrar el ejercicio: detalle sintético')).toBe('Error al cerrar el ejercicio: detalle sintético');
    expect(limpiarMensajeError('La anulación exige un motivo significativo (mínimo 10 caracteres).')).toBe('La anulación exige un motivo significativo (mínimo 10 caracteres).');
  });

  it('no encadena limpiezas: solo el primer prefijo técnico', () => {
    expect(limpiarMensajeError('ErrorContable: ErrorValidacion: campo')).toBe('ErrorValidacion: campo');
  });

  it('guarda de suite: ninguna vista lee err.message directamente para mostrarlo', () => {
    const vistas = fs.readdirSync(path.resolve(__dirname, '../src/renderer/vistas')).filter(f => f.endsWith('.tsx'));
    expect(vistas.length).toBeGreaterThan(0);
    for (const vista of vistas) {
      const contenido = fs.readFileSync(path.resolve(__dirname, '../src/renderer/vistas', vista), 'utf8');
      expect(contenido, `${vista} debe usar limpiarMensajeError, no lecturas directas de err.message`).not.toMatch(/err instanceof Error|err\.message/);
    }
  });
});
