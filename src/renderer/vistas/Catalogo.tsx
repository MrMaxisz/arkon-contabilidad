import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../api';

interface Item {
  id: number;
  tipo: string;
  codigo: string;
  nombre: string;
  unidad: string | null;
  descripcion: string | null;
  precioVentaMinor: string | null;
  precioCostoMinor: string | null;
  activo: boolean;
}

export default function Catalogo() {
  const [items, setItems] = useState<Item[]>([]);
  const [tipo, setTipo] = useState<'servicio' | 'material'>('servicio');
  const [codigo, setCodigo] = useState('');
  const [nombre, setNombre] = useState('');
  const [unidad, setUnidad] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [precioVenta, setPrecioVenta] = useState('');
  const [precioCosto, setPrecioCosto] = useState('');
  const [responsable, setResponsable] = useState('');
  const [editando, setEditando] = useState<Item | null>(null);
  const [mensaje, setMensaje] = useState<{ texto: string; tipo: 'ok' | 'error' } | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const cargar = useCallback(() => {
    void api().invocar('item:listar', {}).then(r => setItems(r as Item[]));
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (ocupado) {
      return;
    }
    setOcupado(true);
    setMensaje(null);
    try {
      if (editando) {
        await api().invocar('item:editar', {
          itemId: editando.id,
          nombre,
          unidad,
          descripcion,
          precioVenta,
          precioCosto,
          responsable
        });
        setMensaje({ texto: `Ítem ${editando.codigo} actualizado; los documentos históricos conservan sus líneas.`, tipo: 'ok' });
        setEditando(null);
      } else {
        await api().invocar('item:crear', {
          tipo,
          codigo,
          nombre,
          unidad,
          descripcion,
          precioVenta,
          precioCosto,
          responsable
        });
        setMensaje({ texto: `Ítem ${codigo} registrado. Precios y rendimientos opcionales: sin valores inventados.`, tipo: 'ok' });
      }
      setCodigo('');
      setNombre('');
      setUnidad('');
      setDescripcion('');
      setPrecioVenta('');
      setPrecioCosto('');
      cargar();
    } catch (err) {
      setMensaje({ texto: String(err instanceof Error ? err.message : err), tipo: 'error' });
    } finally {
      setOcupado(false);
    }
  }

  async function cambiarEstado(item: Item, activar: boolean) {
    try {
      await api().invocar(activar ? 'item:activar' : 'item:desactivar', { itemId: item.id, responsable });
      cargar();
    } catch (err) {
      setMensaje({ texto: String(err instanceof Error ? err.message : err), tipo: 'error' });
    }
  }

  return (
    <div>
      <h1>Catálogo de servicios y materiales</h1>
      {mensaje && <p className={`aviso ${mensaje.tipo === 'error' ? 'error' : 'ok'}`}>{mensaje.texto}</p>}
      <form onSubmit={guardar}>
        <h2>{editando ? `Editar ${editando.codigo}` : 'Nuevo ítem'}</h2>
        <div className="fila">
          {!editando && (
            <label>Tipo
              <select value={tipo} onChange={e => setTipo(e.target.value as 'servicio' | 'material')}>
                <option value="servicio">Servicio</option>
                <option value="material">Material</option>
              </select>
            </label>
          )}
          {!editando && <label>Código<input value={codigo} onChange={e => setCodigo(e.target.value.toUpperCase())} required placeholder="SRV-001" /></label>}
          <label style={{ flex: 2 }}>Nombre<input value={nombre} onChange={e => setNombre(e.target.value)} required /></label>
          <label>Unidad<input value={unidad} onChange={e => setUnidad(e.target.value)} placeholder="unidad, jornada…" /></label>
          <label>Responsable<input value={responsable} onChange={e => setResponsable(e.target.value)} required /></label>
        </div>
        <div className="fila">
          <label style={{ flex: 2 }}>Descripción<input value={descripcion} onChange={e => setDescripcion(e.target.value)} /></label>
          <label>Precio de venta (opcional)<input value={precioVenta} onChange={e => setPrecioVenta(e.target.value)} placeholder="vacío" /></label>
          <label>Precio de costo (opcional)<input value={precioCosto} onChange={e => setPrecioCosto(e.target.value)} placeholder="vacío" /></label>
          <button className="primario" type="submit" disabled={ocupado}>{editando ? 'Guardar cambios' : 'Registrar ítem'}</button>
          {editando && <button type="button" onClick={() => { setEditando(null); setCodigo(''); setNombre(''); setUnidad(''); setDescripcion(''); setPrecioVenta(''); setPrecioCosto(''); }}>Cancelar</button>}
        </div>
      </form>
      {items.length === 0 ? (
        <p className="vacio">Catálogo vacío: registre servicios y materiales según se necesiten.</p>
      ) : (
        <table>
          <thead><tr><th>Código</th><th>Tipo</th><th>Nombre</th><th>Unidad</th><th className="numero">Precio venta</th><th className="numero">Precio costo</th><th>Estado</th><th></th></tr></thead>
          <tbody>
            {items.map(i => (
              <tr key={i.id}>
                <td>{i.codigo}</td>
                <td>{i.tipo}</td>
                <td>{i.nombre}</td>
                <td>{i.unidad ?? '—'}</td>
                <td className="numero">{i.precioVentaMinor ? `$${i.precioVentaMinor}` : '—'}</td>
                <td className="numero">{i.precioCostoMinor ? `$${i.precioCostoMinor}` : '—'}</td>
                <td>{i.activo ? 'Activo' : 'Inactivo'}</td>
                <td>
                  <button onClick={() => {
                    setEditando(i);
                    setNombre(i.nombre);
                    setUnidad(i.unidad ?? '');
                    setDescripcion(i.descripcion ?? '');
                    setPrecioVenta(i.precioVentaMinor ?? '');
                    setPrecioCosto(i.precioCostoMinor ?? '');
                  }}>Editar</button>{' '}
                  {i.activo ? (
                    <button onClick={() => void cambiarEstado(i, false)}>Desactivar</button>
                  ) : (
                    <button onClick={() => void cambiarEstado(i, true)}>Activar</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="menor">
        Los ítems no se borran: al desactivar, los documentos que los usan conservan su identidad y precios propios.
        Los precios son opcionales y empiezan vacíos.
      </p>
    </div>
  );
}
