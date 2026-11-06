import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import type { InfoRespaldo } from '../../shared/contratos';
import { limpiarMensajeError } from '../limpiarMensajeError';


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
  const [intervaloMinutos, setIntervaloMinutos] = useState('0');
  const [retencionMinutos, setRetencionMinutos] = useState('5');
  const [vinculos, setVinculos] = useState<Record<string, Array<{ folio: string; concepto: string; fecha: string }>>>({ venta: [], compra: [], cotizacion: [], proyecto: [] });
  const [busquedaDocumento, setBusquedaDocumento] = useState('');
  const [estadoPeriodico, setEstadoPeriodico] = useState<{
    intervaloMinutos: number;
    ultimoRespaldo: { creadoEn: string; nombre: string } | null;
    ultimoFallo: { creadoEn: string; detalle: string } | null;
    proximaEjecucion: string | null;
  } | null>(null);

  const cargar = useCallback(() => {
    void api().invocar('respaldo:listar').then(r => setRespaldos(r as InfoRespaldo[]));
  }, []);

  const cargarAdjuntos = useCallback(() => {
    void api()
      .invocar('adjunto:listar', {})
      .then(r => setAdjuntos(r as never))
      .catch(() => setAdjuntos([]));
  }, []);

  const cargarVinculos = useCallback((busqueda: string) => {
    void api()
      .invocar('documento:listarVinculos', { busqueda, limite: 200 })
      .then(r => setVinculos(r as Record<string, Array<{ folio: string; concepto: string; fecha: string }>>))
      .catch(() => setVinculos({ venta: [], compra: [], cotizacion: [], proyecto: [] }));
  }, []);

  const cargarEstadoPeriodico = useCallback(() => {
    void api()
      .invocar('respaldo:estadoPeriodico')
      .then(r => setEstadoPeriodico(r as never))
      .catch(() => setEstadoPeriodico(null));
  }, []);

  useEffect(() => {
    cargar();
    cargarAdjuntos();
    cargarVinculos('');
    void api().invocar('config:respaldoPeriodicoLeer').then(r => {
      const config = r as { intervaloMinutos: number; retencion: number };
      setIntervaloMinutos(String(config.intervaloMinutos));
      setRetencionMinutos(String(config.retencion));
    });
    cargarEstadoPeriodico();
  }, [cargar, cargarAdjuntos, cargarVinculos, cargarEstadoPeriodico]);

  async function crear() {
    setOcupado(true);
    setMensaje(null);
    try {
      const info = (await api().invocar('respaldo:crear')) as InfoRespaldo;
      setMensaje({ texto: `Respaldo creado: ${info.nombre} (hash ${info.hashSha256.slice(0, 12)}…)`, tipo: 'ok' });
      cargar();
      cargarEstadoPeriodico();
    } catch (err) {
      setMensaje({ texto: limpiarMensajeError(err), tipo: 'error' });
    } finally {
      setOcupado(false);
    }
  }

  async function ejecutarPeriodico() {
    setOcupado(true);
    setMensaje(null);
    try {
      const r = (await api().invocar('respaldo:ejecutarPeriodico')) as { creado: boolean; nombre?: string; omitidoPor?: string };
      setMensaje({
        texto: r.creado
          ? `Respaldo periódico creado: ${r.nombre}.`
          : `Respaldo periódico omitido: ${r.omitidoPor ?? 'sin información'}.`,
        tipo: 'ok'
      });
      cargar();
      cargarEstadoPeriodico();
    } catch (err) {
      setMensaje({ texto: limpiarMensajeError(err), tipo: 'error' });
      cargarEstadoPeriodico();
    } finally {
      setOcupado(false);
    }
  }

  async function verificarAdjunto(id: number) {
    try {
      const r = (await api().invocar('adjunto:verificar', { id })) as { existe: boolean; hashCoincide: boolean; nombreOriginal: string };
      setMensaje({
        texto: r.existe && r.hashCoincide
          ? `Adjunto ${r.nombreOriginal} verificado: hash correcto.`
          : `Adjunto ${r.nombreOriginal}: ${r.existe ? 'hash NO coincide' : 'archivo ausente en disco'}.`,
        tipo: r.existe && r.hashCoincide ? 'ok' : 'error'
      });
    } catch (err) {
      setMensaje({ texto: limpiarMensajeError(err), tipo: 'error' });
    }
  }

  async function abrirAdjunto(id: number) {
    try {
      const r = (await api().abrirAdjunto(id)) as { abierto: boolean; nombreOriginal: string };
      setMensaje({ texto: `Adjunto ${r.nombreOriginal} abierto con la aplicación del sistema.`, tipo: 'ok' });
    } catch (err) {
      setMensaje({ texto: limpiarMensajeError(err), tipo: 'error' });
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
      cargarEstadoPeriodico();
    } catch (err) {
      setMensaje({ texto: limpiarMensajeError(err), tipo: 'error' });
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
      <h2>Adjuntos</h2>
      <form onSubmit={async e => {
        e.preventDefault();
        setMensaje(null);
        try {
          const r = (await api().registrarAdjunto(entidadAdjunto, entidadIdAdjunto, responsable)) as {
            registrado: boolean;
            adjunto?: { nombreOriginal: string; hashSha256: string };
          };
          if (r.registrado && r.adjunto) {
            setMensaje({
              texto: `Adjunto ${r.adjunto.nombreOriginal} registrado con hash ${r.adjunto.hashSha256.slice(0, 12)}…`,
              tipo: 'ok'
            });
          } else {
            setMensaje({ texto: 'Selección de archivo cancelada.', tipo: 'ok' });
          }
          cargarAdjuntos();
        } catch (err) {
          setMensaje({ texto: limpiarMensajeError(err), tipo: 'error' });
        }
      }}>
        <div className="fila">
          <label>Entidad
            <select value={entidadAdjunto} onChange={e => setEntidadAdjunto(e.target.value)} required>
              <option value="compra">Compra</option>
              <option value="venta">Venta</option>
              <option value="cotizacion">Cotización</option>
              <option value="proyecto">Proyecto</option>
            </select>
          </label>
          <label>Documento
            <input
              value={busquedaDocumento}
              onChange={e => {
                setBusquedaDocumento(e.target.value);
                cargarVinculos(e.target.value);
              }}
              placeholder="Buscar por folio o concepto"
            />
            <select value={entidadIdAdjunto} onChange={e => setEntidadIdAdjunto(e.target.value)} required>
              <option value="">— Seleccione documento —</option>
              {(vinculos[entidadAdjunto] ?? []).map(v => (
                <option key={v.folio} value={v.folio}>{v.folio} · {v.concepto} ({v.fecha})</option>
              ))}
            </select>
          </label>
          <label>Responsable<input value={responsable} onChange={e => setResponsable(e.target.value)} required /></label>
          <button className="primario" type="submit">Registrar adjunto…</button>
        </div>
      </form>
      {adjuntos.length === 0 ? (
        <p className="vacio">Sin adjuntos registrados.</p>
      ) : (
        <table>
          <thead><tr><th>Entidad</th><th>Documento</th><th>Archivo</th><th>Hash</th><th>Registrado</th><th></th></tr></thead>
          <tbody>
            {adjuntos.map(a => (
              <tr key={a.id}>
                <td>{a.entidad}</td>
                <td>{a.entidadId}</td>
                <td>{a.nombreOriginal}</td>
                <td className="menor">{a.hashSha256.slice(0, 16)}…</td>
                <td>{a.creadoEn}</td>
                <td>
                  <button type="button" onClick={() => void verificarAdjunto(a.id)}>Verificar</button>{' '}
                  <button type="button" onClick={() => void abrirAdjunto(a.id)}>Abrir</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>Respaldo periódico</h2>
      <form onSubmit={async e => {
        e.preventDefault();
        setMensaje(null);
        try {
          await api().invocar('config:respaldoPeriodicoGuardar', {
            intervaloMinutos: Number(intervaloMinutos) || 0,
            retencion: Number(retencionMinutos) || 5
          });
          setMensaje({ texto: 'Configuración de respaldo periódico guardada.', tipo: 'ok' });
          cargarEstadoPeriodico();
        } catch (err) {
          setMensaje({ texto: limpiarMensajeError(err), tipo: 'error' });
        }
      }}>
        <div className="fila">
          <label>Intervalo (minutos, 0 = desactivado)
            <input type="number" min="0" max="1440" value={intervaloMinutos} onChange={e => setIntervaloMinutos(e.target.value)} required />
          </label>
          <label>Retención (respaldos automáticos a conservar)
            <input type="number" min="1" max="50" value={retencionMinutos} onChange={e => setRetencionMinutos(e.target.value)} required />
          </label>
          <button className="primario" type="submit">Guardar configuración</button>
        </div>
      </form>
      {estadoPeriodico && (
        <div className="fila">
          <p className="menor">
            Intervalo: {estadoPeriodico.intervaloMinutos} min.{' '}
            {estadoPeriodico.ultimoRespaldo
              ? `Último respaldo automático: ${estadoPeriodico.ultimoRespaldo.nombre} (${estadoPeriodico.ultimoRespaldo.creadoEn}).`
              : 'Sin respaldos automáticos aún.'}
            {estadoPeriodico.proximaEjecucion && ` Próxima ejecución: ${estadoPeriodico.proximaEjecucion}.`}
          </p>
          {estadoPeriodico.ultimoFallo && (
            <p className="aviso error">
              Último fallo del respaldo periódico ({estadoPeriodico.ultimoFallo.creadoEn}): {estadoPeriodico.ultimoFallo.detalle}
            </p>
          )}
          <button type="button" disabled={ocupado} onClick={() => void ejecutarPeriodico()}>Ejecutar respaldo periódico ahora</button>
        </div>
      )}
      <p className="menor">
        Cada respaldo incluye manifiesto con hash SHA-256; la restauración verifica hash e integridad,
        preserva copia del estado anterior y queda registrada en la bitácora de la base restaurada.
      </p>
    </div>
  );
}
