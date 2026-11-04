import React, { useEffect, useState } from 'react';
import { api } from '../api';

interface Evento {
  id: number;
  fecha: string;
  actor: string;
  tipo: string;
  entidad: string;
  entidadId: string | null;
  detalle: string | null;
}

export default function Bitacora() {
  const [eventos, setEventos] = useState<Evento[]>([]);

  useEffect(() => {
    void api().invocar('bitacora:listar', { limite: 100 }).then(r => setEventos(r as Evento[]));
  }, []);

  return (
    <div>
      <h1>Bitácora</h1>
      {eventos.length === 0 ? (
        <p className="vacio">Sin eventos registrados.</p>
      ) : (
        <table>
          <thead>
            <tr><th>Fecha</th><th>Actor</th><th>Tipo</th><th>Entidad</th><th>Detalle</th></tr>
          </thead>
          <tbody>
            {eventos.map(e => (
              <tr key={e.id}>
                <td>{e.fecha}</td>
                <td>{e.actor}</td>
                <td>{e.tipo}</td>
                <td>{e.entidad}{e.entidadId ? ` #${e.entidadId}` : ''}</td>
                <td className="menor">{e.detalle}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
