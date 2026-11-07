import React, { useEffect, useState } from 'react';
import { api } from '../api';
import { EstadoSinResultados, Paginacion } from '../componentes';

interface Evento {
  id: number;
  fecha: string;
  actor: string;
  tipo: string;
  entidad: string;
  entidadId: string | null;
  detalle: string | null;
}

// Bitácora con búsqueda y paginación visibles (bloque 5D).
const TAMANO_PAGINA = 50;
const LIMITE_CONSULTA = 500;

export default function Bitacora() {
  const [eventos, setEventos] = useState<Evento[]>([]);
  const [busqueda, setBusqueda] = useState('');
  const [pagina, setPagina] = useState(0);

  useEffect(() => {
    void api().invocar('bitacora:listar', { limite: LIMITE_CONSULTA }).then(r => setEventos(r as Evento[]));
  }, []);

  const texto = busqueda.trim().toLowerCase();
  const filtrados = eventos.filter(e =>
    !texto ||
    [e.fecha, e.actor, e.tipo, e.entidad, e.entidadId ?? '', e.detalle ?? '']
      .some(valor => valor.toLowerCase().includes(texto))
  );
  const visibles = filtrados.slice(pagina * TAMANO_PAGINA, (pagina + 1) * TAMANO_PAGINA);

  return (
    <div>
      <h1>Bitácora</h1>
      <div className="fila no-imprimir">
        <label>Buscar evento
          <input
            value={busqueda}
            onChange={e => {
              setBusqueda(e.target.value);
              setPagina(0);
            }}
            placeholder="Fecha, actor, tipo, entidad o detalle"
          />
        </label>
      </div>
      {eventos.length === 0 ? (
        <p className="vacio">Sin eventos registrados.</p>
      ) : filtrados.length === 0 ? (
        <EstadoSinResultados texto="Ningún evento coincide con la búsqueda." />
      ) : (
        <>
          <table>
            <thead>
              <tr><th>Fecha</th><th>Actor</th><th>Tipo</th><th>Entidad</th><th>Detalle</th></tr>
            </thead>
            <tbody>
              {visibles.map(e => (
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
          <Paginacion
            elemento="evento"
            total={filtrados.length}
            pagina={pagina}
            tamano={TAMANO_PAGINA}
            enAnteriores={() => setPagina(p => Math.max(0, p - 1))}
            enSiguientes={() => setPagina(p => p + 1)}
          />
        </>
      )}
    </div>
  );
}
