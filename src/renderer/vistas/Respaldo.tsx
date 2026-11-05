import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import type { InfoRespaldo } from '../../shared/contratos';


export default function Respaldo() {
  const [respaldos, setRespaldos] = useState<InfoRespaldo[]>([]);
  const [mensaje, setMensaje] = useState<{ texto: string; tipo: 'ok' | 'error' } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [confirmando, setConfirmando] = useState<InfoRespaldo | null>(null);
  const [adjuntos, setAdjuntos] = useState<Array<{
    id: number;
    entidad: string;
    entidadId: string;
    nombreOriginal: string;
    hashSha256: string;
    creadoEn: string;
  }>>([]);
  const [entidadAdjunto, setEntidadAdjunto] = useState('compra');
  const [entidadIdAdjunto, setEntidadIdAdjunto] = useState('');
  const [responsable, setResponsable] = useState('');

  const cargar = useCallback(() => {
    void api().invocar('respaldo:listar').then(r => setRespaldos(r as InfoRespaldo[]));
  }, []);

  const cargarAdjuntos = useCallback(() => {
    void api().invocar('adjunto:listar', {}).then(r => setAdjuntos(r as never));
  }, []);

  useEffect(() => {
    cargar();
    cargarAdjuntos();
  }, [cargar, cargarAdjuntos]);

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

  async function restaurar(info: InfoRespaldo) {
    setConfirmando(null);
    setOcupado(true);
    setMensaje(null);
    try {
      const resultado = (await api().invocar('respaldo:restaurar', { nombre: info.nombre })) as { detalle: string };
      setMensaje({ texto: resultado.detalle, tipo: 'ok' });
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
          {ocupado && !confirmando ? 'Procesando…' : 'Crear respaldo ahora'}
        </button>
      </p>
      {confirmando && (
        <p className="aviso">
          ¿Restaurar «{confirmando.nombre}»? Se conservará una copia del estado actual antes de sustituir la base.
          <button onClick={() => void restaurar(confirmando)}>Sí, restaurar</button>{' '}
          <button onClick={() => setConfirmando(null)}>Cancelar</button>
        </p>
      )}
      {respaldos.length === 0 ? (
        <p className="vacio">Sin respaldos registrados.</p>
      ) : (
        <table>
          <thead>
            <tr><th>Fecha</th><th>Nombre</th><th>Versión esquema</th><th>Estado</th><th></th></tr>
          </thead>
          <tbody>
            {respaldos.map(r => (
              <tr key={r.nombre}>
                <td>{r.creadoEn}</td>
                <td>{r.nombre}</td>
                <td>{r.versionEsquema}</td>
                <td>{r.estado}</td>
                <td>
                  <button onClick={() => setConfirmando(r)} disabled={ocupado}>Restaurar</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="menor">
        Cada respaldo incluye manifiesto con hash SHA-256; la restauración verifica hash e integridad,
        preserva copia del estado anterior y queda registrada en la bitácora de la base restaurada.
      </p>
    </div>
  );
}
