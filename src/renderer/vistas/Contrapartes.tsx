import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../api';

interface Contraparte {
  id: number;
  nombre: string;
  esCliente: boolean;
  esProveedor: boolean;
  nrc: string | null;
  nit: string | null;
  activa: boolean;
}

export default function Contrapartes() {
  const [lista, setLista] = useState<Contraparte[]>([]);
  const [nombre, setNombre] = useState('');
  const [cliente, setCliente] = useState(false);
  const [proveedor, setProveedor] = useState(false);
  const [responsable, setResponsable] = useState('');
  const [mensaje, setMensaje] = useState<{ texto: string; tipo: 'ok' | 'error' } | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const cargar = useCallback(() => {
    void api().invocar('contraparte:listar').then(r => setLista(r as Contraparte[]));
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
      setMensaje({ texto: String(err instanceof Error ? err.message : err), tipo: 'error' });
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div>
      <h1>Clientes y proveedores</h1>
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
          <button className="primario" type="submit" disabled={ocupado}>Registrar</button>
        </div>
        <p className="menor">NRC/NIT y clasificación tributaria se completan cuando existan; no se crean identificaciones ficticias.</p>
      </form>
      {lista.length === 0 ? (
        <p className="vacio">Sin contrapartes registradas.</p>
      ) : (
        <table>
          <thead>
            <tr><th>Nombre</th><th>Cliente</th><th>Proveedor</th><th>NRC</th><th>NIT</th></tr>
          </thead>
          <tbody>
            {lista.map(c => (
              <tr key={c.id}>
                <td>{c.nombre}</td>
                <td>{c.esCliente ? 'Sí' : ''}</td>
                <td>{c.esProveedor ? 'Sí' : ''}</td>
                <td>{c.nrc ?? '—'}</td>
                <td>{c.nit ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
