import path from 'path';
import { contabilizarAsiento, anularAsiento, listarAsientos, mayorDeCuenta, cerrarPeriodo, reabrirPeriodo } from './servicios/motorAsientos';
import { listarCuentas, crearCuenta } from './servicios/cuentas';
import { balanceResumen, saldosPorCuenta, balanceComprobacion, estadoResultadosEstructurado, estadoSituacionFinanciera } from './servicios/estadosFinancieros';
import { listarPartidas, verPartida } from './servicios/libroDiario';
import { crearRespaldo, descubrirRespaldos } from './servicios/respaldo';
import { listarAdjuntos, verificarAdjunto } from './servicios/adjuntos';
import { respaldoPeriodicoSiCorresponde } from './servicios/restauracion';
import { manejarRestauracion } from './servicios/restauracion';
import type { ContextoApp } from './servicios/restauracion';

export type { ContextoApp };
import { listarEventos } from './servicios/bitacora';
import { registrarApertura, estadoEjercicio, cerrarEjercicio, reabrirEjercicio } from './servicios/cierre';
import { generarPaqueteContador } from './servicios/paqueteContador';
import { consultarEjercicio } from './servicios/ejercicioAnual';
import {
  completarMetadatosRetencion,
  diagnosticarAnexoRetencionesF14,
  leerMetadatosRetencion
} from './servicios/anexoF14';
import {
  diagnosticarAnexo1Ventas,
  exportarAnexo1VentasPresentacion,
  diagnosticarAnexo2VentasConsumidor,
  exportarAnexo2VentasConsumidorPresentacion,
  diagnosticarAnexo3Compras,
  exportarAnexo3ComprasPresentacion,
  completarMetadatosFiscales
} from './servicios/anexosFiscales';
import {
  crearItem,
  editarItem,
  desactivarItem,
  activarItem,
  listarItems
} from './servicios/catalogo';
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
  anularAplicacionAnticipo,
  estadoResultados,
  rentabilidadProyectos,
  auxiliarContrapartes,
  auxiliarEfectivo,
  auxiliarContraparteDetalle,
  exportarCsvAuxiliar,
  registrarAjuste
} from './servicios/fiscal';
import { crearContraparte, listarContrapartes, crearProyecto, listarProyectos, registrarCompra, listarCompras, registrarVenta, listarVentas, anularDocumento, perfilIvaInscrito, ivaComprasCreditoFiscal, completarClasificacionDocumento, editarContraparte, cambiarEstadoContraparte, desactivarCuenta } from './servicios/operacion';
import { crearCotizacion, crearRevision, aprobarCotizacion, anularCotizacion, listarCotizaciones, lineasDeCotizacion, actualizarCotizacionBorrador, generarHtmlCotizacion } from './servicios/cotizaciones';
import { registrarCobro, registrarPago, registrarTransferencia, listarMovimientos, anularMovimiento } from './servicios/tesoreria';
type Manejador = (ctx: ContextoApp, payload: unknown) => unknown | Promise<unknown>;

export class ErrorValidacion extends Error {}

function registroEventoConfig(ctx: ContextoApp, tipo: string, detalle: unknown): void {
  ctx.db
    .prepare('INSERT INTO bitacora_evento (actor, tipo, entidad, entidad_id, detalle) VALUES (?, ?, ?, ?, ?)')
    .run('sistema', tipo, 'configuracion', tipo, JSON.stringify(detalle));
}

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

function exigirBooleano(p: Record<string, unknown>, campo: string): boolean {
  if (typeof p[campo] !== 'boolean') {
    throw new ErrorValidacion(`Campo requerido (booleano): ${campo}`);
  }
  return p[campo] as boolean;
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
  'libro:partidas': (ctx, payload) => {
    const p = objeto(payload);
    return listarPartidas(ctx.db, {
      ambitoId: typeof p.ambitoId === 'string' && p.ambitoId ? p.ambitoId : undefined,
      busqueda: typeof p.busqueda === 'string' && p.busqueda.trim() ? p.busqueda.trim() : undefined,
      desdeNumero: typeof p.desdeNumero === 'number' ? p.desdeNumero : undefined,
      hastaNumero: typeof p.hastaNumero === 'number' ? p.hastaNumero : undefined,
      desdeFecha: typeof p.desdeFecha === 'string' && p.desdeFecha ? p.desdeFecha : undefined,
      hastaFecha: typeof p.hastaFecha === 'string' && p.hastaFecha ? p.hastaFecha : undefined,
      concepto: typeof p.concepto === 'string' && p.concepto.trim() ? p.concepto.trim() : undefined,
      cuentaId: typeof p.cuentaId === 'number' && p.cuentaId ? p.cuentaId : undefined,
      origen: typeof p.origen === 'string' && p.origen ? p.origen : undefined,
      estado: typeof p.estado === 'string' && p.estado ? p.estado : undefined,
      desde: typeof p.desde === 'number' ? p.desde : 0,
      limite: typeof p.limite === 'number' ? p.limite : 50
    });
  },
  'libro:partida': (ctx, payload) => {
    const p = objeto(payload);
    return verPartida(ctx.db, entero(p, 'partidaId'));
  },
  'balance:comprobacion': (ctx, payload) => {
    const p = objeto(payload);
    return balanceComprobacion(ctx.db, {
      desde: texto(p, 'desde'),
      hasta: texto(p, 'hasta'),
      ocultarSinMovimiento: p.ocultarSinMovimiento === true,
      ambitoId: typeof p.ambitoId === 'string' && p.ambitoId ? p.ambitoId : undefined
    });
  },
  'resultados:estructurado': (ctx, payload) => {
    const p = objeto(payload);
    return estadoResultadosEstructurado(ctx.db, {
      desde: texto(p, 'desde'),
      hasta: texto(p, 'hasta'),
      comparativo: p.comparativo === true,
      ambitoId: typeof p.ambitoId === 'string' && p.ambitoId ? p.ambitoId : undefined
    });
  },
  'situacion:consultar': (ctx, payload) => {
    const p = objeto(payload);
    return estadoSituacionFinanciera(ctx.db, {
      corte: texto(p, 'corte'),
      corteComparativo: typeof p.corteComparativo === 'string' && p.corteComparativo ? p.corteComparativo : undefined,
      ambitoId: typeof p.ambitoId === 'string' && p.ambitoId ? p.ambitoId : undefined
    });
  },
  'balance:resumen': ctx => balanceResumen(ctx.db),
  'balance:saldos': ctx => saldosPorCuenta(ctx.db),
  'respaldo:crear': ctx => crearRespaldo(ctx.db, ctx.rutas.respaldos, ctx.versionApp, ctx.rutas.adjuntos),
  'respaldo:listar': ctx => descubrirRespaldos(ctx.rutas.respaldos),
  'adjunto:listar': (ctx, payload) => {
    const p = objeto(payload);
    if (typeof p.entidad === 'string' && p.entidad) {
      return listarAdjuntos(ctx.db, p.entidad, typeof p.entidadId === 'string' ? p.entidadId : undefined);
    }
    return listarAdjuntos(ctx.db);
  },
  'adjunto:verificar': (ctx, payload) => {
    const p = objeto(payload);
    return verificarAdjunto(ctx.db, ctx.rutas.adjuntos, entero(p, 'id'));
  },
  'documento:listarVinculos': (ctx, payload) => {
    const p = objeto(payload);
    const busqueda = typeof p.busqueda === 'string' ? p.busqueda.trim() : '';
    const limite = typeof p.limite === 'number' && Number.isInteger(p.limite) && p.limite > 0 ? Math.min(p.limite, 500) : 50;
    const patron = busqueda ? `%${busqueda.replace(/[%_]/g, c => `\${c}`)}%` : '%';
    const filtroVenta = busqueda
      ? "AND estado = 'registrada' AND (folio LIKE ? OR concepto LIKE ?)"
      : "AND estado = 'registrada'";
    const filtroCompra = busqueda
      ? "AND estado = 'registrada' AND (folio LIKE ? OR concepto LIKE ?)"
      : "AND estado = 'registrada'";
    const filtroCotizacion = busqueda ? 'AND (numero LIKE ? OR CAST(id AS TEXT) LIKE ?)' : '';
    const filtroProyecto = busqueda ? 'AND (nombre LIKE ? OR codigo LIKE ? OR CAST(id AS TEXT) LIKE ?)' : '';
    const ventas = ctx.db
      .prepare(`SELECT id, folio, concepto, fecha_operacion AS fecha FROM venta WHERE 1=1 ${filtroVenta} ORDER BY id DESC LIMIT ?`)
      .all(...(busqueda ? [patron, patron] : []), limite) as Array<{ id: number; folio: string; concepto: string; fecha: string }>;
    const compras = ctx.db
      .prepare(`SELECT folio, concepto, fecha_operacion AS fecha FROM compra WHERE 1=1 ${filtroCompra} ORDER BY id DESC LIMIT ?`)
      .all(...(busqueda ? [patron, patron] : []), limite) as Array<{ folio: string; concepto: string; fecha: string }>;
    const cotizaciones = ctx.db
      .prepare(`SELECT CAST(id AS TEXT) AS folio, numero || ' rev ' || revision AS concepto, estado AS fecha FROM cotizacion WHERE 1=1 ${filtroCotizacion} ORDER BY id DESC LIMIT ?`)
      .all(...(busqueda ? [patron, patron] : []), limite) as Array<{ folio: string; concepto: string; fecha: string }>;
    const proyectos = ctx.db
      .prepare(`SELECT CAST(id AS TEXT) AS folio, nombre AS concepto, estado AS fecha FROM proyecto WHERE 1=1 ${filtroProyecto} ORDER BY id DESC LIMIT ?`)
      .all(...(busqueda ? [patron, patron, patron] : []), limite) as Array<{ folio: string; concepto: string; fecha: string }>;
    return { venta: ventas, compra: compras, cotizacion: cotizaciones, proyecto: proyectos };
  },
  'config:respaldoPeriodicoLeer': ctx => {
    const intervalo = ctx.db.prepare("SELECT valor FROM configuracion WHERE clave = 'respaldo_intervalo_minutos'").get() as { valor: string } | undefined;
    const retencion = ctx.db.prepare("SELECT valor FROM configuracion WHERE clave = 'respaldo_retencion_automatica'").get() as { valor: string } | undefined;
    return {
      intervaloMinutos: Number(intervalo?.valor ?? '0') || 0,
      retencion: Number(retencion?.valor ?? '5') || 5
    };
  },
  'config:respaldoPeriodicoGuardar': (ctx, payload) => {
    const p = objeto(payload);
    const intervalo = typeof p.intervaloMinutos === 'number' ? p.intervaloMinutos : 0;
    const retencion = typeof p.retencion === 'number' ? p.retencion : 5;
    if (!Number.isInteger(intervalo) || intervalo < 0 || intervalo > 1440) {
      throw new ErrorValidacion('Intervalo inválido (0-1440 minutos)');
    }
    if (!Number.isInteger(retencion) || retencion < 1 || retencion > 50) {
      throw new ErrorValidacion('Retención inválida (1-50 respaldos)');
    }
    ctx.db.prepare("UPDATE configuracion SET valor = ? WHERE clave = 'respaldo_intervalo_minutos'").run(String(intervalo));
    ctx.db.prepare("UPDATE configuracion SET valor = ? WHERE clave = 'respaldo_retencion_automatica'").run(String(retencion));
    ctx.db.prepare('INSERT INTO bitacora_evento (actor, tipo, entidad, entidad_id, detalle) VALUES (?, ?, ?, ?, ?)')
      .run('sistema', 'config_respaldo_periodico', 'configuracion', 'config_respaldo_periodico', JSON.stringify({ intervalo, retencion }));
    return { ok: true };
  },
  'respaldo:ejecutarPeriodico': async ctx => respaldoPeriodicoSiCorresponde(ctx),
  'respaldo:estadoPeriodico': (ctx) => {
    const intervalo = ctx.db.prepare("SELECT valor FROM configuracion WHERE clave = 'respaldo_intervalo_minutos'").get() as { valor: string } | undefined;
    const intervaloMin = Number(intervalo?.valor ?? '0') || 0;
    const ultimo = ctx.db
      .prepare("SELECT creado_en, nombre FROM respaldo WHERE nombre LIKE 'respaldo-automatico-%' ORDER BY id DESC LIMIT 1")
      .get() as { creado_en: string; nombre: string } | undefined;
    const ultimoFallo = ctx.db
      .prepare("SELECT fecha AS creado_en, detalle FROM bitacora_evento WHERE tipo = 'respaldo_periodico_fallo' ORDER BY id DESC LIMIT 1")
      .get() as { creado_en: string; detalle: string } | undefined;
    let proximaEjecucion: string | null = null;
    if (intervaloMin > 0 && ultimo) {
      const fechaUltimo = new Date(ultimo.creado_en.replace(' ', 'T') + 'Z').getTime();
      const proxima = new Date(fechaUltimo + intervaloMin * 60000);
      proximaEjecucion = proxima.toISOString();
    }
    return {
      intervaloMinutos: intervaloMin,
      ultimoRespaldo: ultimo ? { creadoEn: ultimo.creado_en, nombre: ultimo.nombre } : null,
      ultimoFallo: ultimoFallo ? { creadoEn: ultimoFallo.creado_en, detalle: ultimoFallo.detalle } : null,
      proximaEjecucion
    };
  },
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
  'contraparte:editar': (ctx, payload) => {
    const p = objeto(payload);
    editarContraparte(ctx.db, entero(p, 'contraparteId'), {
      nombre: typeof p.nombre === 'string' ? p.nombre : undefined,
      nrc: typeof p.nrc === 'string' ? p.nrc : undefined,
      nit: typeof p.nit === 'string' ? p.nit : undefined,
      clasificacionTributaria: typeof p.clasificacionTributaria === 'string' ? p.clasificacionTributaria : undefined,
      notas: typeof p.notas === 'string' ? p.notas : undefined,
      responsable: texto(p, 'responsable')
    });
    return { ok: true };
  },
  'contraparte:cambiarEstado': (ctx, payload) => {
    const p = objeto(payload);
    cambiarEstadoContraparte(ctx.db, entero(p, 'contraparteId'), p.activa === true, texto(p, 'responsable'));
    return { ok: true };
  },
  'cuenta:desactivar': (ctx, payload) => {
    const p = objeto(payload);
    desactivarCuenta(ctx.db, entero(p, 'cuentaId'), texto(p, 'responsable'));
    return { ok: true };
  },
  'item:crear': (ctx, payload) => {
    const p = objeto(payload);
    return {
      id: crearItem(ctx.db, {
        tipo: texto(p, 'tipo') === 'material' ? 'material' : 'servicio',
        codigo: texto(p, 'codigo'),
        nombre: texto(p, 'nombre'),
        unidad: typeof p.unidad === 'string' ? p.unidad : undefined,
        descripcion: typeof p.descripcion === 'string' ? p.descripcion : undefined,
        precioVenta: typeof p.precioVenta === 'string' && p.precioVenta ? p.precioVenta : undefined,
        precioCosto: typeof p.precioCosto === 'string' && p.precioCosto ? p.precioCosto : undefined,
        responsable: texto(p, 'responsable')
      })
    };
  },
  'item:editar': (ctx, payload) => {
    const p = objeto(payload);
    editarItem(ctx.db, entero(p, 'itemId'), {
      nombre: typeof p.nombre === 'string' ? p.nombre : undefined,
      unidad: typeof p.unidad === 'string' ? p.unidad : undefined,
      descripcion: typeof p.descripcion === 'string' ? p.descripcion : undefined,
      precioVenta: typeof p.precioVenta === 'string' ? p.precioVenta : undefined,
      precioCosto: typeof p.precioCosto === 'string' ? p.precioCosto : undefined,
      responsable: texto(p, 'responsable')
    });
    return { ok: true };
  },
  'item:desactivar': (ctx, payload) => {
    const p = objeto(payload);
    desactivarItem(ctx.db, entero(p, 'itemId'), texto(p, 'responsable'));
    return { ok: true };
  },
  'item:activar': (ctx, payload) => {
    const p = objeto(payload);
    activarItem(ctx.db, entero(p, 'itemId'), texto(p, 'responsable'));
    return { ok: true };
  },
  'item:listar': (ctx, payload) => {
    const p = objeto(payload);
    return listarItems(ctx.db, p.soloActivos === true);
  },
  'cotizacion:html': (ctx, payload) => {
    const p = objeto(payload);
    return { html: generarHtmlCotizacion(ctx.db, entero(p, 'cotizacionId')) };
  },
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
    const motivo = texto(p, 'motivo');
    if (motivo.trim().length < 10) {
      throw new ErrorValidacion('La anulación exige un motivo significativo (mínimo 10 caracteres).');
    }
    const tipo = texto(p, 'tipo') === 'venta' ? 'venta' : 'compra';
    anularDocumento(ctx.db, tipo, entero(p, 'documentoId'), texto(p, 'responsable'), motivo);
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
    const motivo = texto(p, 'motivo');
    if (motivo.trim().length < 10) {
      throw new ErrorValidacion('La anulación exige un motivo significativo (mínimo 10 caracteres).');
    }
    anularMovimiento(ctx.db, entero(p, 'movimientoId'), texto(p, 'responsable'), motivo);
    return { ok: true };
  },
  'vigencia:crear': (ctx, payload) => {
    const p = objeto(payload);
    return {
      id: crearVigencia(ctx.db, {
        desde: texto(p, 'desde'),
        hasta: typeof p.hasta === 'string' && p.hasta ? p.hasta : undefined,
        inscritoIva: p.inscritoIva === true,
        obligacionF14: p.obligacionF14 === true,
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
  'reporte:estadoResultados': (ctx, payload) => {
    const p = objeto(payload);
    return estadoResultados(ctx.db, texto(p, 'mes'));
  },
  'reporte:rentabilidadProyectos': ctx => rentabilidadProyectos(ctx.db),
  'auxiliar:contrapartes': ctx => auxiliarContrapartes(ctx.db),
  'auxiliar:efectivo': ctx => auxiliarEfectivo(ctx.db),
  'auxiliar:contraparteDetalle': (ctx, payload) => {
    const p = objeto(payload);
    const tipo = texto(p, 'tipo') === 'proveedor' ? 'proveedor' : 'cliente';
    return auxiliarContraparteDetalle(ctx.db, tipo, entero(p, 'contraparteId'), typeof p.hastaFecha === 'string' && p.hastaFecha ? p.hastaFecha : undefined);
  },
  'auxiliar:exportarCsv': (ctx, payload) => {
    const p = objeto(payload);
    const tipo = texto(p, 'tipo');
    if (!['cliente', 'proveedor', 'efectivo'].includes(tipo)) {
      throw new ErrorValidacion('Tipo de auxiliar inválido');
    }
    return exportarCsvAuxiliar(ctx.db, tipo as 'cliente' | 'proveedor' | 'efectivo');
  },
  'ajuste:registrar': (ctx, payload) => {
    const p = objeto(payload);
    const lineas = p.lineas as Array<{ cuentaCodigo: string; debeMinor: string; haberMinor: string }>;
    if (!Array.isArray(lineas) || lineas.length < 2) {
      throw new ErrorValidacion('El ajuste requiere al menos dos líneas');
    }
    for (const l of lineas) {
      if (typeof l.cuentaCodigo !== 'string' || !l.cuentaCodigo) {
        throw new ErrorValidacion('Cada línea requiere código de cuenta');
      }
    }
    return registrarAjuste(ctx.db, {
      fechaOperacion: texto(p, 'fechaOperacion'),
      concepto: texto(p, 'concepto'),
      lineas,
      referencia: texto(p, 'referencia'),
      claveIdempotencia: texto(p, 'claveIdempotencia'),
      responsable: texto(p, 'responsable')
    });
  },
  'fiscal:politicas': ctx => ({
    anticipoHechoGenerador: politicaAnticipoHechoGenerador(ctx.db),
    ivaComprasCreditoFiscal: ivaComprasCreditoFiscal(ctx.db),
    perfilIvaInscritoConfig: perfilIvaInscrito(ctx.db)
  }),
  'apertura:registrar': (ctx, payload) => {
    const p = objeto(payload);
    const lineas = p.lineas as Array<{ cuentaCodigo: string; debeMinor: string; haberMinor: string }>;
    if (!Array.isArray(lineas) || lineas.length < 2) {
      throw new ErrorValidacion('La apertura requiere al menos dos líneas');
    }
    for (const l of lineas) {
      if (typeof l.cuentaCodigo !== 'string' || !l.cuentaCodigo) {
        throw new ErrorValidacion('Cada línea requiere código de cuenta');
      }
    }
    return registrarApertura(ctx.db, {
      fechaOperacion: texto(p, 'fechaOperacion'),
      concepto: texto(p, 'concepto'),
      lineas,
      referencia: texto(p, 'referencia'),
      claveIdempotencia: texto(p, 'claveIdempotencia'),
      responsable: texto(p, 'responsable')
    });
  },
  'cierre:estado': (ctx, payload) => {
    const p = objeto(payload);
    return estadoEjercicio(ctx.db, entero(p, 'anio'));
  },
  'cierre:ejercicio': (ctx, payload) => {
    const p = objeto(payload);
    return cerrarEjercicio(ctx.db, {
      anio: entero(p, 'anio'),
      responsable: texto(p, 'responsable'),
      motivo: texto(p, 'motivo'),
      referencia: texto(p, 'referencia'),
      claveIdempotencia: texto(p, 'claveIdempotencia'),
      cuentaResultadoCodigo:
        typeof p.cuentaResultadoCodigo === 'string' && p.cuentaResultadoCodigo
          ? p.cuentaResultadoCodigo
          : undefined
    });
  },
  'cierre:reabrir': (ctx, payload) => {
    const p = objeto(payload);
    return reabrirEjercicio(ctx.db, {
      anio: entero(p, 'anio'),
      responsable: texto(p, 'responsable'),
      motivo: texto(p, 'motivo')
    });
  },
  'paquete:generar': (ctx, payload) => {
    const p = objeto(payload);
    return generarPaqueteContador(ctx.db, texto(p, 'desde'), texto(p, 'hasta'));
  },
  'fiscal:anexo1Ventas': (ctx, payload) => {
    const p = objeto(payload);
    return diagnosticarAnexo1Ventas(ctx.db, texto(p, 'mes'));
  },
  'fiscal:anexo1Presentacion': (ctx, payload) => {
    const p = objeto(payload);
    return exportarAnexo1VentasPresentacion(ctx.db, texto(p, 'mes'));
  },
  'fiscal:metadatosLeer': (ctx, payload) => {
    const p = objeto(payload);
    const id = entero(p, 'documentoId');
    const tipo = texto(p, 'tipo') === 'compra' ? 'compra' : 'venta';
    if (tipo === 'compra') {
      const compra = ctx.db
        .prepare(
          `SELECT co.id, co.folio, co.fecha_operacion AS fecha, c.nombre AS contraparte,
                  co.clase_documento_fiscal, co.numero_resolucion, co.serie_documento,
                  co.numero_documento_autorizado, NULL AS tratamiento_venta,
                  co.tipo_operacion_renta, NULL AS tipo_ingreso_renta,
                  co.clasificacion_renta, co.sector, co.tipo_costo_gasto
           FROM compra co JOIN contraparte c ON c.id = co.contraparte_id
           WHERE co.id = ?`
        )
        .get(id) as Record<string, unknown> | undefined;
      if (!compra) {
        throw new ErrorValidacion('Compra inexistente');
      }
      return compra;
    }
    const fila = ctx.db
      .prepare(
        `SELECT v.id, v.folio, v.fecha_operacion AS fecha, c.nombre AS contraparte,
                v.clase_documento_fiscal, v.numero_resolucion, v.serie_documento,
                v.numero_documento_autorizado, v.tratamiento_venta,
                v.tipo_operacion_renta, v.tipo_ingreso_renta
         FROM venta v JOIN contraparte c ON c.id = v.contraparte_id
         WHERE v.id = ?`
      )
      .get(id) as
      | {
          id: number;
          folio: string;
          fecha: string;
          contraparte: string;
          clase_documento_fiscal: string | null;
          numero_resolucion: string | null;
          serie_documento: string | null;
          numero_documento_autorizado: string | null;
          tratamiento_venta: string | null;
          tipo_operacion_renta: string | null;
          tipo_ingreso_renta: string | null;
        }
      | undefined;
    if (!fila) {
      throw new ErrorValidacion('Venta inexistente');
    }
    return fila;
  },
  'fiscal:metadatosCompletar': (ctx, payload) => {
    const p = objeto(payload);
    const tipo = texto(p, 'tipo') === 'compra' ? 'compra' : 'venta';
    return completarMetadatosFiscales(
      ctx.db,
      tipo,
      entero(p, 'documentoId'),
      {
        claseDocumentoFiscal: texto(p, 'claseDocumentoFiscal'),
        numeroResolucion: texto(p, 'numeroResolucion'),
        serieDocumento: texto(p, 'serieDocumento'),
        numeroDocumentoAutorizado: texto(p, 'numeroDocumentoAutorizado'),
        tratamientoVenta:
          p.tratamientoVenta === 'exenta' || p.tratamientoVenta === 'no_sujeta' ? p.tratamientoVenta : undefined,
        tipoOperacionRenta: texto(p, 'tipoOperacionRenta'),
        tipoIngresoRenta:
          tipo === 'venta'
            ? texto(p, 'tipoIngresoRenta')
            : typeof p.tipoIngresoRenta === 'string'
              ? p.tipoIngresoRenta
              : undefined,
        clasificacionRenta: typeof p.clasificacionRenta === 'string' ? p.clasificacionRenta : undefined,
        sector: typeof p.sector === 'string' ? p.sector : undefined,
        tipoCostoGasto: typeof p.tipoCostoGasto === 'string' ? p.tipoCostoGasto : undefined
      },
      texto(p, 'responsable'),
      texto(p, 'motivo')
    );
  },
  'fiscal:anexo2Ventas': (ctx, payload) => {
    const p = objeto(payload);
    return diagnosticarAnexo2VentasConsumidor(ctx.db, texto(p, 'mes'));
  },
  'fiscal:anexo3Compras': (ctx, payload) => {
    const p = objeto(payload);
    return diagnosticarAnexo3Compras(ctx.db, texto(p, 'mes'));
  },
  'fiscal:anexoRetenciones': (ctx, payload) => {
    const p = objeto(payload);
    return diagnosticarAnexoRetencionesF14(ctx.db, texto(p, 'mes'));
  },
  'fiscal:retencionMetadatosCompletar': (ctx, payload) => {
    const p = objeto(payload);
    return completarMetadatosRetencion(
      ctx.db,
      entero(p, 'retencionId'),
      {
        domiciliado: texto(p, 'domiciliado'),
        codigoPais: texto(p, 'codigoPais'),
        nitNif: typeof p.nitNif === 'string' ? p.nitNif : undefined,
        dui: typeof p.dui === 'string' ? p.dui : undefined,
        codigoIngreso: texto(p, 'codigoIngreso'),
        tipoOperacion: texto(p, 'tipoOperacion'),
        clasificacion: texto(p, 'clasificacion'),
        sector: texto(p, 'sector'),
        tipoCostoGasto: texto(p, 'tipoCostoGasto'),
        involucraNomina: exigirBooleano(p, 'involucraNomina'),
        personaNatural: exigirBooleano(p, 'personaNatural')
      },
      texto(p, 'responsable'),
      texto(p, 'motivo')
    );
  },
  'fiscal:retencionMetadatosLeer': (ctx, payload) => {
    const p = objeto(payload);
    return leerMetadatosRetencion(ctx.db, entero(p, 'retencionId'));
  },
  'ejercicio:consultar': (ctx, payload) => {
    const p = objeto(payload);
    return consultarEjercicio(ctx.db, entero(p, 'anio'));
  }
};


export function despachar(ctx: ContextoApp, comando: string, datos: unknown): unknown {
  const manejador = comandos[comando];
  if (!manejador) {
    throw new Error(`Comando desconocido: ${comando}`);
  }
  return manejador(ctx, objeto(datos));
}
