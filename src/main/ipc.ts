import { ipcMain } from 'electron';
import { contabilizarAsiento, anularAsiento, listarAsientos, mayorDeCuenta, cerrarPeriodo, reabrirPeriodo } from './servicios/motorAsientos';
import { listarCuentas, crearCuenta } from './servicios/cuentas';
import { balanceResumen, saldosPorCuenta } from './servicios/estadosFinancieros';
import { crearRespaldo, descubrirRespaldos } from './servicios/respaldo';
import { manejarRestauracion, type ContextoApp } from './servicios/restauracion';
import { listarEventos } from './servicios/bitacora';

type Manejador = (ctx: ContextoApp, payload: unknown) => unknown | Promise<unknown>;

class ErrorValidacion extends Error {}

function objeto(payload: unknown): Record<string, unknown> {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new ErrorValidacion('Payload inválido');
  }
  return payload as Record<string, unknown>;
}

function texto(p: Record<string, unknown>, campo: string, requerido = true): string {
  const v = p[campo];
  if (typeof v !== 'string' || (requerido && !v.trim())) {
    throw new ErrorValidacion(`Campo requerido: ${campo}`);
  }
  return v;
}

function entero(p: Record<string, unknown>, campo: string): number {
  const v = p[campo];
  if (!Number.isInteger(v) || (v as number) <= 0) {
    throw new ErrorValidacion(`Campo entero positivo requerido: ${campo}`);
  }
  return v as number;
}

const comandos: Record<string, Manejador> = {
  'asiento:contabilizar': (ctx, payload) => {
    const p = objeto(payload);
    return contabilizarAsiento(ctx.db, {
      fechaOperacion: texto(p, 'fechaOperacion'),
      concepto: texto(p, 'concepto'),
      lineas: p.lineas as never,
      origenTipo: p.origenTipo ? String(p.origenTipo) : undefined,
      origenId: p.origenId ? String(p.origenId) : undefined,
      claveIdempotencia: texto(p, 'claveIdempotencia'),
      responsable: texto(p, 'responsable'),
      ambitoId: texto(p, 'ambitoId')
    });
  },
  'asiento:anular': (ctx, payload) => {
    const p = objeto(payload);
    return anularAsiento(ctx.db, entero(p, 'asientoId'), texto(p, 'responsable'), texto(p, 'motivo'));
  },
  'asiento:listar': (ctx, payload) => {
    const p = objeto(payload);
    return listarAsientos(ctx.db, typeof p.limite === 'number' ? p.limite : 100);
  },
  'cuenta:listar': ctx => listarCuentas(ctx.db),
  'cuenta:crear': (ctx, payload) => {
    const p = objeto(payload);
    return {
      id: crearCuenta(ctx.db, {
        codigo: texto(p, 'codigo'),
        nombre: texto(p, 'nombre'),
        tipo: texto(p, 'tipo'),
        esGrupo: p.esGrupo === true,
        padreId: typeof p.padreId === 'number' ? p.padreId : undefined,
        responsable: texto(p, 'responsable')
      })
    };
  },
  'mayor:consultar': (ctx, payload) => {
    const p = objeto(payload);
    return mayorDeCuenta(ctx.db, entero(p, 'cuentaId'));
  },
  'periodo:cerrar': (ctx, payload) => {
    const p = objeto(payload);
    cerrarPeriodo(ctx.db, entero(p, 'periodoId'), texto(p, 'responsable'), texto(p, 'motivo'));
    return { ok: true };
  },
  'periodo:reabrir': (ctx, payload) => {
    const p = objeto(payload);
    reabrirPeriodo(ctx.db, entero(p, 'periodoId'), texto(p, 'responsable'), texto(p, 'motivo'));
    return { ok: true };
  },
  'balance:resumen': ctx => balanceResumen(ctx.db),
  'balance:saldos': ctx => saldosPorCuenta(ctx.db),
  'respaldo:crear': ctx => crearRespaldo(ctx.db, ctx.rutas.respaldos, ctx.versionApp),
  'respaldo:listar': ctx => descubrirRespaldos(ctx.rutas.respaldos),
  'respaldo:restaurar': (ctx, payload) => {
    const p = objeto(payload);
    return manejarRestauracion(ctx, texto(p, 'nombre'));
  },
  'bitacora:listar': (ctx, payload) => {
    const p = objeto(payload);
    return listarEventos(ctx.db, typeof p.limite === 'number' ? p.limite : 100);
  }
};

export function registrarIpc(ctx: ContextoApp, ventanaWebContentsId: number): void {
  ipcMain.handle('arkon', (evento, solicitud) => {
    if (evento.sender.id !== ventanaWebContentsId) {
      throw new Error('Remitente no autorizado');
    }
    const p = objeto(solicitud);
    const nombre = typeof p.comando === 'string' ? p.comando : '';
    const manejador = comandos[nombre];
    if (!manejador) {
      throw new Error(`Comando desconocido: ${nombre}`);
    }
    return manejador(ctx, p.datos);
  });
}
