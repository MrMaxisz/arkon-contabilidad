import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { ContraparteResumen } from '../../shared/contratos';
import { fechaLocalElSalvador } from '../../shared/fechas';

interface Vigencia {
  id: number;
  desde: string;
  hasta: string | null;
  inscritoIva: boolean;
  descripcion: string | null;
  fuente: string | null;
}

interface FilaLibro {
  folio: string;
  fecha: string;
  contraparteNombre: string;
  baseMinor: string;
  ivaMinor: string;
  totalMinor: string;
  estado: string;
}

interface ResumenLibro {
  filas: FilaLibro[];
  baseMinor: string;
  ivaMinor: string;
  totalMinor: string;
}

interface Conciliacion {
  mes: string;
  debitoLibroMinor: string;
  debitoMayorMinor: string;
  conciliaDebito: boolean;
  ivaDocumentadoComprasMinor: string;
  creditoAcreditableLibroMinor: string;
  creditoMayorMinor: string;
  conciliaCredito: boolean;
  nota: string;
}

interface EstadoResultados {
  mes: string;
  filas: Array<{ codigo: string; nombre: string; tipo: string; importeMinor: string }>;
  ingresosMinor: string;
  costosGastosMinor: string;
  resultadoMinor: string;
}

interface Retencion {
  id: number;
  folio: string;
  tipo: string;
  contraparteNombre: string;
  fecha: string;
  baseMinor: string;
  montoMinor: string;
  regla: string;
  comprobante: string | null;
  estado: string;
}

function nuevaClave(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `op-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function mesActual(): string {
  return fechaLocalElSalvador().slice(0, 7);
}

export default function Impuestos() {
  const [vigencias, setVigencias] = useState<Vigencia[]>([]);
  const [contrapartes, setContrapartes] = useState<ContraparteResumen[]>([]);
  const [mes, setMes] = useState(mesActual());
  const [libroV, setLibroV] = useState<ResumenLibro | null>(null);
  const [libroC, setLibroC] = useState<ResumenLibro | null>(null);
  const [conciliacion, setConciliacion] = useState<Conciliacion | null>(null);
  const [retenciones, setRetenciones] = useState<Retencion[]>([]);
  const [mensaje, setMensaje] = useState<{ texto: string; tipo: 'ok' | 'error' } | null>(null);
  const [politicas, setPoliticas] = useState<{ anticipoHechoGenerador: string; ivaComprasCreditoFiscal: boolean; perfilIvaInscritoConfig: boolean } | null>(null);
  const [exportacion, setExportacion] = useState<{ mes: string; tipo: string; csv: string; version: string; advertencia: string } | null>(null);
  const [estadoResultados, setEstadoResultados] = useState<EstadoResultados | null>(null);
  const [anexoMes, setAnexoMes] = useState('');
  const [anexoDiagnostico, setAnexoDiagnostico] = useState<{
    folios: Array<{ folio: string; documentoId: number; faltantes: string[] }>;
    listos: string[];
    bloqueado: boolean;
    motivo: string;
  } | null>(null);
  const [metaDocumentoId, setMetaDocumentoId] = useState(0);
  const [metaCargando, setMetaCargando] = useState(false);
  const consultaMeta = useRef(0);
  const [metaBusqueda, setMetaBusqueda] = useState('');
  const [ventasSelector, setVentasSelector] = useState<Array<{ id: number; folio: string; concepto: string; fecha: string }>>([]);
  const [metaActual, setMetaActual] = useState<{ folio: string; fecha: string; contraparte: string; clase_documento_fiscal: string | null } | null>(null);
  const [metaClase, setMetaClase] = useState('1');
  const [metaResolucion, setMetaResolucion] = useState('');
  const [metaSerie, setMetaSerie] = useState('');
  const [metaNumero, setMetaNumero] = useState('');
  const [metaTratamiento, setMetaTratamiento] = useState('');
  const [metaOperacionRenta, setMetaOperacionRenta] = useState('');
  const [metaIngresoRenta, setMetaIngresoRenta] = useState('');
  const [metaResponsable, setMetaResponsable] = useState('');
  const [metaMotivo, setMetaMotivo] = useState('');
  useEffect(() => {
    void api()
      .invocar('documento:listarVinculos', { busqueda: '', limite: 200 })
      .then(r => {
        const vinculos = r as { venta: Array<{ id: number; folio: string; concepto: string; fecha: string }> };
        setVentasSelector(vinculos.venta ?? []);
      })
      .catch(() => setVentasSelector([]));
  }, []);
  const consultaResultadosId = useRef(0);
  const mesResultadosRef = useRef(mes);
  mesResultadosRef.current = mes;
  const exportacionId = useRef(0);
  const mesRef = useRef(mes);
  mesRef.current = mes;

  const [desde, setDesde] = useState(fechaLocalElSalvador());
  const [hasta, setHasta] = useState('');
  const [inscritoIva, setInscritoIva] = useState(false);
  const [cerrandoId, setCerrandoId] = useState<number | null>(null);
  const [cierreFecha, setCierreFecha] = useState(fechaLocalElSalvador());
  const [cierreMotivo, setCierreMotivo] = useState('');
  const [fuente, setFuente] = useState('');
  const [responsable, setResponsable] = useState('');

  const [retTipo, setRetTipo] = useState<'efectuada' | 'recibida'>('efectuada');
  const [retContraparte, setRetContraparte] = useState(0);
  const [retFecha, setRetFecha] = useState(fechaLocalElSalvador());
  const [retBase, setRetBase] = useState('');
  const [retTasa, setRetTasa] = useState('1');
  const [retRegla, setRetRegla] = useState('');
  const [retComprobante, setRetComprobante] = useState('');
  const [retConcepto, setRetConcepto] = useState('');
  const claveRet = useRef(nuevaClave());

  const cargar = useCallback(() => {
    void api().invocar('vigencia:listar').then(r => setVigencias(r as Vigencia[]));
    void api().invocar('contraparte:listar').then(r => setContrapartes(r as ContraparteResumen[]));
    void api().invocar('retencion:listar').then(r => setRetenciones(r as Retencion[]));
    void api().invocar('fiscal:politicas').then(r => setPoliticas(r as never));
  }, []);

  const cargarMes = useCallback(() => {
    void api().invocar('fiscal:libroVentas', { mes }).then(r => setLibroV(r as ResumenLibro));
    void api().invocar('fiscal:libroCompras', { mes }).then(r => setLibroC(r as ResumenLibro));
    void api().invocar('fiscal:conciliar', { mes }).then(r => setConciliacion(r as Conciliacion));
    const id = ++consultaResultadosId.current;
    const mesSolicitado = mes;
    api()
      .invocar('reporte:estadoResultados', { mes })
      .then(r => {
        if (consultaResultadosId.current === id && mesResultadosRef.current === mesSolicitado) {
          const reporte = r as EstadoResultados;
          if (reporte.mes === mesSolicitado) {
            setEstadoResultados(reporte);
          }
        }
      })
      .catch(err => {
        if (consultaResultadosId.current === id && mesResultadosRef.current === mesSolicitado) {
          setMensaje({ texto: String(err instanceof Error ? err.message : err), tipo: 'error' });
        }
      });
  }, [mes]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  useEffect(() => {
    cargarMes();
  }, [cargarMes]);

  async function crearVigencia(e: React.FormEvent) {
    e.preventDefault();
    setMensaje(null);
    try {
      await api().invocar('vigencia:crear', { desde, hasta: hasta || undefined, inscritoIva, fuente, responsable });
      setMensaje({ texto: 'Vigencia registrada. No recalcula el historial ni atribuye operaciones anteriores.', tipo: 'ok' });
      cargar();
    } catch (err) {
      setMensaje({ texto: String(err instanceof Error ? err.message : err), tipo: 'error' });
    }
  }

  async function exportar(tipo: 'venta' | 'compra') {
    const id = ++exportacionId.current;
    const mesSolicitado = mes;
    setMensaje(null);
    try {
      const r = (await api().invocar('fiscal:exportarCsv', { tipo, mes })) as { csv: string; version: string; advertencia: string };
      if (exportacionId.current !== id || mesRef.current !== mesSolicitado) {
        return;
      }
      setExportacion({ mes, tipo, ...r });
    } catch (err) {
      if (exportacionId.current !== id) {
        return;
      }
      setMensaje({ texto: String(err instanceof Error ? err.message : err), tipo: 'error' });
    }
  }

  async function guardarArchivo(tipo: 'venta' | 'compra') {
    setMensaje(null);
    try {
      const r = (await api().guardarCsv(tipo, mes)) as { guardado: boolean; ruta?: string; version: string; advertencia: string };
      if (r.guardado && r.ruta) {
        setMensaje({ texto: `Exportación interna (${r.version}) guardada en ${r.ruta}. ${r.advertencia}`, tipo: 'ok' });
      } else {
        setMensaje({ texto: 'Guardado cancelado por el usuario.', tipo: 'ok' });
      }
    } catch (err) {
      setMensaje({ texto: String(err instanceof Error ? err.message : err), tipo: 'error' });
    }
  }

  async function registrarRetencion(e: React.FormEvent) {
    e.preventDefault();
    setMensaje(null);
    try {
      const r = (await api().invocar('retencion:registrar', {
        tipo: retTipo,
        contraparteId: retContraparte,
        fechaOperacion: retFecha,
        base: retBase,
        tasa: retTasa,
        regla: retRegla,
        comprobante: retComprobante,
        concepto: retConcepto,
        claveIdempotencia: claveRet.current,
        responsable
      })) as { folio: string };
      setMensaje({ texto: `Retención ${r.folio} registrada como control; sin efecto contable automático.`, tipo: 'ok' });
      setRetBase('');
      setRetConcepto('');
      claveRet.current = nuevaClave();
      cargar();
    } catch (err) {
      setMensaje({ texto: String(err instanceof Error ? err.message : err), tipo: 'error' });
    }
  }

  return (
    <div>
      <h1>Impuestos</h1>
      {mensaje && <p className={`aviso ${mensaje.tipo === 'error' ? 'error' : 'ok'}`}>{mensaje.texto}</p>}

      <form onSubmit={crearVigencia}>
        <h2>Vigencias del perfil tributario</h2>
        <div className="fila">
          <label>Vigente desde<input type="date" value={desde} onChange={e => setDesde(e.target.value)} required /></label>
          <label>Hasta (opcional)<input type="date" value={hasta} onChange={e => setHasta(e.target.value)} /></label>
          <label><input type="checkbox" checked={inscritoIva} onChange={e => setInscritoIva(e.target.checked)} /> Inscrito en IVA desde esa fecha</label>
          <label style={{ flex: 2 }}>Fuente oficial<input value={fuente} onChange={e => setFuente(e.target.value)} placeholder="Referencia de la inscripción" /></label>
          <label>Responsable<input value={responsable} onChange={e => setResponsable(e.target.value)} required /></label>
          <button className="primario" type="submit">Registrar vigencia</button>
        </div>
        <p className="menor">Una futura inscripción configura una vigencia; no recalcula el historial ni atribuye operaciones anteriores a la nueva entidad.</p>
      </form>
      {cerrandoId !== null && (
        <form onSubmit={async e => {
          e.preventDefault();
          try {
            await api().invocar('vigencia:cerrar', { vigenciaId: cerrandoId, hasta: cierreFecha, responsable, motivo: cierreMotivo });
            setMensaje({ texto: 'Vigencia cerrada; el historial no se recalcula.', tipo: 'ok' });
            setCerrandoId(null);
            cargar();
          } catch (err) {
            setMensaje({ texto: String(err instanceof Error ? err.message : err), tipo: 'error' });
          }
        }}>
          <h2>Cerrar vigencia</h2>
          <div className="fila">
            <label>Hasta<input type="date" value={cierreFecha} onChange={e => setCierreFecha(e.target.value)} required /></label>
            <label style={{ flex: 2 }}>Motivo (obligatorio)<input value={cierreMotivo} onChange={e => setCierreMotivo(e.target.value)} required /></label>
            <button className="primario" type="submit">Confirmar cierre</button>
            <button type="button" onClick={() => setCerrandoId(null)}>Cancelar</button>
          </div>
        </form>
      )}
      {vigencias.length === 0 ? (
        <p className="vacio">Sin vigencias registradas: régimen administrativo previo a la constitución.</p>
      ) : (
        <table>
          <thead><tr><th>Desde</th><th>Hasta</th><th>Inscrito IVA</th><th>Fuente</th></tr></thead>
          <tbody>
            {vigencias.map(v => (
              <tr key={v.id}>
                <td>{v.desde}</td>
                <td>{v.hasta ?? 'Abierta'}</td>
                <td>{v.inscritoIva ? 'Sí' : 'No'}</td>
                <td>{v.fuente ?? '—'}</td>
                <td>
                  {v.hasta === null && (
                    <button onClick={() => { setCerrandoId(v.id); setCierreMotivo(''); }}>Cerrar vigencia</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {politicas && (
        <p className="menor">
          Políticas: hecho generador de anticipos — {politicas.anticipoHechoGenerador === 'pendiente' ? 'PENDIENTE del contador responsable' : politicas.anticipoHechoGenerador};
          IVA de compras a crédito fiscal — {politicas.ivaComprasCreditoFiscal ? 'activo' : 'inactivo'}.
        </p>
      )}
      <h2>Libros y conciliación de IVA</h2>
      <div className="fila">
        <label>Mes<input type="month" value={mes} onChange={e => { setMes(e.target.value); exportacionId.current++; consultaResultadosId.current++; setExportacion(null); setEstadoResultados(null); }} /></label>
      </div>
      {conciliacion && (
        <table>
          <tbody>
            <tr><td>IVA débito según libro de ventas</td><td className="numero">${conciliacion.debitoLibroMinor}</td></tr>
            <tr><td>IVA débito según mayor (2201)</td><td className="numero">${conciliacion.debitoMayorMinor}</td></tr>
            <tr><td>Concilia débito</td><td className="numero">{conciliacion.conciliaDebito ? 'Sí' : 'No'}</td></tr>
            <tr><td>IVA documentado en compras (informativo)</td><td className="numero">${conciliacion.ivaDocumentadoComprasMinor}</td></tr>
            <tr><td>IVA acreditable según libro de compras</td><td className="numero">${conciliacion.creditoAcreditableLibroMinor}</td></tr>
            <tr><td>IVA crédito según mayor (1203)</td><td className="numero">${conciliacion.creditoMayorMinor}</td></tr>
            <tr><td>Concilia crédito</td><td className="numero">{conciliacion.conciliaCredito ? 'Sí' : 'No'}</td></tr>
          </tbody>
        </table>
      )}
      {conciliacion && <p className="menor">{conciliacion.nota}</p>}
      <h3>Libro de ventas — {libroV?.ivaMinor ?? '0.00'} de IVA</h3>
      {libroV && libroV.filas.length > 0 ? (
        <table>
          <thead><tr><th>Folio</th><th>Fecha</th><th>Cliente</th><th className="numero">Base</th><th className="numero">IVA</th><th className="numero">Total</th><th>Estado</th></tr></thead>
          <tbody>
            {libroV.filas.map(f => (
              <tr key={f.folio}>
                <td>{f.folio}</td><td>{f.fecha}</td><td>{f.contraparteNombre}</td>
                <td className="numero">${f.baseMinor}</td><td className="numero">${f.ivaMinor}</td>
                <td className="numero">${f.totalMinor}</td><td>{f.estado}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="vacio">Sin ventas en el mes.</p>
      )}
      <div className="fila">
        <button onClick={() => void exportar('venta')}>Exportar libro de ventas (CSV interno)</button>
        <button onClick={() => void exportar('compra')}>Exportar libro de compras (CSV interno)</button>
        <button onClick={() => void guardarArchivo('venta')}>Guardar libro de ventas en archivo…</button>
        <button onClick={() => void guardarArchivo('compra')}>Guardar libro de compras en archivo…</button>
      </div>
      {exportacion && (
        <div>
          <p className="aviso">
            Exportación de {exportacion.mes} · libro de {exportacion.tipo === 'venta' ? 'ventas' : 'compras'} (versión {exportacion.version}).
            {exportacion.advertencia}
          </p>
          <pre>{exportacion.csv}</pre>
        </div>
      )}
      <h3>Libro de compras — {libroC?.ivaMinor ?? '0.00'} de IVA</h3>
      {libroC && libroC.filas.length > 0 ? (
        <table>
          <thead><tr><th>Folio</th><th>Fecha</th><th>Proveedor</th><th className="numero">Base</th><th className="numero">IVA</th><th className="numero">Total</th><th>Estado</th></tr></thead>
          <tbody>
            {libroC.filas.map(f => (
              <tr key={f.folio}>
                <td>{f.folio}</td><td>{f.fecha}</td><td>{f.contraparteNombre}</td>
                <td className="numero">${f.baseMinor}</td><td className="numero">${f.ivaMinor}</td>
                <td className="numero">${f.totalMinor}</td><td>{f.estado}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="vacio">Sin compras en el mes.</p>
      )}

      {estadoResultados && Array.isArray(estadoResultados.filas) && (
        <>
          <h2>Estado de resultados de {estadoResultados.mes}</h2>
          <table>
            <thead><tr><th>Cuenta</th><th>Tipo</th><th className="numero">Importe</th></tr></thead>
            <tbody>
              {estadoResultados.filas.map(f => (
                <tr key={f.codigo}>
                  <td>{f.codigo} · {f.nombre}</td>
                  <td>{f.tipo}</td>
                  <td className="numero">${f.importeMinor}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <table>
            <tbody>
              <tr><td>Ingresos</td><td className="numero">${estadoResultados.ingresosMinor}</td></tr>
              <tr><td>Costos y gastos</td><td className="numero">${estadoResultados.costosGastosMinor}</td></tr>
              <tr><td>Resultado del mes</td><td className="numero">${estadoResultados.resultadoMinor}</td></tr>
            </tbody>
          </table>
        </>
      )}

      <form onSubmit={registrarRetencion}>
        <h2>Retenciones (control)</h2>
        <div className="fila">
          <label>Tipo
            <select value={retTipo} onChange={e => setRetTipo(e.target.value as 'efectuada' | 'recibida')}>
              <option value="efectuada">Efectuada (retenemos)</option>
              <option value="recibida">Recibida (nos retienen)</option>
            </select>
          </label>
          <label>Contraparte
            <select value={retContraparte} onChange={e => setRetContraparte(Number(e.target.value))} required>
              <option value={0}>— Seleccione —</option>
              {contrapartes.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </label>
          <label>Fecha<input type="date" value={retFecha} onChange={e => setRetFecha(e.target.value)} required /></label>
          <label>Base<input value={retBase} onChange={e => setRetBase(e.target.value)} required placeholder="0.00" /></label>
          <label>Tasa %<input value={retTasa} onChange={e => setRetTasa(e.target.value)} required /></label>
        </div>
        <div className="fila">
          <label style={{ flex: 2 }}>Regla aplicada<input value={retRegla} onChange={e => setRetRegla(e.target.value)} required /></label>
          <label>Comprobante<input value={retComprobante} onChange={e => setRetComprobante(e.target.value)} /></label>
          <label style={{ flex: 2 }}>Concepto<input value={retConcepto} onChange={e => setRetConcepto(e.target.value)} required /></label>
          <button className="primario" type="submit">Registrar retención</button>
        </div>
        <p className="menor">Registro de control con base, regla, contraparte y comprobante; sin efecto contable automático hasta que la política del contador lo determine.</p>
      </form>
      {retenciones.length === 0 ? (
        <p className="vacio">Sin retenciones registradas.</p>
      ) : (
        <table>
          <thead><tr><th>Folio</th><th>Tipo</th><th>Contraparte</th><th>Fecha</th><th className="numero">Base</th><th className="numero">Retención</th><th>Regla</th></tr></thead>
          <tbody>
            {retenciones.map(r => (
              <tr key={r.id}>
                <td>{r.folio}</td><td>{r.tipo}</td><td>{r.contraparteNombre}</td><td>{r.fecha}</td>
                <td className="numero">${r.baseMinor}</td><td className="numero">${r.montoMinor}</td><td>{r.regla}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <h2>Anexo 1 F-07 v14 (ventas a contribuyentes)</h2>
      <p className="aviso error">
        Estructura oficial F-07 v14 (DGII, Enero 2025). El archivo de presentación permanece BLOQUEADO
        mientras falten metadatos fiscales o no exista vigencia con IVA inscrito que cubra el mes;
        ARKON no está constituida ni inscrita. El diagnóstico es interno y no genera archivo.
      </p>
      <div className="fila">
        <label>Período del anexo (AAAA-MM)
          <input value={anexoMes} onChange={e => setAnexoMes(e.target.value)} placeholder="2026-11" />
        </label>
        <button type="button" disabled={!/^\d{4}-\d{2}$/.test(anexoMes)} onClick={() => void diagnosticarAnexo()}>
          Diagnosticar
        </button>
        <button type="button" disabled={!/^\d{4}-\d{2}$/.test(anexoMes)} onClick={() => void guardarAnexo()}>
          Guardar anexo de presentación…
        </button>
      </div>
      {anexoDiagnostico && (
        <div>
          <p className="menor">
            Folios listos: {anexoDiagnostico.listos.length}. {anexoDiagnostico.bloqueado
              ? `BLOQUEADO: ${anexoDiagnostico.motivo}`
              : 'Sin faltantes para el mes.'}
          </p>
          {anexoDiagnostico.folios.map(f => (
            <p key={f.folio} className="menor">
              {f.folio}: {f.faltantes.join(' · ')}{' '}
              <button type="button" onClick={() => void seleccionarDocumento(f.documentoId)}>Completar…</button>
            </p>
          ))}
        </div>
      )}
      <h3>Completar metadatos fiscales (vía auditada)</h3>
      <form onSubmit={async e => {
        e.preventDefault();
        setMensaje(null);
        try {
          await api().invocar('fiscal:metadatosCompletar', {
            tipo: 'venta',
            documentoId: metaDocumentoId,
            claseDocumentoFiscal: metaClase,
            numeroResolucion: metaResolucion,
            serieDocumento: metaSerie,
            numeroDocumentoAutorizado: metaNumero,
            tratamientoVenta: metaTratamiento || undefined,
            tipoOperacionRenta: metaOperacionRenta,
            tipoIngresoRenta: metaIngresoRenta,
            responsable: metaResponsable,
            motivo: metaMotivo
          });
          setMensaje({ texto: 'Metadatos fiscales registrados en bitácora.', tipo: 'ok' });
          await seleccionarDocumento(metaDocumentoId);
          cargarVentasSelector(metaBusqueda);
          if (/^\d{4}-\d{2}$/.test(anexoMes)) {
            await diagnosticarAnexo();
          }
        } catch (err) {
          setMensaje({ texto: String(err instanceof Error ? err.message : err), tipo: 'error' });
        }
      }}>
        <div className="fila">
          <label>Buscar venta
            <input
              value={metaBusqueda}
              onChange={e => {
                setMetaBusqueda(e.target.value);
                cargarVentasSelector(e.target.value);
              }}
              placeholder="Folio o concepto"
            />
          </label>
          <label style={{ minWidth: 280 }}>Venta
            <select value={String(metaDocumentoId)} onChange={e => void seleccionarDocumento(Number(e.target.value))} required>
              <option value="0">— Seleccione venta —</option>
              {ventasSelector.map(v => (
                <option key={v.id} value={String(v.id)}>{v.folio} · {v.concepto} ({v.fecha})</option>
              ))}
            </select>
          </label>
        </div>
        {metaActual && (
          <p className="menor">
            Documento seleccionado: {metaActual.folio} del {metaActual.fecha} · {metaActual.contraparte}.
            {metaActual.clase_documento_fiscal ? ` Clase actual: ${metaActual.clase_documento_fiscal}.` : ' Sin metadatos previos.'}
          </p>
        )}
        <div className="fila">
          <label>Clase (1/2/4)
            <select value={metaClase} onChange={e => setMetaClase(e.target.value)}>
              <option value="1">1 Imprenta/tiquetes</option>
              <option value="2">2 Formulario único</option>
              <option value="4">4 DTE</option>
            </select>
          </label>
          <label>Resolución<input value={metaResolucion} onChange={e => setMetaResolucion(e.target.value)} required /></label>
          <label>Serie<input value={metaSerie} onChange={e => setMetaSerie(e.target.value)} required /></label>
        </div>
        <div className="fila">
          <label>Número autorizado<input value={metaNumero} onChange={e => setMetaNumero(e.target.value)} required /></label>
          <label>Tratamiento sin IVA
            <select value={metaTratamiento} onChange={e => setMetaTratamiento(e.target.value)}>
              <option value="">— Solo si IVA 0 —</option>
              <option value="exenta">Exenta</option>
              <option value="no_sujeta">No sujeta</option>
            </select>
          </label>
          <label>Tipo operación Renta (R)
            <select value={metaOperacionRenta} onChange={e => setMetaOperacionRenta(e.target.value)} required>
              <option value="">— Seleccione —</option>
              <option value="1">1 Gravada</option>
              <option value="2">2 No gravada o exento</option>
              <option value="3">3 Excluido</option>
              <option value="4">4 Mixta</option>
              <option value="12">12 Retenido F910</option>
              <option value="13">13 Excluido art. 6 LISR</option>
            </select>
          </label>
          <label>Tipo ingreso Renta (S)
            <select value={metaIngresoRenta} onChange={e => setMetaIngresoRenta(e.target.value)} required>
              <option value="">— Seleccione —</option>
              <option value="1">1 Profesiones</option>
              <option value="2">2 Servicios</option>
              <option value="3">3 Comerciales</option>
              <option value="4">4 Industriales</option>
              <option value="5">5 Agropecuarias</option>
              <option value="10">10 Otras</option>
            </select>
          </label>
        </div>
        <div className="fila">
          <label>Responsable<input value={metaResponsable} onChange={e => setMetaResponsable(e.target.value)} required /></label>
          <label style={{ flex: 2 }}>Motivo<input value={metaMotivo} onChange={e => setMetaMotivo(e.target.value)} required /></label>
          <button className="primario" type="submit" disabled={metaCargando || !metaDocumentoId}>
            {metaCargando ? 'Cargando documento…' : 'Registrar metadatos'}
          </button>
        </div>
      </form>
    </div>
  );

  function cargarVentasSelector(busqueda: string) {
    void api()
      .invocar('documento:listarVinculos', { busqueda, limite: 200 })
      .then(r => {
        const vinculos = r as { venta: Array<{ id: number; folio: string; concepto: string; fecha: string }> };
        setVentasSelector(vinculos.venta ?? []);
      })
      .catch(() => setVentasSelector([]));
  }

  async function seleccionarDocumento(documentoId: number) {
    const numeroConsulta = ++consultaMeta.current;
    if (!documentoId) {
      setMetaDocumentoId(0);
      setMetaActual(null);
      setMetaCargando(false);
      return;
    }
    setMetaDocumentoId(documentoId);
    setMetaActual(null);
    setMetaCargando(true);
    try {
      const r = (await api().invocar('fiscal:metadatosLeer', { documentoId })) as {
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
      };
      if (consultaMeta.current !== numeroConsulta) {
        return;
      }
      setMetaDocumentoId(r.id);
      setMetaActual(r);
      setMetaClase(r.clase_documento_fiscal ?? '1');
      setMetaResolucion(r.numero_resolucion ?? '');
      setMetaSerie(r.serie_documento ?? '');
      setMetaNumero(r.numero_documento_autorizado ?? '');
      setMetaTratamiento(r.tratamiento_venta ?? '');
      setMetaOperacionRenta(r.tipo_operacion_renta ?? '');
      setMetaIngresoRenta(r.tipo_ingreso_renta ?? '');
    } catch (err) {
      if (consultaMeta.current === numeroConsulta) {
        setMetaDocumentoId(0);
        setMensaje({ texto: `No se pudo cargar la venta ${documentoId}: ${String(err instanceof Error ? err.message : err)}`, tipo: 'error' });
      }
    } finally {
      if (consultaMeta.current === numeroConsulta) {
        setMetaCargando(false);
      }
    }
  }

  async function diagnosticarAnexo() {
    try {
      const r = (await api().invocar('fiscal:anexo1Ventas', { mes: anexoMes })) as {
        folios: Array<{ folio: string; documentoId: number; faltantes: string[] }>;
        listos: string[];
        bloqueado: boolean;
        motivo: string;
      };
      setAnexoDiagnostico(r);
    } catch (err) {
      setMensaje({ texto: String(err instanceof Error ? err.message : err), tipo: 'error' });
    }
  }

  async function guardarAnexo() {
    try {
      const r = (await api().guardarAnexoF07(1, anexoMes)) as { guardado: boolean; ruta?: string; filas: number };
      if (r.guardado && r.ruta) {
        setMensaje({ texto: `Anexo guardado en ${r.ruta} (${r.filas} filas).`, tipo: 'ok' });
      } else {
        setMensaje({ texto: 'Guardado del anexo cancelado.', tipo: 'ok' });
      }
    } catch (err) {
      setMensaje({ texto: String(err instanceof Error ? err.message : err), tipo: 'error' });
    }
  }
}
