import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import type { ProyectoResumen } from '../../shared/contratos';

interface Contraparte { id: number; nombre: string }
interface Cotizacion { id: number; numero: string; estado: string }

interface Rentabilidad {
  proyectos: Array<{ id: number; codigo: string; nombre: string; ingresoMinor: string; costoMinor: string; margenMinor: string }>;
  provisional: boolean;
  nota: string;
}

export default function Proyectos() {
  const [proyectos, setProyectos] = useState<ProyectoResumen[]>([]);
  const [contrapartes, setContrapartes] = useState<Contraparte[]>([]);
  const [cotizaciones, setCotizaciones] = useState<Cotizacion[]>([]);
  const [codigo, setCodigo] = useState('');
  const [nombre, setNombre] = useState('');
  const [contraparteId, setContraparteId] = useState(0);
  const [cotizacionId, setCotizacionId] = useState(0);
  const [alcance, setAlcance] = useState('');
  const [responsable, setResponsable] = useState('');
  const [mensaje, setMensaje] = useState<{ texto: string; tipo: 'ok' | 'error' } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [rentabilidad, setRentabilidad] = useState<Rentabilidad | null>(null);

  const cargar = useCallback(() => {
    void api().invocar('proyecto:listar').then(r => setProyectos(r as ProyectoResumen[]));
    void api().invocar('contraparte:listar').then(r => setContrapartes(r as Contraparte[]));
    void api().invocar('cotizacion:listar').then(r => setCotizaciones((r as Cotizacion[]).filter(c => c.estado === 'aprobada')));
    void api().invocar('reporte:rentabilidadProyectos').then(r => setRentabilidad(r as Rentabilidad));
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
      await api().invocar('proyecto:crear', {
        codigo,
        nombre,
        contraparteId,
        cotizacionId: cotizacionId || undefined,
        alcance,
        responsable
      });
      setMensaje({ texto: `Proyecto ${codigo} registrado.` , tipo: 'ok' });
      setCodigo('');
      setNombre('');
      setAlcance('');
      setCotizacionId(0);
      cargar();
    } catch (err) {
      setMensaje({ texto: String(err instanceof Error ? err.message : err), tipo: 'error' });
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div>
      <h1>Proyectos</h1>
      {mensaje && <p className={`aviso ${mensaje.tipo === 'error' ? 'error' : 'ok'}`}>{mensaje.texto}</p>}
      <form onSubmit={crear}>
        <h2>Nuevo proyecto</h2>
        <div className="fila">
          <label>Código<input value={codigo} onChange={e => setCodigo(e.target.value.toUpperCase())} required placeholder="PRJ-001" /></label>
          <label style={{ flex: 2 }}>Nombre<input value={nombre} onChange={e => setNombre(e.target.value)} required /></label>
          <label>Contraparte
            <select value={contraparteId} onChange={e => setContraparteId(Number(e.target.value))} required>
              <option value={0}>— Seleccione —</option>
              {contrapartes.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </label>
          <label>Responsable<input value={responsable} onChange={e => setResponsable(e.target.value)} required /></label>
        </div>
        <div className="fila">
          <label>Cotización aprobada (opcional)
            <select value={cotizacionId} onChange={e => setCotizacionId(Number(e.target.value))}>
              <option value={0}>— Ninguna —</option>
              {cotizaciones.map(c => <option key={c.id} value={c.id}>{c.numero}</option>)}
            </select>
          </label>
          <label style={{ flex: 2 }}>Alcance<input value={alcance} onChange={e => setAlcance(e.target.value)} /></label>
          <button className="primario" type="submit" disabled={ocupado}>Registrar</button>
        </div>
      </form>
      {proyectos.length === 0 ? (
        <p className="vacio">Sin proyectos.</p>
      ) : (
        <table>
          <thead><tr><th>Código</th><th>Nombre</th><th>Contraparte</th><th>Estado</th></tr></thead>
          <tbody>
            {proyectos.map(p => (
              <tr key={p.id}>
                <td>{p.codigo}</td>
                <td>{p.nombre}</td>
                <td>{p.contraparteNombre}</td>
                <td>{p.estado}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <h2>Rentabilidad por proyecto</h2>
      {rentabilidad && (
        <>
          {rentabilidad.provisional && <p className="aviso">{rentabilidad.nota}</p>}
          {rentabilidad.proyectos.length === 0 ? (
            <p className="vacio">Sin proyectos que reportar.</p>
          ) : (
            <table>
              <thead><tr><th>Código</th><th>Nombre</th><th className="numero">Ingreso</th><th className="numero">Costo</th><th className="numero">Margen</th></tr></thead>
              <tbody>
                {rentabilidad.proyectos.map(r => (
                  <tr key={r.id}>
                    <td>{r.codigo}</td>
                    <td>{r.nombre}</td>
                    <td className="numero">${r.ingresoMinor}</td>
                    <td className="numero">${r.costoMinor}</td>
                    <td className="numero">${r.margenMinor}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
      <p className="menor">Un costo desconocido nunca se trata como cero: con compras sin proyecto asignado la rentabilidad se marca como provisional.</p>
    </div>
  );
}
