import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { mensajeImpresionAndroid } from '../mensajeImpresionAndroid';
import { limpiarMensajeError } from '../limpiarMensajeError';
import { BotonSecundario, BotonPrimario, EstadoCarga, EstadoVacio, EstadoError, formatoDineroPantalla } from '../componentes';

interface PartidaResumen {
  id: number;
  folio: string;
  numero: number;
  fecha: string;
  concepto: string;
  estado: string;
  origen: string;
  responsable: string;
  totalMinor: string;
}

interface PartidaDetalle {
  id: number;
  folio: string;
  fecha: string;
  concepto: string;
  estado: string;
  origen: string;
  origenId: string;
  responsable: string;
  motivo: string;
  lineas: Array<{ cuentaCodigo: string; cuentaNombre: string; debeMinor: string; haberMinor: string }>;
  totalDebeMinor: string;
  totalHaberMinor: string;
  reversoDe: { id: number; folio: string } | null;
  reverso: { id: number; folio: string } | null;
}

interface CuentaOpcion { id: number; codigo: string; nombre: string }

const TAMANO_PAGINA = 20;

export default function LibroDiario() {
  const [partidas, setPartidas] = useState<PartidaResumen[]>([]);
  const [total, setTotal] = useState(0);
  const [pagina, setPagina] = useState(0);
  const [busqueda, setBusqueda] = useState('');
  const [desdeFecha, setDesdeFecha] = useState('');
  const [hastaFecha, setHastaFecha] = useState('');
  const [concepto, setConcepto] = useState('');
  const [cuentaId, setCuentaId] = useState(0);
  const [cuentas, setCuentas] = useState<CuentaOpcion[]>([]);
  const [detalle, setDetalle] = useState<PartidaDetalle | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const consultaId = useRef(0);

  useEffect(() => {
    void api().invocar('cuenta:listar').then(r => setCuentas((r as CuentaOpcion[]).filter((c: CuentaOpcion & { esGrupo?: boolean }) => !c.esGrupo)));
  }, []);

  const cargar = useCallback(() => {
    const numeroConsulta = ++consultaId.current;
    setCargando(true);
    void api()
      .invocar('libro:partidas', {
        busqueda: busqueda || undefined,
        desdeFecha: desdeFecha || undefined,
        hastaFecha: hastaFecha || undefined,
        concepto: concepto || undefined,
        cuentaId: cuentaId || undefined,
        desde: pagina * TAMANO_PAGINA,
        limite: TAMANO_PAGINA
      })
      .then(r => {
        if (consultaId.current !== numeroConsulta) {
          return; // respuesta tardía descartada (auditoría 72)
        }
        const resultado = r as { partidas: PartidaResumen[]; total: number };
        setPartidas(resultado.partidas);
        setTotal(resultado.total);
      })
      .catch(err => {
        if (consultaId.current === numeroConsulta) {
          setMensaje(limpiarMensajeError(err));
        }
      })
      .finally(() => {
        if (consultaId.current === numeroConsulta) {
          setCargando(false);
        }
      });
  }, [busqueda, desdeFecha, hastaFecha, concepto, cuentaId, pagina]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  function verPartida(id: number) {
    setMensaje(null);
    void api()
      .invocar('libro:partida', { partidaId: id, ambitoId: 'administrativo' })
      .then(r => setDetalle(r as PartidaDetalle))
      .catch(err => setMensaje(limpiarMensajeError(err)));
  }

  async function imprimirPartida() {
    if (!detalle) {
      return;
    }
    try {
      const r = (await api().reportePdf({
        titulo: `Partida ${detalle.folio}`,
        periodo: `${detalle.fecha} · ${detalle.concepto} · Responsable: ${detalle.responsable} · Estado: ${detalle.estado}${detalle.motivo ? ` · Motivo: ${detalle.motivo}` : ''}`,
        ambito: 'administrativo',
        tablas: [
          {
            encabezados: ['Cuenta', 'Nombre', 'Debe', 'Haber'],
            filas: detalle.lineas.map(l => [l.cuentaCodigo, l.cuentaNombre, formatoDineroPantalla(l.debeMinor), formatoDineroPantalla(l.haberMinor)]),
            total: ['Totales', '', formatoDineroPantalla(detalle.totalDebeMinor), formatoDineroPantalla(detalle.totalHaberMinor)]
          }
        ]
      })) as { guardado: boolean; ruta?: string };
      setMensaje(mensajeImpresionAndroid(r) ?? (r.guardado && r.ruta ? `Partida guardada en ${r.ruta}.` : 'Impresión cancelada.'));
    } catch (err) {
      setMensaje(limpiarMensajeError(err));
    }
  }

  async function imprimirRango() {
    setMensaje(null);
    try {
      // El rango filtrado COMPLETO: recorre todas las páginas, no solo la visible (auditoría 72).
      const todas: PartidaResumen[] = [];
      let totalAcumulado = 0;
      for (let paginaLibro = 0; ; paginaLibro += 1) {
        const r = (await api().invocar('libro:partidas', {
          busqueda: busqueda || undefined,
          desdeFecha: desdeFecha || undefined,
          hastaFecha: hastaFecha || undefined,
          concepto: concepto || undefined,
          cuentaId: cuentaId || undefined,
          desde: paginaLibro * TAMANO_PAGINA,
          limite: TAMANO_PAGINA
        })) as { partidas: PartidaResumen[]; total: number };
        todas.push(...r.partidas);
        totalAcumulado = r.total;
        if (todas.length >= r.total || r.partidas.length === 0) {
          break;
        }
      }
      const periodo = desdeFecha || hastaFecha ? `${desdeFecha || 'inicio'} a ${hastaFecha || 'hoy'}` : 'todos los períodos';
      const r = (await api().reportePdf({
        titulo: 'Libro diario',
        periodo: `${periodo} · ${totalAcumulado} partida(s)`,
        ambito: 'administrativo',
        tablas: [
          {
            encabezados: ['Folio', 'Fecha', 'Concepto', 'Estado', 'Total'],
            filas: todas.map(p => [p.folio, p.fecha, p.concepto, p.estado, formatoDineroPantalla(p.totalMinor)])
          }
        ]
      })) as { guardado: boolean; ruta?: string };
      setMensaje(mensajeImpresionAndroid(r) ?? (r.guardado && r.ruta ? `Libro guardado en ${r.ruta} (${totalAcumulado} partidas).` : 'Impresión cancelada.'));
    } catch (err) {
      setMensaje(limpiarMensajeError(err));
    }
  }

  return (
    <div>
      <h1>Libro diario</h1>
      {mensaje && <EstadoError mensaje={mensaje} />}
      <div className="fila no-imprimir">
        <label>Búsqueda por número
          <input value={busqueda} onChange={e => { setBusqueda(e.target.value); setPagina(0); }} placeholder="150, A-150, A-000150 o texto" />
        </label>
        <label>Desde
          <input type="date" value={desdeFecha} onChange={e => { setDesdeFecha(e.target.value); setPagina(0); }} />
        </label>
        <label>Hasta
          <input type="date" value={hastaFecha} onChange={e => { setHastaFecha(e.target.value); setPagina(0); }} />
        </label>
        <label>Concepto
          <input value={concepto} onChange={e => { setConcepto(e.target.value); setPagina(0); }} />
        </label>
        <label style={{ minWidth: 240 }}>Cuenta
          <select value={cuentaId} onChange={e => { setCuentaId(Number(e.target.value)); setPagina(0); }}>
            <option value={0}>— Todas —</option>
            {cuentas.map(c => <option key={c.id} value={c.id}>{c.codigo} · {c.nombre}</option>)}
          </select>
        </label>
        <BotonSecundario onClick={() => void imprimirRango()}>Imprimir libro…</BotonSecundario>
      </div>
      {cargando && <EstadoCarga texto="Consultando libro diario…" />}
      {!cargando && partidas.length === 0 && <EstadoVacio texto="Sin partidas para los filtros indicados." />}
      {!cargando && partidas.length > 0 && (
        <table>
          <thead><tr><th>Folio</th><th>Fecha</th><th>Concepto</th><th>Origen</th><th>Estado</th><th className="numero">Total</th><th></th></tr></thead>
          <tbody>
            {partidas.map(p => (
              <tr key={p.id}>
                <td className="folio">{p.folio}</td>
                <td>{p.fecha}</td>
                <td>{p.concepto}</td>
                <td>{p.origen || '—'}</td>
                <td>{p.estado === 'anulado' ? 'Anulada' : p.estado}</td>
                <td className="numero">{formatoDineroPantalla(p.totalMinor)}</td>
                <td><button onClick={() => verPartida(p.id)}>Ver</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="menor">
        {total} partida(s) · Página {pagina + 1} de {Math.max(1, Math.ceil(total / TAMANO_PAGINA))}
      </p>
      <div className="fila no-imprimir">
        <BotonSecundario disabled={pagina === 0} onClick={() => setPagina(p => Math.max(0, p - 1))}>Anteriores</BotonSecundario>
        <BotonSecundario disabled={(pagina + 1) * TAMANO_PAGINA >= total} onClick={() => setPagina(p => p + 1)}>Siguientes</BotonSecundario>
      </div>

      {detalle && (
        <div role="dialog" aria-label={`Partida ${detalle.folio}`}>
          <h2>Partida {detalle.folio}</h2>
          <p className="menor">
            {detalle.fecha} · {detalle.concepto} · Responsable: {detalle.responsable} · Estado: {detalle.estado}
            {detalle.origen ? ` · Origen: ${detalle.origen}${detalle.origenId ? ` ${detalle.origenId}` : ''}` : ''}
            {detalle.motivo ? ` · Motivo: ${detalle.motivo}` : ''}
            {detalle.reversoDe ? ` · Reverso de: ${detalle.reversoDe.folio}` : ''}
            {detalle.reverso ? ` · Reversada por: ${detalle.reverso.folio}` : ''}
          </p>
          <table>
            <thead><tr><th>Cuenta</th><th>Nombre</th><th className="numero">Debe</th><th className="numero">Haber</th></tr></thead>
            <tbody>
              {detalle.lineas.map((l, i) => (
                <tr key={i}>
                  <td className="folio">{l.cuentaCodigo}</td>
                  <td>{l.cuentaNombre}</td>
                  <td className="numero">{formatoDineroPantalla(l.debeMinor)}</td>
                  <td className="numero">{formatoDineroPantalla(l.haberMinor)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="total">
                <td>Totales</td>
                <td></td>
                <td className="numero">{formatoDineroPantalla(detalle.totalDebeMinor)}</td>
                <td className="numero">{formatoDineroPantalla(detalle.totalHaberMinor)}</td>
              </tr>
            </tfoot>
          </table>
          <div className="fila no-imprimir">
            <BotonPrimario onClick={() => void imprimirPartida()}>Imprimir partida…</BotonPrimario>
            <BotonSecundario onClick={() => setDetalle(null)}>Cerrar</BotonSecundario>
          </div>
        </div>
      )}
    </div>
  );
}
