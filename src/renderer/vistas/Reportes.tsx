import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';

interface FilaAuxiliar {
  contraparteId: number;
  contraparteNombre: string;
  saldoMinor: string;
}

interface AuxiliarContrapartes {
  clientes: FilaAuxiliar[];
  proveedores: FilaAuxiliar[];
  totalClientesMinor: string;
  totalProveedoresMinor: string;
  conciliaMayor: boolean;
}

interface FilaAuxiliarEfectivo {
  cuentaId: number;
  codigo: string;
  nombre: string;
  saldoMinor: string;
}

interface AuxiliarEfectivo {
  cuentas: FilaAuxiliarEfectivo[];
  totalMinor: string;
  conciliaMayor: boolean;
}

interface DocumentoDetalle {
  folio: string;
  fecha: string;
  concepto: string;
  totalMinor: string;
  aplicadoMinor: string;
  saldoMinor: string;
}

interface DetalleContraparte {
  contraparteId: number;
  contraparteNombre: string;
  saldoMinor: string;
  documentos: DocumentoDetalle[];
}

interface ContraparteOpcion { id: number; nombre: string; esCliente: boolean; esProveedor: boolean }

export default function Reportes() {
  const [auxiliarContrapartes, setAuxiliarContrapartes] = useState<AuxiliarContrapartes | null>(null);
  const [auxiliarEfectivo, setAuxiliarEfectivo] = useState<AuxiliarEfectivo | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [contrapartes, setContrapartes] = useState<ContraparteOpcion[]>([]);
  const [tipoDetalle, setTipoDetalle] = useState<'cliente' | 'proveedor'>('cliente');
  const [contraparteId, setContraparteId] = useState(0);
  const [corte, setCorte] = useState('');
  const [detalle, setDetalle] = useState<DetalleContraparte | null>(null);
  const consultaDetalle = useRef(0);
  const [paqueteDesde, setPaqueteDesde] = useState('');
  const [paqueteHasta, setPaqueteHasta] = useState('');

  const cargarDetalle = useCallback(() => {
    const numeroConsulta = ++consultaDetalle.current;
    if (!contraparteId) {
      setDetalle(null);
      return;
    }
    setDetalle(null);
    void api()
      .invocar('auxiliar:contraparteDetalle', {
        tipo: tipoDetalle,
        contraparteId,
        hastaFecha: corte || undefined
      })
      .then(r => {
        if (consultaDetalle.current === numeroConsulta) {
          setDetalle(r as DetalleContraparte);
        }
      })
      .catch(err => {
        if (consultaDetalle.current === numeroConsulta) {
          setDetalle(null);
          setMensaje(`Error al consultar detalle: ${String(err instanceof Error ? err.message : err)}`);
        }
      });
  }, [tipoDetalle, contraparteId, corte]);

  useEffect(() => {
    void api().invocar('contraparte:listar').then(r => setContrapartes(r as ContraparteOpcion[]));
  }, []);

  useEffect(() => {
    cargarDetalle();
  }, [cargarDetalle]);

  async function guardarCsv(tipo: 'cliente' | 'proveedor' | 'efectivo') {
    setMensaje(null);
    try {
      const r = (await api().guardarCsvAuxiliar({ tipo, alcance: 'resumen' })) as { guardado: boolean; ruta?: string };
      setMensaje(r.guardado && r.ruta ? `Auxiliar guardado en ${r.ruta}.` : 'Guardado cancelado.');
    } catch (err) {
      setMensaje(`Error al guardar: ${String(err instanceof Error ? err.message : err)}`);
    }
  }

  async function guardarPaquete() {
    setMensaje(null);
    try {
      const r = (await api().guardarPaqueteContador(paqueteDesde, paqueteHasta)) as {
        guardado: boolean;
        ruta?: string;
        archivos?: string[];
      };
      setMensaje(
        r.guardado && r.ruta
          ? `Paquete guardado en ${r.ruta} (${r.archivos?.length ?? 0} archivos).`
          : 'Guardado de paquete cancelado.'
      );
    } catch (err) {
      setMensaje(`Error al guardar el paquete: ${String(err instanceof Error ? err.message : err)}`);
    }
  }

  async function guardarCsvDetalle() {
    setMensaje(null);
    try {
      const r = (await api().guardarCsvAuxiliar({
        tipo: tipoDetalle,
        alcance: 'detalle',
        contraparteId,
        hastaFecha: corte || undefined
      })) as { guardado: boolean; ruta?: string };
      setMensaje(r.guardado && r.ruta ? `Detalle guardado en ${r.ruta}.` : 'Guardado cancelado.');
    } catch (err) {
      setMensaje(`Error al guardar detalle: ${String(err instanceof Error ? err.message : err)}`);
    }
  }

  const cargar = useCallback(() => {
    void api()
      .invocar('auxiliar:contrapartes')
      .then(r => setAuxiliarContrapartes(r as AuxiliarContrapartes))
      .catch(err => setMensaje(`Error al consultar auxiliar de contrapartes: ${String(err instanceof Error ? err.message : err)}`));
    void api()
      .invocar('auxiliar:efectivo')
      .then(r => setAuxiliarEfectivo(r as AuxiliarEfectivo))
      .catch(err => setMensaje(`Error al consultar auxiliar de efectivo: ${String(err instanceof Error ? err.message : err)}`));
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  return (
    <div>
      <h1>Reportes y auxiliares</h1>
      {mensaje && <p className="aviso">{mensaje}</p>}

      <h2>Auxiliar de clientes</h2>
      {auxiliarContrapartes && auxiliarContrapartes.clientes.length > 0 ? (
        <>
          <table>
            <thead><tr><th>Cliente</th><th className="numero">Saldo por cobrar</th></tr></thead>
            <tbody>
              {auxiliarContrapartes.clientes.map(c => (
                <tr key={c.contraparteId}>
                  <td>{c.contraparteNombre}</td>
                  <td className="numero">${c.saldoMinor}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="menor">Total clientes: ${auxiliarContrapartes.totalClientesMinor}</p>
        </>
      ) : (
        <p className="vacio">Sin saldos pendientes de clientes.</p>
      )}

      <h2>Auxiliar de proveedores</h2>
      {auxiliarContrapartes && auxiliarContrapartes.proveedores.length > 0 ? (
        <>
          <table>
            <thead><tr><th>Proveedor</th><th className="numero">Saldo por pagar</th></tr></thead>
            <tbody>
              {auxiliarContrapartes.proveedores.map(p => (
                <tr key={p.contraparteId}>
                  <td>{p.contraparteNombre}</td>
                  <td className="numero">${p.saldoMinor}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="menor">Total proveedores: ${auxiliarContrapartes.totalProveedoresMinor}</p>
        </>
      ) : (
        <p className="vacio">Sin saldos pendientes de proveedores.</p>
      )}

      {auxiliarContrapartes && (
        <p className={`aviso ${auxiliarContrapartes.conciliaMayor ? 'ok' : 'error'}`}>
          {auxiliarContrapartes.conciliaMayor
            ? 'Los auxiliares de clientes y proveedores concilian con el mayor.'
            : 'Los auxiliares de clientes y proveedores NO concilian con el mayor; revisa las operaciones.'}
        </p>
      )}

      <h2>Auxiliar de caja y bancos</h2>
      {auxiliarEfectivo && auxiliarEfectivo.cuentas.length > 0 ? (
        <>
          <table>
            <thead><tr><th>Cuenta</th><th className="numero">Saldo</th></tr></thead>
            <tbody>
              {auxiliarEfectivo.cuentas.map(c => (
                <tr key={c.cuentaId}>
                  <td>{c.codigo} · {c.nombre}</td>
                  <td className="numero">${c.saldoMinor}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="menor">Total efectivo: ${auxiliarEfectivo.totalMinor}</p>
        </>
      ) : (
        <p className="vacio">Sin movimientos de efectivo.</p>
      )}
      {auxiliarEfectivo && (
        <p className={`aviso ${auxiliarEfectivo.conciliaMayor ? 'ok' : 'error'}`}>
          {auxiliarEfectivo.conciliaMayor
            ? 'El auxiliar de caja y bancos concilia con el mayor.'
            : 'El auxiliar de caja y bancos NO concilia con el mayor.'}
        </p>
      )}
      <h2>Detalle por documentos</h2>
      <div className="fila">
        <label>Tipo
          <select value={tipoDetalle} onChange={e => { setTipoDetalle(e.target.value as 'cliente' | 'proveedor'); setContraparteId(0); }}>
            <option value="cliente">Cliente</option>
            <option value="proveedor">Proveedor</option>
          </select>
        </label>
        <label style={{ minWidth: 280 }}>
          {tipoDetalle === 'cliente' ? 'Cliente' : 'Proveedor'}
          <select value={contraparteId} onChange={e => setContraparteId(Number(e.target.value))}>
            <option value={0}>— Seleccione —</option>
            {contrapartes
              .filter(c => tipoDetalle === 'cliente' ? c.esCliente : c.esProveedor)
              .map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </label>
        <label>Fecha de corte
          <input type="date" value={corte} onChange={e => setCorte(e.target.value)} />
        </label>
      </div>
      {detalle && (
        <>
          <p className="menor">Saldo al corte: ${detalle.saldoMinor}</p>
          {detalle.documentos.length === 0 ? (
            <p className="vacio">Sin documentos al corte seleccionado.</p>
          ) : (
            <table>
              <thead><tr><th>Folio</th><th>Fecha</th><th>Concepto</th><th className="numero">Total</th><th className="numero">Aplicado</th><th className="numero">Saldo</th></tr></thead>
              <tbody>
                {detalle.documentos.map(d => (
                  <tr key={d.folio}>
                    <td>{d.folio}</td>
                    <td>{d.fecha}</td>
                    <td>{d.concepto}</td>
                    <td className="numero">${d.totalMinor}</td>
                    <td className="numero">${d.aplicadoMinor}</td>
                    <td className="numero">${d.saldoMinor}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}

      <h2>Exportación</h2>
      <div className="fila">
        <label>Paquete para el contador desde
          <input type="date" value={paqueteDesde} onChange={e => setPaqueteDesde(e.target.value)} />
        </label>
        <label>hasta
          <input type="date" value={paqueteHasta} onChange={e => setPaqueteHasta(e.target.value)} />
        </label>
        <button
          disabled={!paqueteDesde || !paqueteHasta}
          onClick={() => void guardarPaquete()}
        >
          Guardar paquete para el contador…
        </button>
      </div>
      <div className="fila">
        <button onClick={() => void guardarCsv('cliente')}>Guardar resumen de clientes (actual)…</button>
        <button onClick={() => void guardarCsv('proveedor')}>Guardar resumen de proveedores (actual)…</button>
        <button onClick={() => void guardarCsv('efectivo')}>Guardar resumen de caja y bancos (actual)…</button>
        <button disabled={!contraparteId} onClick={() => void guardarCsvDetalle()}>
          Guardar detalle al corte seleccionado…
        </button>
      </div>
      <p className="menor">
        Los auxiliares derivan de asientos y aplicaciones; no almacenan saldos independientes.
        El CSV se genera desde el mismo modelo mostrado. El cierre contable de ejercicio se completa después con reglas explícitas.
      </p>
    </div>
  );
}
