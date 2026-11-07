import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import type { ContraparteResumen } from '../../shared/contratos';
import { limpiarMensajeError } from '../limpiarMensajeError';
import { BotonPeligro, BotonPrimario, BotonSecundario, EstadoCarga, EstadoError, EstadoVacio } from '../componentes';

export default function Contrapartes() {
  const [lista, setLista] = useState<ContraparteResumen[]>([]);
  const [nombre, setNombre] = useState('');
  const [cliente, setCliente] = useState(false);
  const [proveedor, setProveedor] = useState(false);
  const [responsable, setResponsable] = useState('');
  const [mensaje, setMensaje] = useState<{ texto: string; tipo: 'ok' | 'error' } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [editando, setEditando] = useState<ContraparteResumen | null>(null);
  const [editNombre, setEditNombre] = useState('');
  const [editNrc, setEditNrc] = useState('');
  const [editNit, setEditNit] = useState('');
  const [editNotas, setEditNotas] = useState('');
  const [cargandoLista, setCargandoLista] = useState(true);
  const [errorLista, setErrorLista] = useState<string | null>(null);

  const cargar = useCallback(() => {
    setCargandoLista(true);
    setErrorLista(null);
    api().invocar('contraparte:listar')
      .then(r => {
        setLista(r as ContraparteResumen[]);
        setCargandoLista(false);
      })
      .catch(err => {
        setErrorLista(limpiarMensajeError(err));
        setCargandoLista(false);
      });
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  async function cambiarEstado(c: ContraparteResumen, activa: boolean) {
    try {
      await api().invocar('contraparte:cambiarEstado', { contraparteId: c.id, activa, responsable });
      cargar();
    } catch (err) {
      setMensaje({ texto: limpiarMensajeError(err), tipo: 'error' });
    }
  }

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    if (ocupado) {
      return;
    }
    setOcupado(true);
    setMensaje(null);
    try {
      await api().invocar('contraparte:crear', {
        nombre,
        esCliente: cliente,
        esProveedor: proveedor,
        responsable
      });
      setMensaje({ texto: 'Contraparte registrada.', tipo: 'ok' });
      setNombre('');
      cargar();
    } catch (err) {
      setMensaje({ texto: limpiarMensajeError(err), tipo: 'error' });
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div>
      <h1>Clientes y proveedores</h1>
      {editando && (
        <form onSubmit={async e => {
          e.preventDefault();
          try {
            await api().invocar('contraparte:editar', {
              contraparteId: editando.id,
              nombre: editNombre,
              nrc: editNrc,
              nit: editNit,
              notas: editNotas,
              responsable
            });
            setMensaje({ texto: `Contraparte ${editando.nombre} actualizada; sin borrar su identidad en documentos.`, tipo: 'ok' });
            setEditando(null);
            cargar();
          } catch (err) {
            setMensaje({ texto: limpiarMensajeError(err), tipo: 'error' });
          }
        }}>
          <h2>Editar {editando.nombre}</h2>
          <div className="fila">
            <label style={{ flex: 2 }}>Nombre<input value={editNombre} onChange={e => setEditNombre(e.target.value)} required /></label>
            <label>NRC<input value={editNrc} onChange={e => setEditNrc(e.target.value)} /></label>
            <label>NIT<input value={editNit} onChange={e => setEditNit(e.target.value)} /></label>
            <label style={{ flex: 2 }}>Notas<input value={editNotas} onChange={e => setEditNotas(e.target.value)} /></label>
            <BotonPrimario type="submit">Guardar cambios</BotonPrimario>
            <BotonSecundario type="button" onClick={() => setEditando(null)}>Cancelar</BotonSecundario>
          </div>
        </form>
      )}
      {mensaje && <p className={`aviso ${mensaje.tipo === 'error' ? 'error' : 'ok'}`}>{mensaje.texto}</p>}
      <form onSubmit={crear}>
        <h2>Nueva contraparte</h2>
        <div className="fila">
          <label style={{ flex: 2 }}>Nombre<input value={nombre} onChange={e => setNombre(e.target.value)} required /></label>
          <label>Responsable<input value={responsable} onChange={e => setResponsable(e.target.value)} required /></label>
        </div>
        <div className="fila">
          <label><input type="checkbox" checked={cliente} onChange={e => setCliente(e.target.checked)} /> Cliente</label>
          <label><input type="checkbox" checked={proveedor} onChange={e => setProveedor(e.target.checked)} /> Proveedor</label>
          <BotonPrimario type="submit" disabled={ocupado}>{ocupado ? 'Registrando…' : 'Registrar'}</BotonPrimario>
        </div>
        <p className="menor">NRC/NIT y clasificación tributaria se completan cuando existan; no se crean identificaciones ficticias.</p>
      </form>
      {errorLista ? (
        <EstadoError mensaje={errorLista} />
      ) : cargandoLista && lista.length === 0 ? (
        <EstadoCarga texto="Cargando contrapartes…" />
      ) : lista.length === 0 ? (
        <EstadoVacio texto="Sin contrapartes registradas." />
      ) : (
        <table>
          <thead>
            <tr><th>Nombre</th><th>Cliente</th><th>Proveedor</th><th>NRC</th><th>NIT</th><th>Estado</th><th></th></tr>
          </thead>
          <tbody>
            {lista.map(c => (
              <tr key={c.id}>
                <td>{c.nombre}</td>
                <td>{c.esCliente ? 'Sí' : ''}</td>
                <td>{c.esProveedor ? 'Sí' : ''}</td>
                <td>{c.nrc ?? '—'}</td>
                <td>{c.nit ?? '—'}</td>
                <td>{c.activa ? 'Activa' : 'Inactiva'}</td>
                <td>
                  <div className="acciones-fila">
                    <BotonSecundario onClick={() => { setEditando(c); setEditNombre(c.nombre); setEditNrc(c.nrc ?? ''); setEditNit(c.nit ?? ''); setEditNotas(''); }}>Editar</BotonSecundario>
                    {c.activa ? (
                      <BotonPeligro onClick={() => void cambiarEstado(c, false)}>Desactivar</BotonPeligro>
                    ) : (
                      <BotonSecundario onClick={() => void cambiarEstado(c, true)}>Activar</BotonSecundario>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
