import React, { useEffect, useState } from 'react';
import { api } from '../api';
import { BotonPrimario, BotonSecundario } from '../componentes';
import { limpiarMensajeError } from '../limpiarMensajeError';
import { formatearFechaHoraElSalvador } from '../../shared/fechas';

export default function RespaldoAndroid() {
  const [ultima, setUltima] = useState<{ fecha: string; nombre: string } | null>(null);
  const [mensaje, setMensaje] = useState('');
  const [error, setError] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  async function cargar() {
    setUltima(await api().invocar('traspaso:ultimaExportacion') as typeof ultima);
  }
  useEffect(() => { void cargar().catch(e => { setError(true); setMensaje(limpiarMensajeError(e)); }); }, []);
  async function ejecutar(comando: string) {
    setOcupado(true); setMensaje(''); setError(false);
    try {
      const r = await api().invocar(comando) as { detalle: string };
      setMensaje(r.detalle); await cargar();
    } catch (e) { setError(true); setMensaje(limpiarMensajeError(e)); }
    finally { setOcupado(false); }
  }
  return <div>
    <h1>Respaldo</h1>
    <p>Un solo dispositivo activo. Importar reemplaza la base del teléfono; no combina datos.</p>
    <p><BotonPrimario disabled={ocupado} onClick={() => void ejecutar('traspaso:exportar')}>Exportar del dispositivo</BotonPrimario>{' '}
      <BotonSecundario disabled={ocupado} onClick={() => void ejecutar('traspaso:importar')}>Importar al dispositivo</BotonSecundario></p>
    <p>{ultima ? `Última exportación: ${formatearFechaHoraElSalvador(ultima.fecha)} · ${ultima.nombre}` : 'Sin exportaciones completadas.'}</p>
    {mensaje && <p className={`aviso ${error ? 'error' : 'ok'}`}>{mensaje}</p>}
  </div>;
}
