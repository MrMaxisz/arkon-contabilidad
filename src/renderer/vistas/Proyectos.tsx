import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import type { ProyectoResumen } from '../../shared/contratos';
import { limpiarMensajeError } from '../limpiarMensajeError';
import { BotonPrimario, EstadoCarga, EstadoError, EstadoSinResultados, EstadoVacio, formatoDineroPantalla } from '../componentes';

interface Contraparte { id: number; nombre: string }
interface Cotizacion { id: number; numero: string; estado: string }

interface Rentabilidad {
  proyectos: Array<{
    id: number;
    codigo: string;
    nombre: string;
    ingresoMinor: string;
    costoMinor: string;
    margenMinor: string;
    totalDocumentalVentaMinor: string;
    totalDocumentalCompraMinor: string;
  }>;
  provisional: boolean;
  nota: string;
  criterio: string;
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
  const [cargandoCatalogo, setCargandoCatalogo] = useState(true);
  const [errorCatalogo, setErrorCatalogo] = useState<string | null>(null);

  const cargar = useCallback(() => {
    setCargandoCatalogo(true);
    setErrorCatalogo(null);
    void Promise.allSettled([
      api().invocar('proyecto:listar'),
      api().invocar('contraparte:listar'),
      api().invocar('cotizacion:listar'),
      api().invocar('reporte:rentabilidadProyectos')
    ]).then(([proyectosResultado, contrapartesResultado, cotizacionesResultado, rentabilidadResultado]) => {
      const resultados = [proyectosResultado, contrapartesResultado, cotizacionesResultado, rentabilidadResultado];
      const rechazado = resultados.find(r => r.status === 'rejected');
      if (rechazado && rechazado.status === 'rejected') {
        setErrorCatalogo(limpiarMensajeError(rechazado.reason));
      }
      if (proyectosResultado.status === 'fulfilled') {
        setProyectos(proyectosResultado.value as ProyectoResumen[]);
      }
      if (contrapartesResultado.status === 'fulfilled') {
        setContrapartes(contrapartesResultado.value as Contraparte[]);
      }
      if (cotizacionesResultado.status === 'fulfilled') {
        setCotizaciones((cotizacionesResultado.value as Cotizacion[]).filter(c => c.estado === 'aprobada'));
      }
      if (rentabilidadResultado.status === 'fulfilled') {
        setRentabilidad(rentabilidadResultado.value as Rentabilidad);
      }
      setCargandoCatalogo(false);
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
      setMensaje({ texto: limpiarMensajeError(err), tipo: 'error' });
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div>
      <h1>Proyectos</h1>
      {cargandoCatalogo && <EstadoCarga texto="Cargando catálogos…" />}
      {errorCatalogo && <EstadoError mensaje={errorCatalogo} />}
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
          <BotonPrimario type="submit" disabled={ocupado}>{ocupado ? 'Registrando…' : 'Registrar'}</BotonPrimario>
        </div>
      </form>
      {proyectos.length === 0 ? (
        <EstadoVacio texto="Sin proyectos." />
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
            <EstadoSinResultados texto="Sin proyectos que reportar." />
          ) : (
            <table>
              <thead><tr><th>Código</th><th>Nombre</th><th className="numero">Ingreso reconocido</th><th className="numero">Costo/gasto reconocido</th><th className="numero">Margen</th><th className="numero">Total documental venta</th><th className="numero">Total documental compra</th></tr></thead>
              <tbody>
                {rentabilidad.proyectos.map(r => (
                  <tr key={r.id}>
                    <td>{r.codigo}</td>
                    <td>{r.nombre}</td>
                    <td className="numero">{formatoDineroPantalla(r.ingresoMinor)}</td>
                    <td className="numero">{formatoDineroPantalla(r.costoMinor)}</td>
                    <td className="numero">{formatoDineroPantalla(r.margenMinor)}</td>
                    <td className="numero">{formatoDineroPantalla(r.totalDocumentalVentaMinor)}</td>
                    <td className="numero">{formatoDineroPantalla(r.totalDocumentalCompraMinor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="menor">{rentabilidad.criterio}</p>
        </>
      )}
      <p className="menor">Un costo desconocido nunca se trata como cero: con compras sin proyecto asignado la rentabilidad se marca como provisional.</p>
    </div>
  );
}
