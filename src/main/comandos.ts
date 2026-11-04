import path from 'path';
import { contabilizarAsiento, anularAsiento, listarAsientos, mayorDeCuenta, cerrarPeriodo, reabrirPeriodo } from './servicios/motorAsientos';
import { listarCuentas, crearCuenta } from './servicios/cuentas';
import { balanceResumen, saldosPorCuenta } from './servicios/estadosFinancieros';
import { crearRespaldo, descubrirRespaldos } from './servicios/respaldo';
import { manejarRestauracion } from './servicios/restauracion';
import type { ContextoApp } from './servicios/restauracion';

export type { ContextoApp };
import { listarEventos } from './servicios/bitacora';
import {
  crearVigencia,
  cerrarVigencia,
  listarVigencias,
  generarCsvLibro,
  politicaAnticipoHechoGenerador,
  libroVentas,
  libroCompras,
  conciliarIva,
  registrarRetencion,
  listarRetenciones,
  saldoAnticipo,
  aplicarAnticipo,
  anularAplicacionAnticipo
} from './servicios/fiscal';
import { crearContraparte, listarContrapartes, crearProyecto, listarProyectos, registrarCompra, listarCompras, registrarVenta, listarVentas, anularDocumento, perfilIvaInscrito, ivaComprasCreditoFiscal, completarClasificacionDocumento } from './servicios/operacion';
import { crearCotizacion, crearRevision, aprobarCotizacion, anularCotizacion, listarCotizaciones, lineasDeCotizacion, actualizarCotizacionBorrador } from './servicios/cotizaciones';
import { registrarCobro, registrarPago, registrarTransferencia, listarMovimientos, anularMovimiento } from './servicios/tesoreria';
type Manejador = (ctx: ContextoApp, payload: unknown) => unknown | Promise<unknown>;

export class ErrorValidacion extends Error {}

function objeto(payload: unknown): Record<string, unknown> {
  if (payload === undefined || payload === null) {
    return {};
  }
  if (typeof payload !== 'object' || Array.isArray(payload)) {
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

export const comandos: Record<string, Manejador> = {
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
  },
  'contraparte:crear': (ctx, payload) => {
    const p = objeto(payload);
    return {
      id: crearContraparte(ctx.db, {
        nombre: texto(p, 'nombre'),
        esCliente: p.esCliente === true,
        esProveedor: p.esProveedor === true,
        nrc: typeof p.nrc === 'string' ? p.nrc : undefined,
        nit: typeof p.nit === 'string' ? p.nit : undefined,
        clasificacionTributaria: typeof p.clasificacionTributaria === 'string' ? p.clasificacionTributaria : undefined,
        notas: typeof p.notas === 'string' ? p.notas : undefined,
        responsable: texto(p, 'responsable')
      })
    };
  },
  'contraparte:listar': ctx => listarContrapartes(ctx.db),
  'cotizacion:crear': (ctx, payload) => {
    const p = objeto(payload);
    return crearCotizacion(ctx.db, {
      contraparteId: entero(p, 'contraparteId'),
      fecha: texto(p, 'fecha'),
      condiciones: typeof p.condiciones === 'string' ? p.condiciones : undefined,
      responsable: texto(p, 'responsable'),
      lineas: p.lineas as never
    });
  },
  'cotizacion:revision': (ctx, payload) => {
    const p = objeto(payload);
    return crearRevision(ctx.db, entero(p, 'cotizacionId'), texto(p, 'responsable'));
  },
  'cotizacion:aprobar': (ctx, payload) => {
    const p = objeto(payload);
    aprobarCotizacion(ctx.db, entero(p, 'cotizacionId'), texto(p, 'responsable'));
    return { ok: true };
  },
  'cotizacion:anular': (ctx, payload) => {
    const p = objeto(payload);
    anularCotizacion(ctx.db, entero(p, 'cotizacionId'), texto(p, 'responsable'), texto(p, 'motivo'));
    return { ok: true };
  },
  'cotizacion:guardar': (ctx, payload) => {
    const p = objeto(payload);
    actualizarCotizacionBorrador(ctx.db, entero(p, 'cotizacionId'), {
      condiciones: typeof p.condiciones === 'string' ? p.condiciones : undefined,
      lineas: p.lineas as never,
      responsable: texto(p, 'responsable')
    });
    return { ok: true };
  },
  'cotizacion:listar': ctx => listarCotizaciones(ctx.db),
  'cotizacion:lineas': (ctx, payload) => {
    const p = objeto(payload);
    return lineasDeCotizacion(ctx.db, entero(p, 'cotizacionId'));
  },
  'proyecto:crear': (ctx, payload) => {
    const p = objeto(payload);
    return {
      id: crearProyecto(ctx.db, {
        codigo: texto(p, 'codigo'),
        nombre: texto(p, 'nombre'),
        contraparteId: entero(p, 'contraparteId'),
        cotizacionId: typeof p.cotizacionId === 'number' ? p.cotizacionId : undefined,
        alcance: typeof p.alcance === 'string' ? p.alcance : undefined,
        responsable: texto(p, 'responsable')
      })
    };
  },
  'proyecto:listar': ctx => listarProyectos(ctx.db),
  'compra:registrar': (ctx, payload) => {
    const p = objeto(payload);
    return registrarCompra(ctx.db, {
      contraparteId: entero(p, 'contraparteId'),
      proyectoId: typeof p.proyectoId === 'number' ? p.proyectoId : undefined,
      fechaOperacion: texto(p, 'fechaOperacion'),
      concepto: texto(p, 'concepto'),
      condicion: p.condicion === 'contado' ? 'contado' : 'credito',
      lineas: p.lineas as never,
      clasificacionDocumento: ['contribuyente', 'consumidor_final', 'otro'].includes(String(p.clasificacionDocumento))
        ? (p.clasificacionDocumento as 'contribuyente' | 'consumidor_final' | 'otro')
        : undefined,
      tipoDocumento: ['factura', 'ccf', 'recibo', 'otro'].includes(String(p.tipoDocumento))
        ? (p.tipoDocumento as 'factura' | 'ccf' | 'recibo' | 'otro')
        : undefined,
      claveIdempotencia: texto(p, 'claveIdempotencia'),
      responsable: texto(p, 'responsable')
    });
  },
  'compra:listar': (ctx, payload) => {
    const p = objeto(payload);
    return listarCompras(ctx.db, {
      mes: typeof p.mes === 'string' && p.mes ? p.mes : undefined,
      limite: typeof p.limite === 'number' ? p.limite : undefined,
      desde: typeof p.desde === 'number' ? p.desde : undefined
    });
  },
  'venta:registrar': (ctx, payload) => {
    const p = objeto(payload);
    const clasificacion = ['contribuyente', 'consumidor_final', 'otro'].includes(String(p.clasificacionDocumento))
      ? (p.clasificacionDocumento as 'contribuyente' | 'consumidor_final' | 'otro')
      : undefined;
    const tipoDocumento = ['factura', 'ccf', 'recibo', 'otro'].includes(String(p.tipoDocumento))
      ? (p.tipoDocumento as 'factura' | 'ccf' | 'recibo' | 'otro')
      : undefined;
    return registrarVenta(ctx.db, {
      contraparteId: entero(p, 'contraparteId'),
      proyectoId: typeof p.proyectoId === 'number' ? p.proyectoId : undefined,
      fechaOperacion: texto(p, 'fechaOperacion'),
      concepto: texto(p, 'concepto'),
      tipoIngreso: p.tipoIngreso === 'oym' ? 'oym' : 'instalaciones',
      base: texto(p, 'base'),
      tasa: typeof p.tasa === 'string' ? p.tasa : '0',
      clasificacionDocumento: clasificacion,
      tipoDocumento,
      claveIdempotencia: texto(p, 'claveIdempotencia'),
      responsable: texto(p, 'responsable')
    });
  },
  'venta:listar': (ctx, payload) => {
    const p = objeto(payload);
    return listarVentas(ctx.db, {
      mes: typeof p.mes === 'string' && p.mes ? p.mes : undefined,
      limite: typeof p.limite === 'number' ? p.limite : undefined,
      desde: typeof p.desde === 'number' ? p.desde : undefined
    });
  },
  'documento:anular': (ctx, payload) => {
    const p = objeto(payload);
    const tipo = texto(p, 'tipo') === 'venta' ? 'venta' : 'compra';
    anularDocumento(ctx.db, tipo, entero(p, 'documentoId'), texto(p, 'responsable'), texto(p, 'motivo'));
    return { ok: true };
  },
  'documento:clasificar': (ctx, payload) => {
    const p = objeto(payload);
    const tipo = texto(p, 'tipo') === 'venta' ? 'venta' : 'compra';
    const clasificacion = texto(p, 'clasificacionDocumento');
    if (!['contribuyente', 'consumidor_final', 'otro'].includes(clasificacion)) {
      throw new ErrorValidacion('Clasificación inválida');
    }
    const tipoDoc = texto(p, 'tipoDocumento');
    if (!['factura', 'ccf', 'recibo', 'otro'].includes(tipoDoc)) {
      throw new ErrorValidacion('Tipo documental inválido');
    }
    completarClasificacionDocumento(ctx.db, tipo, entero(p, 'documentoId'), {
      clasificacionDocumento: clasificacion as 'contribuyente' | 'consumidor_final' | 'otro',
      tipoDocumento: tipoDoc as 'factura' | 'ccf' | 'recibo' | 'otro',
      responsable: texto(p, 'responsable'),
      motivo: texto(p, 'motivo')
    });
    return { ok: true };
  },
  'cobro:registrar': (ctx, payload) => {
    const p = objeto(payload);
    return registrarCobro(ctx.db, {
      fechaOperacion: texto(p, 'fechaOperacion'),
      contraparteId: entero(p, 'contraparteId'),
      cuentaDestinoId: entero(p, 'cuentaDestinoId'),
      monto: texto(p, 'monto'),
      concepto: texto(p, 'concepto'),
      referencia: typeof p.referencia === 'string' ? p.referencia : undefined,
      aplicaciones: p.aplicaciones as never,
      claveIdempotencia: texto(p, 'claveIdempotencia'),
      responsable: texto(p, 'responsable')
    });
  },
  'pago:registrar': (ctx, payload) => {
    const p = objeto(payload);
    return registrarPago(ctx.db, {
      fechaOperacion: texto(p, 'fechaOperacion'),
      contraparteId: entero(p, 'contraparteId'),
      cuentaOrigenId: entero(p, 'cuentaOrigenId'),
      monto: texto(p, 'monto'),
      concepto: texto(p, 'concepto'),
      referencia: typeof p.referencia === 'string' ? p.referencia : undefined,
      aplicaciones: p.aplicaciones as never,
      claveIdempotencia: texto(p, 'claveIdempotencia'),
      responsable: texto(p, 'responsable')
    });
  },
  'transferencia:registrar': (ctx, payload) => {
    const p = objeto(payload);
    return registrarTransferencia(ctx.db, {
      fechaOperacion: texto(p, 'fechaOperacion'),
      cuentaOrigenId: entero(p, 'cuentaOrigenId'),
      cuentaDestinoId: entero(p, 'cuentaDestinoId'),
      monto: texto(p, 'monto'),
      concepto: texto(p, 'concepto'),
      referencia: typeof p.referencia === 'string' ? p.referencia : undefined,
      claveIdempotencia: texto(p, 'claveIdempotencia'),
      responsable: texto(p, 'responsable')
    });
  },
  'tesoreria:listar': ctx => listarMovimientos(ctx.db),
  'tesoreria:anular': (ctx, payload) => {
    const p = objeto(payload);
    anularMovimiento(ctx.db, entero(p, 'movimientoId'), texto(p, 'responsable'), texto(p, 'motivo'));
    return { ok: true };
  },
  'vigencia:crear': (ctx, payload) => {
    const p = objeto(payload);
    return {
      id: crearVigencia(ctx.db, {
        desde: texto(p, 'desde'),
        hasta: typeof p.hasta === 'string' && p.hasta ? p.hasta : undefined,
        inscritoIva: p.inscritoIva === true,
        descripcion: typeof p.descripcion === 'string' ? p.descripcion : undefined,
        fuente: typeof p.fuente === 'string' ? p.fuente : undefined,
        responsable: texto(p, 'responsable')
      })
    };
  },
  'vigencia:listar': ctx => listarVigencias(ctx.db),
  'vigencia:cerrar': (ctx, payload) => {
    const p = objeto(payload);
    cerrarVigencia(ctx.db, entero(p, 'vigenciaId'), texto(p, 'hasta'), texto(p, 'responsable'), texto(p, 'motivo'));
    return { ok: true };
  },
  'fiscal:libroVentas': (ctx, payload) => {
    const p = objeto(payload);
    return libroVentas(ctx.db, texto(p, 'mes'));
  },
  'fiscal:libroCompras': (ctx, payload) => {
    const p = objeto(payload);
    return libroCompras(ctx.db, texto(p, 'mes'));
  },
  'fiscal:conciliar': (ctx, payload) => {
    const p = objeto(payload);
    return conciliarIva(ctx.db, texto(p, 'mes'));
  },
  'retencion:registrar': (ctx, payload) => {
    const p = objeto(payload);
    return registrarRetencion(ctx.db, {
      tipo: texto(p, 'tipo') === 'recibida' ? 'recibida' : 'efectuada',
      contraparteId: entero(p, 'contraparteId'),
      fechaOperacion: texto(p, 'fechaOperacion'),
      base: texto(p, 'base'),
      tasa: texto(p, 'tasa'),
      regla: texto(p, 'regla'),
      comprobante: typeof p.comprobante === 'string' ? p.comprobante : undefined,
      concepto: texto(p, 'concepto'),
      claveIdempotencia: texto(p, 'claveIdempotencia'),
      responsable: texto(p, 'responsable')
    });
  },
  'retencion:listar': ctx => listarRetenciones(ctx.db),
  'anticipo:saldo': (ctx, payload) => {
    const p = objeto(payload);
    const tipo = texto(p, 'tipo') === 'proveedor' ? 'proveedor' : 'cliente';
    return { saldoMinor: saldoAnticipo(ctx.db, tipo, entero(p, 'contraparteId')).toString() };
  },
  'anticipo:aplicar': (ctx, payload) => {
    const p = objeto(payload);
    return aplicarAnticipo(ctx.db, {
      tipo: texto(p, 'tipo') === 'proveedor' ? 'proveedor' : 'cliente',
      contraparteId: entero(p, 'contraparteId'),
      documentoTipo: texto(p, 'documentoTipo') === 'compra' ? 'compra' : 'venta',
      documentoId: entero(p, 'documentoId'),
      fechaOperacion: texto(p, 'fechaOperacion'),
      monto: texto(p, 'monto'),
      claveIdempotencia: texto(p, 'claveIdempotencia'),
      responsable: texto(p, 'responsable')
    });
  },
  'anticipo:anular': (ctx, payload) => {
    const p = objeto(payload);
    anularAplicacionAnticipo(ctx.db, entero(p, 'id'), texto(p, 'responsable'), texto(p, 'motivo'));
    return { ok: true };
  },
  'fiscal:exportarCsv': (ctx, payload) => {
    const p = objeto(payload);
    return generarCsvLibro(ctx.db, texto(p, 'tipo') === 'compra' ? 'compra' : 'venta', texto(p, 'mes'));
  },
  'fiscal:politicas': ctx => ({
    anticipoHechoGenerador: politicaAnticipoHechoGenerador(ctx.db),
    ivaComprasCreditoFiscal: ivaComprasCreditoFiscal(ctx.db),
    perfilIvaInscritoConfig: perfilIvaInscrito(ctx.db)
  })
};


export function despachar(ctx: ContextoApp, comando: string, datos: unknown): unknown {
  const manejador = comandos[comando];
  if (!manejador) {
    throw new Error(`Comando desconocido: ${comando}`);
  }
  return manejador(ctx, objeto(datos));
}
