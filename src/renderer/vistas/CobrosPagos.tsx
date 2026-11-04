import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { fechaLocalElSalvador } from '../../shared/fechas';

interface Contraparte { id: number; nombre: string; esCliente: boolean; esProveedor: boolean }
interface Cuenta { id: number; nombre: string; codigo: string }
interface Venta { id: number; folio: string; concepto: string; contraparteNombre: string; totalMinor: string; saldoMinor: string; estado: string }
interface Compra { id: number; folio: string; concepto: string; contraparteNombre: string; totalMinor: string; saldoMinor: string; estado: string }

function nuevaClave(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `op-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function CobrosPagos() {
  const [modo, setModo] = useState<'cobro' | 'pago'>('cobro');
  const [contrapartes, setContrapartes] = useState<Contraparte[]>([]);
  const [cuentas, setCuentas] = useState<Cuenta[]>([]);
  const [ventas, setVentas] = useState<Venta[]>([]);
  const [compras, setCompras] = useState<Compra[]>([]);
  const [contraparteId, setContraparteId] = useState(0);
  const [cuentaId, setCuentaId] = useState(0);
  const [fecha, setFecha] = useState(fechaLocalElSalvador());
  const [monto, setMonto] = useState('');
  const [concepto, setConcepto] = useState('');
  const [aplicaciones, setAplicaciones] = useState<Array<{ documentoId: number; monto: string }>>([]);
  const [responsable, setResponsable] = useState('');
  const [mensaje, setMensaje] = useState<{ texto: string; tipo: 'ok' | 'error' } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const clave = useRef(nuevaClave());

  const cargar = useCallback(() => {
    void api().invocar('contraparte:listar').then(r => setContrapartes(r as Contraparte[]));
    void api().invocar('cuenta:listar').then(r => setCuentas((r as Cuenta[]).filter((c) => ['1101', '1102', '1103'].includes(c.codigo))));
    void api().invocar('venta:listar').then(r => setVentas((r as Venta[]).filter(v => v.estado === 'registrada')));
    void api().invocar('compra:listar').then(r => setCompras((r as Compra[]).filter(c => c.estado === 'registrada')));
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const documentos = modo === 'cobro' ? ventas : compras;

  async function registrar(e: React.FormEvent) {
    e.preventDefault();
    if (ocupado) {
      return;
    }
    setOcupado(true);
    setMensaje(null);
    const comando = modo === 'cobro' ? 'cobro:registrar' : 'pago:registrar';
    const payload = {
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
    };
    try {
      const r = (await api().invocar(comando, payload)) as { folio: string };
      setMensaje({ texto: `${modo === 'cobro' ? 'Cobro' : 'Pago'} ${r.folio} registrado. El dinero no duplica el ingreso o gasto ya reconocido.` , tipo: 'ok' });
      setMonto('');
      setConcepto('');
      setAplicaciones([]);
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
        <h2>{modo === 'cobro' ? 'Registrar cobro' : 'Registrar pago'}</h2>
        <div className="fila">
          <label>Tipo
            <select value={modo} onChange={e => { setModo(e.target.value as 'cobro' | 'pago'); setAplicaciones([]); }}>
              <option value="cobro">Cobro de cliente</option>
              <option value="pago">Pago a proveedor</option>
            </select>
          </label>
          <label>Contraparte
            <select value={contraparteId} onChange={e => setContraparteId(Number(e.target.value))} required>
              <option value={0}>— Seleccione —</option>
              {contrapartes
                .filter(c => (modo === 'cobro' ? c.esCliente : c.esProveedor))
                .map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </label>
          <label>Cuenta de efectivo
            <select value={cuentaId} onChange={e => setCuentaId(Number(e.target.value))} required>
              <option value={0}>— Seleccione —</option>
              {cuentas.map(c => <option key={c.id} value={c.id}>{c.codigo} · {c.nombre}</option>)}
            </select>
          </label>
          <label>Fecha<input type="date" value={fecha} onChange={e => setFecha(e.target.value)} required /></label>
          <label>Monto<input value={monto} onChange={e => setMonto(e.target.value)} required placeholder="0.00" /></label>
          <label style={{ flex: 2 }}>Concepto<input value={concepto} onChange={e => setConcepto(e.target.value)} required /></label>
          <label>Responsable<input value={responsable} onChange={e => setResponsable(e.target.value)} required /></label>
        </div>
        <h3>Aplicación a documentos (opcional; el excedente queda como anticipo)</h3>
        {documentos.length === 0 ? (
          <p className="menor">Sin documentos pendientes de {modo === 'cobro' ? 'cobro' : 'pago'}.</p>
        ) : (
          documentos.map(d => (
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
        <div className="fila">
          <button className="primario" type="submit" disabled={ocupado}>{ocupado ? 'Registrando…' : 'Registrar'}</button>
        </div>
      </form>
    </div>
  );
}
