import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { VentaResumen, CompraResumen } from '../../shared/contratos';
import { fechaLocalElSalvador } from '../../shared/fechas';
import { minorATexto } from '../../shared/dinero';

interface Contraparte { id: number; nombre: string; esCliente: boolean; esProveedor: boolean }
interface Cuenta { id: number; nombre: string; codigo: string }

function nuevaClave(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `op-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

type Modo = 'cobro' | 'pago' | 'anticipo';

export default function CobrosPagos() {
  const [modo, setModo] = useState<Modo>('cobro');
  const [tipoAnticipo, setTipoAnticipo] = useState<'cliente' | 'proveedor'>('cliente');
  const [contrapartes, setContrapartes] = useState<Contraparte[]>([]);
  const [cuentas, setCuentas] = useState<Cuenta[]>([]);
  const [ventas, setVentas] = useState<VentaResumen[]>([]);
  const [compras, setCompras] = useState<CompraResumen[]>([]);
  const [contraparteId, setContraparteId] = useState(0);
  const [cuentaId, setCuentaId] = useState(0);
  const [fecha, setFecha] = useState(fechaLocalElSalvador());
  const [monto, setMonto] = useState('');
  const [concepto, setConcepto] = useState('');
  const [aplicaciones, setAplicaciones] = useState<Array<{ documentoId: number; monto: string }>>([]);
  const [documentoAnticipo, setDocumentoAnticipo] = useState(0);
  const [montoAnticipo, setMontoAnticipo] = useState('');
  const [saldoAnticipo, setSaldoAnticipo] = useState<string | null>(null);
  const [saldoAnticipoCargando, setSaldoAnticipoCargando] = useState(false);
  const consultaSaldoId = useRef(0);
  const seleccionRef = useRef({ modo: 'cobro' as Modo, tipo: 'cliente' as 'cliente' | 'proveedor', contraparte: 0 });
  seleccionRef.current = { modo, tipo: tipoAnticipo, contraparte: contraparteId };
  const [responsable, setResponsable] = useState('');
  const [mensaje, setMensaje] = useState<{ texto: string; tipo: 'ok' | 'error' } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const clave = useRef(nuevaClave());

  const cargar = useCallback(() => {
    const conError = (err: unknown) =>
      setMensaje({ texto: String(err instanceof Error ? err.message : err), tipo: 'error' });
    api().invocar('contraparte:listar').then(r => setContrapartes(r as Contraparte[])).catch(conError);
    api().invocar('cuenta:listar').then(r => setCuentas((r as Cuenta[]).filter((c) => ['1101', '1102', '1103'].includes(c.codigo)))).catch(conError);
    api().invocar('venta:listar').then(r => setVentas((r as VentaResumen[]).filter(v => v.estado === 'registrada'))).catch(conError);
    api().invocar('compra:listar').then(r => setCompras((r as CompraResumen[]).filter(c => c.estado === 'registrada'))).catch(conError);
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const consultarSaldoAnticipo = useCallback(() => {
    const id = ++consultaSaldoId.current;
    if (modo !== 'anticipo' || !contraparteId) {
      setSaldoAnticipo(null);
      setSaldoAnticipoCargando(false);
      return;
    }
    const seleccion = { modo, tipo: tipoAnticipo, contraparte: contraparteId };
    setSaldoAnticipoCargando(true);
    api()
      .invocar('anticipo:saldo', { tipo: tipoAnticipo, contraparteId })
      .then(r => {
        if (consultaSaldoId.current !== id) {
          return;
        }
        const actual = seleccionRef.current;
        if (actual.modo !== seleccion.modo || actual.tipo !== seleccion.tipo || actual.contraparte !== seleccion.contraparte) {
          return;
        }
        setSaldoAnticipo(String((r as { saldoMinor: string }).saldoMinor));
        setSaldoAnticipoCargando(false);
      })
      .catch(() => {
        if (consultaSaldoId.current !== id) {
          return;
        }
        const actual = seleccionRef.current;
        if (actual.modo !== seleccion.modo || actual.tipo !== seleccion.tipo || actual.contraparte !== seleccion.contraparte) {
          return;
        }
        setSaldoAnticipo(null);
        setSaldoAnticipoCargando(false);
      });
  }, [modo, tipoAnticipo, contraparteId]);

  useEffect(() => {
    consultarSaldoAnticipo();
    return () => {
      consultaSaldoId.current++;
    };
  }, [consultarSaldoAnticipo]);

  const esAnticipo = modo === 'anticipo';
  const contrapartesVisibles = esAnticipo
    ? contrapartes.filter(c => (tipoAnticipo === 'cliente' ? c.esCliente : c.esProveedor))
    : contrapartes.filter(c => (modo === 'cobro' ? c.esCliente : c.esProveedor));
  const documentosFiltrados = (esAnticipo
    ? tipoAnticipo === 'cliente' ? ventas : compras
    : modo === 'pago' ? compras : ventas
  ).filter(d => d.contraparteId === contraparteId);

  function cambiarModo(nuevo: Modo) {
    setModo(nuevo);
    setAplicaciones([]);
    setDocumentoAnticipo(0);
    setMontoAnticipo('');
  }

  function cambiarTipoAnticipo(tipo: 'cliente' | 'proveedor') {
    setTipoAnticipo(tipo);
    setAplicaciones([]);
    setDocumentoAnticipo(0);
    setMontoAnticipo('');
  }

  function cambiarContraparte(id: number) {
    setContraparteId(id);
    setAplicaciones([]);
    setDocumentoAnticipo(0);
    setMontoAnticipo('');
  }

  async function registrar(e: React.FormEvent) {
    e.preventDefault();
    if (ocupado) {
      return;
    }
    setOcupado(true);
    setMensaje(null);
    try {
      let texto = '';
      if (esAnticipo) {
        if (!documentoAnticipo || !montoAnticipo) {
          setMensaje({ texto: 'Seleccione el documento y el monto a aplicar.', tipo: 'error' });
          setOcupado(false);
          return;
        }
        const r = (await api().invocar('anticipo:aplicar', {
          tipo: tipoAnticipo,
          contraparteId,
          documentoTipo: tipoAnticipo === 'cliente' ? 'venta' : 'compra',
          documentoId: documentoAnticipo,
          fechaOperacion: fecha,
          monto: montoAnticipo,
          claveIdempotencia: clave.current,
          responsable
        })) as { folio: string };
        texto = `Aplicación de anticipo ${r.folio} registrada sin mover dinero nuevo.`;
        setDocumentoAnticipo(0);
        setMontoAnticipo('');
        consultarSaldoAnticipo();
      } else {
        const comando = modo === 'cobro' ? 'cobro:registrar' : 'pago:registrar';
        const r = (await api().invocar(comando, {
          fechaOperacion: fecha,
          contraparteId,
          concepto,
          monto,
          aplicaciones: aplicaciones.map(a => ({
            documentoTipo: modo === 'cobro' ? 'venta' : 'compra',
            documentoId: a.documentoId,
            monto: a.monto
          })),
          claveIdempotencia: clave.current,
          responsable,
          ...(modo === 'cobro' ? { cuentaDestinoId: cuentaId } : { cuentaOrigenId: cuentaId })
        })) as { folio: string };
        texto = `${modo === 'cobro' ? 'Cobro' : 'Pago'} ${r.folio} registrado. El dinero no duplica el ingreso o gasto ya reconocido.`;
        setMonto('');
        setConcepto('');
        setAplicaciones([]);
      }
      setMensaje({ texto, tipo: 'ok' });
      clave.current = nuevaClave();
      cargar();
    } catch (err) {
      setMensaje({ texto: String(err instanceof Error ? err.message : err), tipo: 'error' });
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div>
      <h1>Cobros y pagos</h1>
      {mensaje && <p className={`aviso ${mensaje.tipo === 'error' ? 'error' : 'ok'}`}>{mensaje.texto}</p>}
      <form onSubmit={registrar}>
        <h2>
          {modo === 'cobro' ? 'Registrar cobro' : modo === 'pago' ? 'Registrar pago' : 'Aplicar anticipo existente'}
        </h2>
        <div className="fila">
          <label>Tipo
            <select value={modo} onChange={e => cambiarModo(e.target.value as Modo)} disabled={ocupado}>
              <option value="cobro">Cobro de cliente</option>
              <option value="pago">Pago a proveedor</option>
              <option value="anticipo">Aplicar anticipo existente</option>
            </select>
          </label>
          {esAnticipo && (
            <label>Anticipo de
              <select value={tipoAnticipo} onChange={e => cambiarTipoAnticipo(e.target.value as 'cliente' | 'proveedor')} disabled={ocupado}>
                <option value="cliente">Cliente (a una venta)</option>
                <option value="proveedor">Proveedor (a una compra)</option>
              </select>
            </label>
          )}
          <label>Contraparte
            <select value={contraparteId} onChange={e => cambiarContraparte(Number(e.target.value))} required disabled={ocupado}>
              <option value={0}>— Seleccione —</option>
              {contrapartesVisibles.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </label>
          <label>Fecha<input type="date" value={fecha} onChange={e => setFecha(e.target.value)} required /></label>
          <label>Responsable<input value={responsable} onChange={e => setResponsable(e.target.value)} required /></label>
        </div>
        {!esAnticipo && (
          <div className="fila">
            <label>Cuenta de efectivo
              <select value={cuentaId} onChange={e => setCuentaId(Number(e.target.value))} required>
                <option value={0}>— Seleccione —</option>
                {cuentas.map(c => <option key={c.id} value={c.id}>{c.codigo} · {c.nombre}</option>)}
              </select>
            </label>
            <label>Monto<input value={monto} onChange={e => setMonto(e.target.value)} required placeholder="0.00" /></label>
            <label style={{ flex: 2 }}>Concepto<input value={concepto} onChange={e => setConcepto(e.target.value)} required /></label>
          </div>
        )}
        {esAnticipo && saldoAnticipoCargando && <p className="menor">Consultando saldo de anticipo…</p>}
        {esAnticipo && !saldoAnticipoCargando && saldoAnticipo !== null && (
          <p className="menor">Saldo de anticipo disponible: ${minorATexto(BigInt(saldoAnticipo))}.</p>
        )}
        {esAnticipo ? (
          <div className="fila">
            <label style={{ flex: 2 }}>Documento a aplicar
              <select value={documentoAnticipo} onChange={e => setDocumentoAnticipo(Number(e.target.value))} required disabled={ocupado}>
                <option value={0}>— Seleccione —</option>
                {documentosFiltrados.map(d => (
                  <option key={d.id} value={d.id}>{d.folio} · {d.concepto} (saldo ${d.saldoMinor})</option>
                ))}
              </select>
            </label>
            <label>Monto a aplicar<input value={montoAnticipo} onChange={e => setMontoAnticipo(e.target.value)} required placeholder="0.00" /></label>
          </div>
        ) : (
          <>
            <h3>Aplicación a documentos (opcional; el excedente queda como anticipo)</h3>
            {documentosFiltrados.length === 0 ? (
              <p className="menor">Sin documentos pendientes para la contraparte seleccionada.</p>
            ) : (
              documentosFiltrados.map(d => (
                <div className="fila" key={d.id}>
                  <label style={{ flex: 2 }}>
                    {d.folio} · {d.concepto} (saldo ${d.saldoMinor})
                    <input
                      placeholder="Monto a aplicar"
                      value={aplicaciones.find(a => a.documentoId === d.id)?.monto ?? ''}
                      onChange={e => {
                        const valor = e.target.value;
                        setAplicaciones(prev => {
                          const sin = prev.filter(a => a.documentoId !== d.id);
                          return valor ? [...sin, { documentoId: d.id, monto: valor }] : sin;
                        });
                      }}
                    />
                  </label>
                </div>
              ))
            )}
          </>
        )}
        <div className="fila">
          <button className="primario" type="submit" disabled={ocupado}>{ocupado ? 'Registrando…' : 'Registrar'}</button>
        </div>
      </form>
    </div>
  );
}
