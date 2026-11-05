import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api';

interface Periodo {
  id: number;
  inicio: string;
  fin: string;
  estado: string;
}

interface EstadoEjercicio {
  anio: number;
  periodos: Periodo[];
  cuentasResultado: Array<{ codigo: string; nombre: string; tipo: string; saldoMinor: string }>;
  resultadoNetoMinor: string;
  cierreExistente: { id: number; folio: string; fecha: string } | null;
  periodoDiciembreAbierto: boolean;
}

export default function Cierre() {
  const [anio, setAnio] = useState('');
  const [estado, setEstado] = useState<EstadoEjercicio | null>(null);
  const [responsable, setResponsable] = useState('');
  const [motivo, setMotivo] = useState('');
  const [referencia, setReferencia] = useState('');
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const clave = useRef(`cierre-${Date.now()}`);

  async function consultar(limpiarMensaje = true) {
    if (limpiarMensaje) {
      setMensaje(null);
    }
    try {
      const r = (await api().invocar('cierre:estado', { anio: Number(anio) })) as EstadoEjercicio;
      setEstado(r);
    } catch (err) {
      setEstado(null);
      setMensaje(`Error al consultar el ejercicio: ${String(err instanceof Error ? err.message : err)}`);
    }
  }

  useEffect(() => {
    if (anio && Number(anio) >= 1900 && Number(anio) <= 2999) {
      void consultar();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anio]);

  async function cerrar(e: React.FormEvent) {
    e.preventDefault();
    if (ocupado) {
      return;
    }
    setOcupado(true);
    setMensaje(null);
    try {
      const r = (await api().invocar('cierre:ejercicio', {
        anio: Number(anio),
        responsable,
        motivo,
        referencia,
        claveIdempotencia: clave.current
      })) as { folio: string; duplicado: boolean; netoMinor: string };
      setMensaje(
        r.duplicado
          ? `Cierre ya registrado (idempotencia): asiento ${r.folio}`
          : `Ejercicio ${anio} cerrado con asiento ${r.folio}; resultado neto ${r.netoMinor}.`
      );
      clave.current = `cierre-${Date.now()}`;
      await consultar(false);
    } catch (err) {
      setMensaje(`Error al cerrar el ejercicio: ${String(err instanceof Error ? err.message : err)}`);
    } finally {
      setOcupado(false);
    }
  }

  async function reabrir() {
    setMensaje(null);
    try {
      await api().invocar('cierre:reabrir', { anio: Number(anio), responsable, motivo });
      setMensaje(`Ejercicio ${anio} reabierto; el asiento de cierre puede anularse con motivo auditado.`);
      await consultar(false);
    } catch (err) {
      setMensaje(`Error al reabrir: ${String(err instanceof Error ? err.message : err)}`);
    }
  }

  return (
    <div>
      <h1>Cierre de ejercicio</h1>
      {mensaje && <p className="aviso">{mensaje}</p>}
      <div className="fila">
        <label>Año del ejercicio
          <input
            type="number"
            value={anio}
            min={1900}
            max={2999}
            onChange={e => setAnio(e.target.value)}
            placeholder="2026"
          />
        </label>
        <button onClick={() => void consultar()}>Consultar estado</button>
      </div>

      {estado && (
        <>
          <h2>Períodos de {estado.anio}</h2>
          {estado.periodos.length === 0 ? (
            <p className="vacio">Sin períodos registrados para el ejercicio.</p>
          ) : (
            <table>
              <thead><tr><th>Inicio</th><th>Fin</th><th>Estado</th></tr></thead>
              <tbody>
                {estado.periodos.map(p => (
                  <tr key={p.id}>
                    <td>{p.inicio}</td>
                    <td>{p.fin}</td>
                    <td>{p.estado}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <h2>Cuentas de resultados con saldo</h2>
          {estado.cuentasResultado.length === 0 ? (
            <p className="vacio">Sin saldos pendientes en cuentas de resultados.</p>
          ) : (
            <table>
              <thead><tr><th>Cuenta</th><th>Tipo</th><th className="numero">Saldo</th></tr></thead>
              <tbody>
                {estado.cuentasResultado.map(c => (
                  <tr key={c.codigo}>
                    <td>{c.codigo} · {c.nombre}</td>
                    <td>{c.tipo}</td>
                    <td className="numero">${c.saldoMinor}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="menor">Resultado neto del ejercicio: ${estado.resultadoNetoMinor}</p>
          {estado.cierreExistente ? (
            <p className="aviso ok">
              Ejercicio cerrado con asiento {estado.cierreExistente.folio} del {estado.cierreExistente.fecha}.
            </p>
          ) : (
            <p className="menor">El ejercicio aún no tiene asiento de cierre.</p>
          )}
        </>
      )}

      <form onSubmit={cerrar}>
        <h2>Cerrar ejercicio</h2>
        <div className="fila">
          <label style={{ flex: 2 }}>Responsable<input value={responsable} onChange={e => setResponsable(e.target.value)} required /></label>
        </div>
        <div className="fila">
          <label style={{ flex: 2 }}>Motivo<input value={motivo} onChange={e => setMotivo(e.target.value)} required placeholder="Motivo del cierre" /></label>
          <label style={{ flex: 2 }}>Referencia de soporte
            <input value={referencia} onChange={e => setReferencia(e.target.value)} required placeholder="Soporte que respalda el cierre" />
          </label>
        </div>
        <div className="fila">
          <button className="primario" type="submit" disabled={ocupado || !estado}>
            {ocupado ? 'Cerrando…' : 'Contabilizar cierre y cerrar diciembre'}
          </button>
          <button type="button" disabled={!estado || estado.periodoDiciembreAbierto} onClick={() => void reabrir()}>
            Reabrir diciembre
          </button>
        </div>
      </form>
      <p className="menor">
        El cierre contabiliza un asiento que lleva las cuentas de resultados a la cuenta de resultados
        acumulados y cierra el período de diciembre. La reapertura queda registrada en la bitácora;
        el asiento de cierre se anula por la vía auditada con motivo.
      </p>
    </div>
  );
}
