import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { VentaResumen } from '../../shared/contratos';
import { fechaLocalElSalvador } from '../../shared/fechas';
import { limpiarMensajeError } from '../limpiarMensajeError';

interface Contraparte { id: number; nombre: string; esCliente: boolean }
interface Proyecto { id: number; codigo: string; nombre: string }

function nuevaClave(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `op-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function Ventas() {
  const [ventas, setVentas] = useState<VentaResumen[]>([]);
  const [clientes, setClientes] = useState<Contraparte[]>([]);
  const [proyectos, setProyectos] = useState<Proyecto[]>([]);
  const [contraparteId, setContraparteId] = useState(0);
  const [proyectoId, setProyectoId] = useState(0);
  const [fecha, setFecha] = useState(fechaLocalElSalvador());
  const [concepto, setConcepto] = useState('');
  const [tipoIngreso, setTipoIngreso] = useState<'instalaciones' | 'oym'>('instalaciones');
  const [clasificacion, setClasificacion] = useState('');
  const [tipoDocumento, setTipoDocumento] = useState('');
  const [base, setBase] = useState('');
  const [tasa, setTasa] = useState('0');
  const [responsable, setResponsable] = useState('');
  const [mensaje, setMensaje] = useState<{ texto: string; tipo: 'ok' | 'error' } | null>(null);
  const [clasificando, setClasificando] = useState<VentaResumen | null>(null);
  const [clasValor, setClasValor] = useState('');
  const [tipoDocValor, setTipoDocValor] = useState('');
  const [motivoClas, setMotivoClas] = useState('');
  const [mesFiltro, setMesFiltro] = useState('');
  const [pagina, setPagina] = useState(0);
  const [ocupado, setOcupado] = useState(false);
  const clave = useRef(nuevaClave());

  const cargaDocumentosId = useRef(0);

  const cargarCatalogos = useCallback(() => {
    void api().invocar('contraparte:listar').then(r => setClientes((r as Contraparte[]).filter(c => c.esCliente)));
    void api().invocar('proyecto:listar').then(r => setProyectos(r as Proyecto[]));
  }, []);

  const cargarDocumentos = useCallback(() => {
    const id = ++cargaDocumentosId.current;
    api()
      .invocar('venta:listar', { mes: mesFiltro || undefined, limite: 100, desde: pagina * 100 })
      .then(r => {
        if (cargaDocumentosId.current === id) {
          setVentas(r as VentaResumen[]);
        }
      })
      .catch(err => {
        if (cargaDocumentosId.current === id) {
          setMensaje({ texto: limpiarMensajeError(err), tipo: 'error' });
        }
      });
  }, [mesFiltro, pagina]);

  useEffect(() => {
    cargarCatalogos();
  }, [cargarCatalogos]);

  useEffect(() => {
    cargarDocumentos();
  }, [cargarDocumentos]);

  async function registrar(e: React.FormEvent) {
    e.preventDefault();
    if (ocupado) {
      return;
    }
    setOcupado(true);
    setMensaje(null);
    try {
      const r = (await api().invocar('venta:registrar', {
        contraparteId,
        proyectoId: proyectoId || undefined,
        fechaOperacion: fecha,
        concepto,
        tipoIngreso,
        clasificacionDocumento: clasificacion || undefined,
        tipoDocumento: tipoDocumento || undefined,
        base,
        tasa,
        claveIdempotencia: clave.current,
        responsable
      })) as { folio: string };
      setMensaje({ texto: `Venta ${r.folio} reconocida. El cobro posterior no duplica el ingreso.`, tipo: 'ok' });
      setConcepto('');
      setBase('');
      clave.current = nuevaClave();
      cargarDocumentos();
      setTimeout(() => { if (typeof avisoRef.current?.scrollIntoView === 'function') { avisoRef.current.scrollIntoView({ block: 'center' }); } }, 0);
    } catch (err) {
      setMensaje({ texto: limpiarMensajeError(err), tipo: 'error' });
    } finally {
      setOcupado(false);
    }
  }

  const [anulando, setAnulando] = useState<VentaResumen | null>(null);
  const [motivoAnular, setMotivoAnular] = useState('');
  const [responsableAnular, setResponsableAnular] = useState('');
  const [ocupadoAnular, setOcupadoAnular] = useState(false);
  const [errorAnular, setErrorAnular] = useState<string | null>(null);
  const avisoRef = useRef<HTMLParagraphElement | null>(null);
  const origenAnulacionRef = useRef<HTMLButtonElement | null>(null);

  function abrirAnulacion(v: VentaResumen, origen: HTMLButtonElement) {
    origenAnulacionRef.current = origen;
    setAnulando(v);
    setMotivoAnular('');
    setResponsableAnular(responsable.trim());
    setErrorAnular(null);
  }

  useEffect(() => {
    if (!anulando) {
      return;
    }
    const alPresionar = (evento: KeyboardEvent) => {
      if (evento.key === 'Escape') {
        cancelarAnulacion();
        origenAnulacionRef.current?.focus();
      }
    };
    document.addEventListener('keydown', alPresionar);
    return () => document.removeEventListener('keydown', alPresionar);
  }, [anulando]);

  function cancelarAnulacion() {
    setAnulando(null);
    setMotivoAnular('');
    setResponsableAnular('');
    setOcupadoAnular(false);
    setErrorAnular(null);
  }

  async function confirmarAnulacion(e: React.FormEvent) {
    e.preventDefault();
    if (!anulando || ocupadoAnular) {
      return;
    }
    if (motivoAnular.trim().length < 10) {
      setErrorAnular('La anulación exige un motivo significativo (mínimo 10 caracteres).');
      return;
    }
    if (!responsableAnular.trim()) {
      setErrorAnular('La anulación exige responsable.');
      return;
    }
    setOcupadoAnular(true);
    setMensaje(null);
    try {
      await api().invocar('documento:anular', {
        tipo: 'venta',
        documentoId: anulando.id,
        responsable: responsableAnular.trim(),
        motivo: motivoAnular.trim()
      });
      setMensaje({ texto: `Venta ${anulando.folio} anulada con reverso contable; motivo registrado en bitácora.`, tipo: 'ok' });
      setAnulando(null);
      setMotivoAnular('');
      setResponsableAnular('');
      cargarDocumentos();
      setTimeout(() => { if (typeof avisoRef.current?.scrollIntoView === 'function') { avisoRef.current.scrollIntoView({ block: 'center' }); } }, 0);
    } catch (err) {
      setErrorAnular(limpiarMensajeError(err));
    } finally {
      setOcupadoAnular(false);
    }
  }

  return (
    <div>
      <h1>Ventas reconocidas</h1>
      <p ref={avisoRef}>{mensaje && <span className={`aviso ${mensaje.tipo === 'error' ? 'error' : 'ok'}`}>{mensaje.texto}</span>}</p>
      <form onSubmit={registrar}>
        <h2>Registrar venta reconocida</h2>
        <div className="fila">
          <label>Cliente
            <select value={contraparteId} onChange={e => setContraparteId(Number(e.target.value))} required>
              <option value={0}>— Seleccione —</option>
              {clientes.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </label>
          <label>Proyecto (opcional)
            <select value={proyectoId} onChange={e => setProyectoId(Number(e.target.value))}>
              <option value={0}>— Ninguno —</option>
              {proyectos.map(p => <option key={p.id} value={p.id}>{p.codigo} · {p.nombre}</option>)}
            </select>
          </label>
          <label>Fecha<input type="date" value={fecha} onChange={e => setFecha(e.target.value)} required /></label>
          <label style={{ flex: 2 }}>Concepto<input value={concepto} onChange={e => setConcepto(e.target.value)} required /></label>
        </div>
        <div className="fila">
          <label>Tipo de ingreso
            <select value={tipoIngreso} onChange={e => setTipoIngreso(e.target.value as 'instalaciones' | 'oym')}>
              <option value="instalaciones">Instalaciones</option>
              <option value="oym">Operación y mantenimiento</option>
            </select>
          </label>
          <label>Clasificación del receptor
            <select value={clasificacion} onChange={e => setClasificacion(e.target.value)}>
              <option value="">— Pendiente —</option>
              <option value="contribuyente">Contribuyente</option>
              <option value="consumidor_final">Consumidor final</option>
              <option value="otro">Otro</option>
            </select>
          </label>
          <label>Tipo de documento
            <select value={tipoDocumento} onChange={e => setTipoDocumento(e.target.value)}>
              <option value="">— Pendiente —</option>
              <option value="factura">Factura</option>
              <option value="ccf">Crédito fiscal</option>
              <option value="recibo">Recibo</option>
              <option value="otro">Otro</option>
            </select>
          </label>
          <label>Base (sin IVA)<input value={base} onChange={e => setBase(e.target.value)} required placeholder="0.00" /></label>
          <label>Tasa IVA %<input value={tasa} onChange={e => setTasa(e.target.value)} /></label>
          <label>Responsable<input value={responsable} onChange={e => setResponsable(e.target.value)} required /></label>
          <button className="primario" type="submit" disabled={ocupado}>{ocupado ? 'Registrando…' : 'Registrar venta'}</button>
        </div>
        <p className="menor">
          La clasificación tributaria y el tipo documental son necesarios para la exportación de trabajo; los documentos sin clasificar bloquean la exportación. No se emiten documentos fiscales electrónicos.
        </p>
        <p className="menor">
          Una cotización aprobada no es una venta: registre el reconocimiento cuando el servicio se presta.
          Sin inscripción de IVA vigente, la tasa debe ser 0.
        </p>
      </form>
      {clasificando && (
        <form onSubmit={async e => {
          e.preventDefault();
          if (!clasValor || !tipoDocValor) {
            setMensaje({ texto: 'Seleccione clasificación y tipo documental; no se sustituye un valor conocido por un predeterminado.', tipo: 'error' });
            return;
          }
          try {
            await api().invocar('documento:clasificar', {
              tipo: 'venta',
              documentoId: clasificando.id,
              clasificacionDocumento: clasValor,
              tipoDocumento: tipoDocValor,
              responsable,
              motivo: motivoClas
            });
            setMensaje({ texto: `Clasificación de ${clasificando.folio} completada; acción auditada sin tocar importes ni asiento.`, tipo: 'ok' });
            setClasificando(null);
            cargarDocumentos();
          } catch (err) {
            setMensaje({ texto: limpiarMensajeError(err), tipo: 'error' });
          }
        }}>
          <h2>Clasificar {clasificando.folio}</h2>
          <div className="fila">
            <label>Clasificación
              <select value={clasValor} onChange={e => setClasValor(e.target.value)} required>
                <option value="">— Seleccione —</option>
                <option value="contribuyente">Contribuyente</option>
                <option value="consumidor_final">Consumidor final</option>
                <option value="otro">Otro</option>
              </select>
            </label>
            <label>Tipo de documento
              <select value={tipoDocValor} onChange={e => setTipoDocValor(e.target.value)} required>
                <option value="">— Seleccione —</option>
                <option value="factura">Factura</option>
                <option value="ccf">Crédito fiscal</option>
                <option value="recibo">Recibo</option>
                <option value="otro">Otro</option>
              </select>
            </label>
            <label style={{ flex: 2 }}>Motivo (obligatorio)<input value={motivoClas} onChange={e => setMotivoClas(e.target.value)} required /></label>
            <button className="primario" type="submit">Completar clasificación</button>
            <button type="button" onClick={() => setClasificando(null)}>Cancelar</button>
          </div>
        </form>
      )}
      <h2>{mesFiltro ? `Ventas de ${mesFiltro}` : 'Ventas recientes'}</h2>
      <div className="fila">
        <label>Filtrar por mes (vacío = recientes)<input type="month" value={mesFiltro} onChange={e => { setMesFiltro(e.target.value); setPagina(0); }} /></label>
        <button onClick={() => setPagina(p => Math.max(0, p - 1))} disabled={pagina === 0}>Anteriores</button>
        <button onClick={() => setPagina(p => p + 1)} disabled={ventas.length < 100}>Siguientes</button>
      </div>
      {ventas.length === 0 ? (
        <p className="vacio">Sin ventas reconocidas.</p>
      ) : (
        <table>
          <thead><tr><th>Folio</th><th>Fecha</th><th>Concepto</th><th>Cliente</th><th className="numero">Total</th><th className="numero">Saldo</th><th>Estado</th><th>Clasificación</th><th></th></tr></thead>
          <tbody>
            {ventas.map(v => (
              <tr key={v.id}>
                <td>{v.folio}</td>
                <td>{v.fecha}</td>
                <td>{v.concepto}</td>
                <td>{v.contraparteNombre}</td>
                <td className="numero">${v.totalMinor}</td>
                <td className="numero">${v.saldoMinor}</td>
                <td>{v.estado}</td>
                <td>{v.clasificacionDocumento && v.tipoDocumento ? `${v.clasificacionDocumento} · ${v.tipoDocumento}` : 'Pendiente'}</td>
                <td>
                  {v.estado === 'registrada' && (
                    <button onClick={() => {
                      setClasificando(v);
                      setClasValor(v.clasificacionDocumento ?? '');
                      setTipoDocValor(v.tipoDocumento ?? '');
                      setMotivoClas('');
                    }}>Clasificar</button>
                  )}
                  {v.estado === 'registrada' && <button onClick={e => abrirAnulacion(v, e.currentTarget)}>Anular</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {anulando && (
        <div className="aviso" role="dialog" aria-label={`Anular venta ${anulando.folio}`}>
          <h3>Anular venta {anulando.folio}</h3>
          <p className="menor">
            Importe: ${anulando.totalMinor} · Saldo: ${anulando.saldoMinor} · Efecto: se genera un reverso
            contable que cancela el asiento original; el motivo y el responsable quedan en bitácora.
          </p>
          {errorAnular && <p role="alert" className="aviso error">{errorAnular}</p>}
          <form onSubmit={confirmarAnulacion}>
            <div className="fila">
              <label style={{ flex: 2 }}>Motivo de la anulación
                <input value={motivoAnular} onChange={e => setMotivoAnular(e.target.value)} required autoFocus placeholder="Motivo significativo" />
              </label>
              <label>Responsable
                <input value={responsableAnular} onChange={e => setResponsableAnular(e.target.value)} required />
              </label>
            </div>
            <div className="fila">
              <button className="peligro" type="submit" disabled={ocupadoAnular}>
                {ocupadoAnular ? 'Anulando…' : `Sí, anular ${anulando.folio}`}
              </button>
              <button type="button" onClick={cancelarAnulacion}>Cancelar</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
