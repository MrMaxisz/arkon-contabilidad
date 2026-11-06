import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { MovimientoTesoreriaResumen } from '../../shared/contratos';
import { fechaLocalElSalvador } from '../../shared/fechas';
import { limpiarMensajeError } from '../limpiarMensajeError';
import { formatoDineroPantalla } from '../componentes';

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
      setMensaje({ texto: limpiarMensajeError(err), tipo: 'error' });
    } finally {
      setOcupado(false);
    }
  }

  const [anulando, setAnulando] = useState<MovimientoTesoreriaResumen | null>(null);
  const [motivoAnular, setMotivoAnular] = useState('');
  const [responsableAnular, setResponsableAnular] = useState('');
  const [ocupadoAnular, setOcupadoAnular] = useState(false);
  const [errorAnular, setErrorAnular] = useState<string | null>(null);
  const avisoRef = useRef<HTMLParagraphElement | null>(null);
  const origenAnulacionRef = useRef<HTMLButtonElement | null>(null);

  function abrirAnulacion(m: MovimientoTesoreriaResumen, origen: HTMLButtonElement) {
    origenAnulacionRef.current = origen;
    setAnulando(m);
    setMotivoAnular('');
    setResponsableAnular(responsable.trim());
    setErrorAnular(null);
  }

  useEffect(() => {
    if (!anulando) {
      return;
    }
    const alPresionar = (evento: KeyboardEvent) => {
      if (evento.key === 'Escape' && !ocupadoAnular) {
        // Con la anulación en curso, Escape no hace nada (auditoría 70).
        cancelarAnulacion();
        origenAnulacionRef.current?.focus();
      }
    };
    document.addEventListener('keydown', alPresionar);
    return () => document.removeEventListener('keydown', alPresionar);
  }, [anulando, ocupadoAnular]);

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
    setErrorAnular(null);
    try {
      await api().invocar('tesoreria:anular', {
        movimientoId: anulando.id,
        responsable: responsableAnular.trim(),
        motivo: motivoAnular.trim()
      });
      setMensaje({ texto: `${anulando.tipo === 'cobro' ? 'Cobro' : anulando.tipo === 'pago' ? 'Pago' : 'Transferencia'} ${anulando.folio} anulado con reverso contable; motivo registrado en bitácora.`, tipo: 'ok' });
      setAnulando(null);
      setMotivoAnular('');
      setResponsableAnular('');
      cargar();
      setTimeout(() => { if (typeof avisoRef.current?.scrollIntoView === 'function') { avisoRef.current.scrollIntoView({ block: 'center' }); } }, 0);
    } catch (err) {
      setErrorAnular(limpiarMensajeError(err));
    } finally {
      setOcupadoAnular(false);
    }
  }

  return (
    <div>
      <h1>Caja y bancos</h1>
      {mensaje && <p ref={avisoRef} className={`aviso ${mensaje.tipo === 'error' ? 'error' : 'ok'}`}>{mensaje.texto}</p>}
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
                <td className="folio">{m.folio}</td>
                <td>{m.tipo}</td>
                <td>{m.fecha}</td>
                <td>{m.concepto}</td>
                <td>{m.contraparteNombre ?? '—'}</td>
                <td className="numero">{formatoDineroPantalla(m.montoMinor)}</td>
                <td>{m.estado}</td>
                <td>{m.estado === 'registrado' && <button onClick={e => abrirAnulacion(m, e.currentTarget)}>Anular</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {anulando && (
        <div className="aviso" role="dialog" aria-label={`Anular ${anulando.tipo} ${anulando.folio}`}>
          <h3>Anular {anulando.tipo} {anulando.folio}</h3>
          <p className="menor">
            Monto: ${anulando.montoMinor} · Contraparte: {anulando.contraparteNombre ?? '—'} · Efecto: se genera
            un reverso contable que cancela el movimiento y libera las aplicaciones; el motivo y el
            responsable quedan en bitácora.
          </p>
          {errorAnular && <p role="alert" className="aviso error">{errorAnular}</p>}
          <form onSubmit={confirmarAnulacion}>
            <div className="fila">
              <label style={{ flex: 2 }}>Motivo de la anulación
                <input value={motivoAnular} onChange={e => setMotivoAnular(e.target.value)} required autoFocus placeholder="Motivo significativo (mínimo 10 caracteres)" />
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
