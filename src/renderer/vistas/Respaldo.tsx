import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../api';

interface InfoRespaldo {
  id: number;
  creadoEn: string;
  nombre: string;
  hashSha256: string;
  versionApp: string;
  versionEsquema: number;
  estado: string;
}

export default function Respaldo() {
  const [respaldos, setRespaldos] = useState<InfoRespaldo[]>([]);
  const [mensaje, setMensaje] = useState<{ texto: string; tipo: 'ok' | 'error' } | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const cargar = useCallback(() => {
    void api().invocar('respaldo:listar').then(r => setRespaldos(r as InfoRespaldo[]));
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  async function crear() {
    setOcupado(true);
    setMensaje(null);
    try {
      const info = (await api().invocar('respaldo:crear')) as InfoRespaldo;
      setMensaje({ texto: `Respaldo creado: ${info.nombre} (hash ${info.hashSha256.slice(0, 12)}…)`, tipo: 'ok' });
      cargar();
    } catch (err) {
      setMensaje({ texto: String(err instanceof Error ? err.message : err), tipo: 'error' });
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div>
      <h1>Respaldo y restauración</h1>
      {mensaje && <p className={`aviso ${mensaje.tipo === 'error' ? 'error' : 'ok'}`}>{mensaje.texto}</p>}
      <p>
        <button className="primario" onClick={crear} disabled={ocupado}>
          {ocupado ? 'Creando respaldo…' : 'Crear respaldo ahora'}
        </button>
      </p>
      {respaldos.length === 0 ? (
        <p className="vacio">Sin respaldos registrados.</p>
      ) : (
        <table>
          <thead>
            <tr><th>Fecha</th><th>Nombre</th><th>Versión esquema</th><th>Estado</th></tr>
          </thead>
          <tbody>
            {respaldos.map(r => (
              <tr key={r.id}>
                <td>{r.creadoEn}</td>
                <td>{r.nombre}</td>
                <td>{r.versionEsquema}</td>
                <td>{r.estado}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="menor">
        La restauración se realiza desde la carpeta de respaldos del equipo y verifica hash e integridad
        antes de sustituir la base activa, preservando una copia del estado anterior.
      </p>
    </div>
  );
}
