import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { fechaLocalElSalvador } from '../../shared/fechas';

interface Contraparte { id: number; nombre: string; esCliente: boolean }
interface Cotizacion {
  id: number;
  numero: string;
  revision: number;
  contraparteNombre: string;
  fecha: string;
  estado: string;
  congelada: boolean;
  baseMinor: string;
  ivaMinor: string;
  totalMinor: string;
}

interface LineaForm {
  tipo: 'servicio' | 'material';
  descripcion: string;
  cantidad: string;
  precioUnitario: string;
  precioConIva: boolean;
  tasa: string;
}

function nuevaClave(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `op-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function Cotizaciones() {
  const [cotizaciones, setCotizaciones] = useState<Cotizacion[]>([]);
  const [contrapartes, setContrapartes] = useState<Contraparte[]>([]);
  const [clientes, setClientes] = useState<Contraparte[]>([]);
  const [contraparteId, setContraparteId] = useState(0);
  const [fecha, setFecha] = useState(fechaLocalElSalvador());
  const [condiciones, setCondiciones] = useState('');
  const [responsable, setResponsable] = useState('');
  const [lineas, setLineas] = useState<LineaForm[]>([
    { tipo: 'servicio', descripcion: '', cantidad: '1', precioUnitario: '', precioConIva: true, tasa: '13' }
  ]);
  const [mensaje, setMensaje] = useState<{ texto: string; tipo: 'ok' | 'error' } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [anulando, setAnulando] = useState<Cotizacion | null>(null);
  const [motivoAnular, setMotivoAnular] = useState('');
  const clave = useRef(nuevaClave());

  const cargar = useCallback(() => {
    void api().invocar('cotizacion:listar').then(r => setCotizaciones(r as Cotizacion[]));
    void api().invocar('contraparte:listar').then(r => {
      const lista = r as Contraparte[];
      setContrapartes(lista);
      setClientes(lista.filter(c => c.esCliente));
    });
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    if (ocupado) {
      return;
    }
    setOcupado(true);
    setMensaje(null);
    try {
      const r = (await api().invocar('cotizacion:crear', {
        contraparteId,
        fecha,
        condiciones,
        responsable,
        lineas
      })) as { numero: string };
      setMensaje({ texto: `Cotización ${r.numero} creada. No genera ingresos ni cuentas por cobrar por sí sola.`, tipo: 'ok' });
      setLineas([{ tipo: 'servicio', descripcion: '', cantidad: '1', precioUnitario: '', precioConIva: true, tasa: '13' }]);
      clave.current = nuevaClave();
      cargar();
    } catch (err) {
      setMensaje({ texto: String(err instanceof Error ? err.message : err), tipo: 'error' });
    } finally {
      setOcupado(false);
    }
  }

  async function accion(comando: 'cotizacion:aprobar' | 'cotizacion:revision' | 'cotizacion:anular', id: number, extra?: Record<string, string>) {
    if (!responsable.trim()) {
      setMensaje({ texto: 'Registre el responsable antes de aprobar, revisar o anular.', tipo: 'error' });
      return;
    }
    try {
      await api().invocar(comando, { cotizacionId: id, responsable: responsable.trim(), ...extra });
      setMensaje({ texto: 'Operación realizada.', tipo: 'ok' });
      cargar();
    } catch (err) {
      setMensaje({ texto: String(err instanceof Error ? err.message : err), tipo: 'error' });
    }
  }

  return (
    <div>
      <h1>Cotizaciones</h1>
      {mensaje && <p className={`aviso ${mensaje.tipo === 'error' ? 'error' : 'ok'}`}>{mensaje.texto}</p>}
      <form onSubmit={crear}>
        <h2>Nueva cotización</h2>
        <div className="fila">
          <label>Cliente
            <select value={contraparteId} onChange={e => setContraparteId(Number(e.target.value))} required>
              <option value={0}>— Seleccione —</option>
              {clientes.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </label>
          <label>Fecha<input type="date" value={fecha} onChange={e => setFecha(e.target.value)} required /></label>
          <label>Responsable<input value={responsable} onChange={e => setResponsable(e.target.value)} required /></label>
        </div>
        {lineas.map((l, i) => (
          <div className="fila" key={i}>
            <label>Tipo
              <select value={l.tipo} onChange={e => {
                const copia = [...lineas];
                copia[i] = { ...l, tipo: e.target.value as 'servicio' | 'material' };
                setLineas(copia);
              }}>
                <option value="servicio">Servicio</option>
                <option value="material">Material</option>
              </select>
            </label>
            <label style={{ flex: 2 }}>Descripción<input value={l.descripcion} onChange={e => {
              const copia = [...lineas];
              copia[i] = { ...l, descripcion: e.target.value };
              setLineas(copia);
            }} required /></label>
            <label>Cantidad<input value={l.cantidad} onChange={e => {
              const copia = [...lineas];
              copia[i] = { ...l, cantidad: e.target.value };
              setLineas(copia);
            }} required /></label>
            <label>Precio unitario<input value={l.precioUnitario} onChange={e => {
              const copia = [...lineas];
              copia[i] = { ...l, precioUnitario: e.target.value };
              setLineas(copia);
            }} placeholder="0.00" required /></label>
            <label><input type="checkbox" checked={l.precioConIva} onChange={e => {
              const copia = [...lineas];
              copia[i] = { ...l, precioConIva: e.target.checked };
              setLineas(copia);
            }} /> IVA incluido</label>
            <label>Tasa %<input value={l.tasa} onChange={e => {
              const copia = [...lineas];
              copia[i] = { ...l, tasa: e.target.value };
              setLineas(copia);
            }} /></label>
            {lineas.length > 1 && <button type="button" onClick={() => setLineas(lineas.filter((_, j) => j !== i))}>Quitar</button>}
          </div>
        ))}
        <div className="fila">
          <button type="button" onClick={() => setLineas([...lineas, { tipo: 'material', descripcion: '', cantidad: '1', precioUnitario: '', precioConIva: true, tasa: '13' }])}>Agregar línea</button>
          <button className="primario" type="submit" disabled={ocupado}>{ocupado ? 'Creando…' : 'Crear cotización'}</button>
        </div>
        <p className="menor">Si el precio incluye IVA, el desglose conserva el total; base + IVA reconcilian sin aumentarlo.</p>
      </form>

      <h2>Cotizaciones recientes</h2>
      {cotizaciones.length === 0 ? (
        <p className="vacio">Sin cotizaciones.</p>
      ) : (
        <table>
          <thead>
            <tr><th>Número</th><th>Rev.</th><th>Cliente</th><th>Fecha</th><th>Estado</th><th className="numero">Base</th><th className="numero">IVA</th><th className="numero">Total</th><th></th></tr>
          </thead>
          <tbody>
            {cotizaciones.map(c => (
              <tr key={c.id}>
                <td>{c.numero}</td>
                <td>{c.revision}</td>
                <td>{c.contraparteNombre}</td>
                <td>{c.fecha}</td>
                <td>{c.estado}</td>
                <td className="numero">${c.baseMinor}</td>
                <td className="numero">${c.ivaMinor}</td>
                <td className="numero">${c.totalMinor}</td>
                <td>
                  {c.estado === 'borrador' && <>
                    <button onClick={() => void accion('cotizacion:aprobar', c.id)}>Aprobar</button>{' '}
                    <button onClick={() => void accion('cotizacion:revision', c.id)}>Nueva revisión</button>{' '}
                    <button onClick={() => { setAnulando(c); setMotivoAnular(''); }}>Anular</button>
                  </>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {anulando && (
        <form onSubmit={e => {
          e.preventDefault();
          void accion('cotizacion:anular', anulando.id, { motivo: motivoAnular });
          setAnulando(null);
        }}>
          <h2>Anular cotización {anulando.numero}</h2>
          <div className="fila">
            <label style={{ flex: 2 }}>Motivo (obligatorio)
              <input value={motivoAnular} onChange={e => setMotivoAnular(e.target.value)} required />
            </label>
            <button className="primario" type="submit">Confirmar</button>
            <button type="button" onClick={() => setAnulando(null)}>Cancelar</button>
          </div>
        </form>
      )}
      <p className="menor">La aprobación congela la versión; una revisión comercial no modifica la versión aprobada.</p>
    </div>
  );
}
