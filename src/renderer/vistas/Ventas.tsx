import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { VentaResumen } from '../../shared/contratos';
import { fechaLocalElSalvador } from '../../shared/fechas';

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
  const [ocupado, setOcupado] = useState(false);
  const clave = useRef(nuevaClave());

  const cargar = useCallback(() => {
    void api().invocar('venta:listar').then(r => setVentas(r as VentaResumen[]));
    void api().invocar('contraparte:listar').then(r => setClientes((r as Contraparte[]).filter(c => c.esCliente)));
    void api().invocar('proyecto:listar').then(r => setProyectos(r as Proyecto[]));
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

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
      cargar();
    } catch (err) {
      setMensaje({ texto: String(err instanceof Error ? err.message : err), tipo: 'error' });
    } finally {
      setOcupado(false);
    }
  }

  async function anular(v: VentaResumen) {
    if (!responsable.trim()) {
      setMensaje({ texto: 'Registre el responsable antes de anular.', tipo: 'error' });
      return;
    }
    try {
      await api().invocar('documento:anular', { tipo: 'venta', documentoId: v.id, responsable: responsable.trim(), motivo: `Anulación de ${v.folio}` });
      cargar();
    } catch (err) {
      setMensaje({ texto: String(err instanceof Error ? err.message : err), tipo: 'error' });
    }
  }

  return (
    <div>
      <h1>Ventas reconocidas</h1>
      {mensaje && <p className={`aviso ${mensaje.tipo === 'error' ? 'error' : 'ok'}`}>{mensaje.texto}</p>}
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
      <h2>Ventas recientes</h2>
      {ventas.length === 0 ? (
        <p className="vacio">Sin ventas reconocidas.</p>
      ) : (
        <table>
          <thead><tr><th>Folio</th><th>Fecha</th><th>Concepto</th><th>Cliente</th><th className="numero">Total</th><th className="numero">Saldo</th><th>Estado</th><th></th></tr></thead>
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
                <td>{v.estado === 'registrada' && <button onClick={() => void anular(v)}>Anular</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
