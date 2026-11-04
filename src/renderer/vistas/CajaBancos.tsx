import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { MovimientoTesoreriaResumen } from '../../shared/contratos';
import { fechaLocalElSalvador } from '../../shared/fechas';

interface Cuenta { id: number; codigo: string; nombre: string }

function nuevaClave(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `op-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function CajaBancos() {
  const [cuentas, setCuentas] = useState<Cuenta[]>([]);
  const [movimientos, setMovimientos] = useState<MovimientoTesoreriaResumen[]>([]);
  const [origen, setOrigen] = useState(0);
  const [destino, setDestino] = useState(0);
  const [monto, setMonto] = useState('');
  const [concepto, setConcepto] = useState('');
  const [responsable, setResponsable] = useState('');
  const [fecha, setFecha] = useState(fechaLocalElSalvador());
  const [mensaje, setMensaje] = useState<{ texto: string; tipo: 'ok' | 'error' } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const clave = useRef(nuevaClave());

  const cargar = useCallback(() => {
    void api().invocar('cuenta:listar').then(r => setCuentas((r as Cuenta[]).filter(c => ['1101', '1102', '1103'].includes(c.codigo))));
    void api().invocar('tesoreria:listar').then(r => setMovimientos(r as MovimientoTesoreriaResumen[]));
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  async function transferir(e: React.FormEvent) {
    e.preventDefault();
    if (ocupado) {
      return;
    }
    setOcupado(true);
    setMensaje(null);
    try {
      const r = (await api().invocar('transferencia:registrar', {
        fechaOperacion: fecha,
        cuentaOrigenId: origen,
        cuentaDestinoId: destino,
        monto,
        concepto,
        claveIdempotencia: clave.current,
        responsable
      })) as { folio: string };
      setMensaje({ texto: `Transferencia ${r.folio} registrada. Las transferencias internas no generan ingresos ni gastos.` , tipo: 'ok' });
      setMonto('');
      setConcepto('');
      clave.current = nuevaClave();
      cargar();
    } catch (err) {
      setMensaje({ texto: String(err instanceof Error ? err.message : err), tipo: 'error' });
    } finally {
      setOcupado(false);
    }
  }

  async function anular(m: MovimientoTesoreriaResumen) {
    if (!responsable.trim()) {
      setMensaje({ texto: 'Registre el responsable antes de anular.', tipo: 'error' });
      return;
    }
    try {
      await api().invocar('tesoreria:anular', { movimientoId: m.id, responsable: responsable.trim(), motivo: `Anulación de ${m.folio}` });
      cargar();
    } catch (err) {
      setMensaje({ texto: String(err instanceof Error ? err.message : err), tipo: 'error' });
    }
  }

  return (
    <div>
      <h1>Caja y bancos</h1>
      {mensaje && <p className={`aviso ${mensaje.tipo === 'error' ? 'error' : 'ok'}`}>{mensaje.texto}</p>}
      <form onSubmit={transferir}>
        <h2>Transferencia entre cuentas propias</h2>
        <div className="fila">
          <label>Cuenta origen
            <select value={origen} onChange={e => setOrigen(Number(e.target.value))} required>
              <option value={0}>— Seleccione —</option>
              {cuentas.map(c => <option key={c.id} value={c.id}>{c.codigo} · {c.nombre}</option>)}
            </select>
          </label>
          <label>Cuenta destino
            <select value={destino} onChange={e => setDestino(Number(e.target.value))} required>
              <option value={0}>— Seleccione —</option>
              {cuentas.map(c => <option key={c.id} value={c.id}>{c.codigo} · {c.nombre}</option>)}
            </select>
          </label>
          <label>Fecha<input type="date" value={fecha} onChange={e => setFecha(e.target.value)} required /></label>
          <label>Monto<input value={monto} onChange={e => setMonto(e.target.value)} required placeholder="0.00" /></label>
          <label style={{ flex: 2 }}>Concepto<input value={concepto} onChange={e => setConcepto(e.target.value)} required /></label>
          <label>Responsable<input value={responsable} onChange={e => setResponsable(e.target.value)} required /></label>
        </div>
        <div className="fila">
          <button className="primario" type="submit" disabled={ocupado}>{ocupado ? 'Registrando…' : 'Registrar transferencia'}</button>
        </div>
      </form>
      <h2>Movimientos recientes</h2>
      {movimientos.length === 0 ? (
        <p className="vacio">Sin movimientos de tesorería.</p>
      ) : (
        <table>
          <thead><tr><th>Folio</th><th>Tipo</th><th>Fecha</th><th>Concepto</th><th>Contraparte</th><th className="numero">Monto</th><th>Estado</th><th></th></tr></thead>
          <tbody>
            {movimientos.map(m => (
              <tr key={m.id}>
                <td>{m.folio}</td>
                <td>{m.tipo}</td>
                <td>{m.fecha}</td>
                <td>{m.concepto}</td>
                <td>{m.contraparteNombre ?? '—'}</td>
                <td className="numero">${m.montoMinor}</td>
                <td>{m.estado}</td>
                <td>{m.estado === 'registrado' && <button onClick={() => void anular(m)}>Anular</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
