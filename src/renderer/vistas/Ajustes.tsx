import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { fechaLocalElSalvador } from '../../shared/fechas';
import { limpiarMensajeError } from '../limpiarMensajeError';

interface Cuenta { id: number; codigo: string; nombre: string; tipo: string; esGrupo: boolean; activa: boolean }

interface LineaForm {
  cuentaCodigo: string;
  debe: string;
  haber: string;
}

function nuevaClave(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `op-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function Ajustes() {
  const [cuentas, setCuentas] = useState<Cuenta[]>([]);
  const [tipoAsiento, setTipoAsiento] = useState<'ajuste' | 'apertura'>('ajuste');
  const [fecha, setFecha] = useState(fechaLocalElSalvador());
  const [concepto, setConcepto] = useState('');
  const [referencia, setReferencia] = useState('');
  const [responsable, setResponsable] = useState('');
  const [lineas, setLineas] = useState<LineaForm[]>([
    { cuentaCodigo: '', debe: '', haber: '' },
    { cuentaCodigo: '', debe: '', haber: '' }
  ]);
  const [mensaje, setMensaje] = useState<{ texto: string; tipo: 'ok' | 'error' } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const clave = useRef(nuevaClave());

  const cargar = useCallback(() => {
    void api().invocar('cuenta:listar').then(r => {
      setCuentas((r as Cuenta[]).filter(c => !c.esGrupo && c.activa));
    });
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
      const comando = tipoAsiento === 'apertura' ? 'apertura:registrar' : 'ajuste:registrar';
      const r = (await api().invocar(comando, {
        fechaOperacion: fecha,
        concepto,
        referencia,
        claveIdempotencia: clave.current,
        responsable,
        lineas: lineas.map(l => ({ cuentaCodigo: l.cuentaCodigo, debeMinor: l.debe, haberMinor: l.haber }))
      })) as { folio: string; duplicado: boolean };
      setMensaje({
        texto: r.duplicado
          ? `Operación ya registrada (idempotencia): ${tipoAsiento} ${r.folio}`
          : `${tipoAsiento === 'apertura' ? 'Apertura' : 'Ajuste'} ${r.folio} contabilizado con soporte «${referencia}».`,
        tipo: 'ok'
      });
      setConcepto('');
      setLineas([
        { cuentaCodigo: '', debe: '', haber: '' },
        { cuentaCodigo: '', debe: '', haber: '' }
      ]);
      clave.current = nuevaClave();
    } catch (err) {
      setMensaje({ texto: limpiarMensajeError(err), tipo: 'error' });
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div>
      <h1>Ajustes y apertura</h1>
      {mensaje && <p className={`aviso ${mensaje.tipo === 'error' ? 'error' : 'ok'}`}>{mensaje.texto}</p>}
      <form onSubmit={registrar}>
        <h2>Nuevo ajuste o apertura</h2>
        <div className="fila">
          <label>Tipo de asiento
            <select value={tipoAsiento} onChange={e => setTipoAsiento(e.target.value as 'ajuste' | 'apertura')}>
              <option value="ajuste">Ajuste</option>
              <option value="apertura">Apertura de ejercicio</option>
            </select>
          </label>
        </div>
        <div className="fila">
          <label>Fecha<input type="date" value={fecha} onChange={e => setFecha(e.target.value)} required /></label>
          <label style={{ flex: 2 }}>Concepto<input value={concepto} onChange={e => setConcepto(e.target.value)} required /></label>
        </div>
        <div className="fila">
          <label style={{ flex: 2 }}>Referencia de soporte (obligatoria)
            <input value={referencia} onChange={e => setReferencia(e.target.value)} required placeholder="Documento o soporte que respalda el ajuste" />
          </label>
          <label>Responsable<input value={responsable} onChange={e => setResponsable(e.target.value)} required /></label>
        </div>
        {lineas.map((l, i) => (
          <div className="fila" key={i}>
            <label style={{ flex: 3 }}>Cuenta
              <select value={l.cuentaCodigo} onChange={e => {
                const copia = [...lineas];
                copia[i] = { ...l, cuentaCodigo: e.target.value };
                setLineas(copia);
              }} required>
                <option value="">— Seleccione —</option>
                {cuentas.map(c => <option key={c.id} value={c.codigo}>{c.codigo} · {c.nombre}</option>)}
              </select>
            </label>
            <label>Debe
              <input value={l.debe} onChange={e => {
                const copia = [...lineas];
                copia[i] = { ...l, debe: e.target.value, haber: '' };
                setLineas(copia);
              }} placeholder="0.00" />
            </label>
            <label>Haber
              <input value={l.haber} onChange={e => {
                const copia = [...lineas];
                copia[i] = { ...l, haber: e.target.value, debe: '' };
                setLineas(copia);
              }} placeholder="0.00" />
            </label>
            {lineas.length > 2 && (
              <button type="button" onClick={() => setLineas(lineas.filter((_, j) => j !== i))}>Quitar</button>
            )}
          </div>
        ))}
        <div className="fila">
          <button type="button" onClick={() => setLineas([...lineas, { cuentaCodigo: '', debe: '', haber: '' }])}>Agregar línea</button>
          <button className="primario" type="submit" disabled={ocupado}>{ocupado ? 'Contabilizando…' : 'Contabilizar ajuste'}</button>
        </div>
      </form>
      <p className="menor">
        El ajuste usa el motor contable central: valida calendario, período abierto, ámbito, cuentas y cuadre.
        La referencia de soporte es obligatoria. Un reintento con la misma operación devuelve el mismo asiento (idempotencia).
        Los saldos de apertura se registran aquí con su soporte documentado; no se precargan cifras.
      </p>
    </div>
  );
}
