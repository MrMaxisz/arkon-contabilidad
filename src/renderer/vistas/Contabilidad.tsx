import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../api';

interface Cuenta {
  id: number;
  codigo: string;
  nombre: string;
  tipo: string;
  esGrupo: boolean;
  activa: boolean;
}

interface AsientoResumen {
  id: number;
  folio: string;
  fechaOperacion: string;
  concepto: string;
  estado: string;
  totalMinor: string;
  reversoDeId: number | null;
}

interface Movimiento {
  asientoId: number;
  folio: string;
  fecha: string;
  concepto: string;
  debeMinor: string;
  haberMinor: string;
  saldoMinor: string;
}

interface LineaForm {
  cuentaId: number;
  debe: string;
  haber: string;
}

function hoy(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function Contabilidad({ alCambiar }: { alCambiar: () => void }) {
  const [cuentas, setCuentas] = useState<Cuenta[]>([]);
  const [asientos, setAsientos] = useState<AsientoResumen[]>([]);
  const [mayor, setMayor] = useState<{ cuenta: Cuenta | null; movimientos: Movimiento[]; saldoMinor: string }>({
    cuenta: null,
    movimientos: [],
    saldoMinor: '0.00'
  });
  const [fecha, setFecha] = useState(hoy());
  const [concepto, setConcepto] = useState('');
  const [responsable, setResponsable] = useState('');
  const [lineas, setLineas] = useState<LineaForm[]>([
    { cuentaId: 0, debe: '', haber: '' },
    { cuentaId: 0, debe: '', haber: '' }
  ]);
  const [mensaje, setMensaje] = useState<{ texto: string; tipo: 'ok' | 'error' } | null>(null);
  const [cuentaMayor, setCuentaMayor] = useState<number>(0);

  const cargar = useCallback(() => {
    void api().invocar('cuenta:listar').then(r => setCuentas(r as Cuenta[]));
    void api().invocar('asiento:listar', { limite: 50 }).then(r => setAsientos(r as AsientoResumen[]));
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  useEffect(() => {
    if (!cuentaMayor) {
      setMayor({ cuenta: null, movimientos: [], saldoMinor: '0.00' });
      return;
    }
    void api()
      .invocar('mayor:consultar', { cuentaId: cuentaMayor })
      .then(r => {
        const m = r as { movimientos: Movimiento[]; saldoMinor: string };
        setMayor({ cuenta: cuentas.find(c => c.id === cuentaMayor) ?? null, movimientos: m.movimientos, saldoMinor: m.saldoMinor });
      });
  }, [cuentaMayor, cuentas]);

  const movimientos = cuentas.filter(c => !c.esGrupo && c.activa);

  async function contabilizar(e: React.FormEvent) {
    e.preventDefault();
    setMensaje(null);
    try {
      const resultado = (await api().invocar('asiento:contabilizar', {
        fechaOperacion: fecha,
        concepto,
        responsable,
        ambitoId: 'administrativo',
        lineas: lineas.map(l => ({ cuentaId: l.cuentaId, debeMinor: l.debe, haberMinor: l.haber }))
      })) as { folio: string; duplicado: boolean };
      setMensaje({
        texto: resultado.duplicado
          ? `Operación ya registrada (idempotencia): asiento ${resultado.folio}`
          : `Asiento ${resultado.folio} contabilizado`,
        tipo: 'ok'
      });
      setConcepto('');
      setLineas([
        { cuentaId: 0, debe: '', haber: '' },
        { cuentaId: 0, debe: '', haber: '' }
      ]);
      cargar();
      alCambiar();
    } catch (err) {
      setMensaje({ texto: String(err instanceof Error ? err.message : err), tipo: 'error' });
    }
  }

  async function anular(id: number) {
    const motivo = window.prompt('Motivo de la anulación (obligatorio):');
    if (!motivo) {
      return;
    }
    try {
      await api().invocar('asiento:anular', { asientoId: id, responsable: responsable || 'responsable', motivo });
      cargar();
      alCambiar();
    } catch (err) {
      setMensaje({ texto: String(err instanceof Error ? err.message : err), tipo: 'error' });
    }
  }

  return (
    <div>
      <h1>Contabilidad</h1>
      {mensaje && <p className={`aviso ${mensaje.tipo === 'error' ? 'error' : 'ok'}`}>{mensaje.texto}</p>}
      <form onSubmit={contabilizar}>
        <h2>Nuevo asiento manual</h2>
        <div className="fila">
          <label>Fecha de operación<input type="date" value={fecha} onChange={e => setFecha(e.target.value)} required /></label>
          <label style={{ flex: 2 }}>Concepto<input value={concepto} onChange={e => setConcepto(e.target.value)} required /></label>
          <label>Responsable<input value={responsable} onChange={e => setResponsable(e.target.value)} required /></label>
        </div>
        {lineas.map((l, i) => (
          <div className="fila" key={i}>
            <label style={{ flex: 3 }}>
              Cuenta
              <select
                value={l.cuentaId}
                onChange={e => {
                  const copia = [...lineas];
                  copia[i] = { ...l, cuentaId: Number(e.target.value) };
                  setLineas(copia);
                }}
                required
              >
                <option value={0}>— Seleccione —</option>
                {movimientos.map(c => (
                  <option key={c.id} value={c.id}>{c.codigo} · {c.nombre}</option>
                ))}
              </select>
            </label>
            <label>Debe<input value={l.debe} onChange={e => {
              const copia = [...lineas];
              copia[i] = { ...l, debe: e.target.value, haber: '' };
              setLineas(copia);
            }} placeholder="0.00" /></label>
            <label>Haber<input value={l.haber} onChange={e => {
              const copia = [...lineas];
              copia[i] = { ...l, haber: e.target.value, debe: '' };
              setLineas(copia);
            }} placeholder="0.00" /></label>
            {lineas.length > 2 && (
              <button type="button" onClick={() => setLineas(lineas.filter((_, j) => j !== i))}>Quitar</button>
            )}
          </div>
        ))}
        <div className="fila">
          <button type="button" onClick={() => setLineas([...lineas, { cuentaId: 0, debe: '', haber: '' }])}>
            Agregar línea
          </button>
          <button className="primario" type="submit">Contabilizar</button>
        </div>
      </form>

      <h2>Asientos recientes</h2>
      {asientos.length === 0 ? (
        <p className="vacio">Sin asientos registrados.</p>
      ) : (
        <table>
          <thead>
            <tr><th>Folio</th><th>Fecha</th><th>Concepto</th><th>Estado</th><th className="numero">Total</th><th></th></tr>
          </thead>
          <tbody>
            {asientos.map(a => (
              <tr key={a.id}>
                <td>{a.folio}</td>
                <td>{a.fechaOperacion}</td>
                <td>{a.concepto}</td>
                <td>{a.estado}</td>
                <td className="numero">${a.totalMinor}</td>
                <td>{a.estado === 'contabilizado' && !a.reversoDeId && <button onClick={() => anular(a.id)}>Anular</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>Mayor de cuenta</h2>
      <div className="fila">
        <label style={{ minWidth: 320 }}>
          Cuenta
          <select value={cuentaMayor} onChange={e => setCuentaMayor(Number(e.target.value))}>
            <option value={0}>— Seleccione —</option>
            {movimientos.map(c => (
              <option key={c.id} value={c.id}>{c.codigo} · {c.nombre}</option>
            ))}
          </select>
        </label>
        {mayor.cuenta && <p className="menor" style={{ alignSelf: 'flex-end' }}>Saldo: ${mayor.saldoMinor}</p>}
      </div>
      {mayor.cuenta && mayor.movimientos.length === 0 && <p className="vacio">Sin movimientos en esta cuenta.</p>}
      {mayor.movimientos.length > 0 && (
        <table>
          <thead>
            <tr><th>Fecha</th><th>Folio</th><th>Concepto</th><th className="numero">Debe</th><th className="numero">Haber</th><th className="numero">Saldo</th></tr>
          </thead>
          <tbody>
            {mayor.movimientos.map((m, i) => (
              <tr key={i}>
                <td>{m.fecha}</td>
                <td>{m.folio}</td>
                <td>{m.concepto}</td>
                <td className="numero">${m.debeMinor}</td>
                <td className="numero">${m.haberMinor}</td>
                <td className="numero">${m.saldoMinor}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
