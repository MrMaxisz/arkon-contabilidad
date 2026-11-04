import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { CuentaResumen, CompraResumen } from '../../shared/contratos';
import { fechaLocalElSalvador } from '../../shared/fechas';

interface Contraparte { id: number; nombre: string; esProveedor: boolean }
interface Proyecto { id: number; codigo: string; nombre: string }

interface LineaForm {
  descripcion: string;
  cuentaCodigo: string;
  cantidad: string;
  precioUnitario: string;
  tasa: string;
  tratamiento: 'gravado' | 'exento' | 'no_sujeto';
  precioConIva: boolean;
}

function nuevaClave(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `op-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function Compras() {
  const [compras, setCompras] = useState<CompraResumen[]>([]);
  const [proveedores, setProveedores] = useState<Contraparte[]>([]);
  const [proyectos, setProyectos] = useState<Proyecto[]>([]);
  const [proyectoId, setProyectoId] = useState(0);
  const [cuentas, setCuentas] = useState<CuentaResumen[]>([]);
  const [proveedorId, setProveedorId] = useState(0);
  const [fecha, setFecha] = useState(fechaLocalElSalvador());
  const [concepto, setConcepto] = useState('');
  const [condicion, setCondicion] = useState<'credito' | 'contado'>('credito');
  const [responsable, setResponsable] = useState('');
  const [lineas, setLineas] = useState<LineaForm[]>([
    { descripcion: '', cuentaCodigo: '5101', cantidad: '1', precioUnitario: '', tasa: '13', tratamiento: 'gravado', precioConIva: true }
  ]);
  const [mensaje, setMensaje] = useState<{ texto: string; tipo: 'ok' | 'error' } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const clave = useRef(nuevaClave());

  const cargar = useCallback(() => {
    void api().invocar('compra:listar').then(r => setCompras(r as CompraResumen[]));
    void api().invocar('contraparte:listar').then(r => setProveedores((r as Contraparte[]).filter(c => c.esProveedor)));
    void api().invocar('proyecto:listar').then(r => setProyectos(r as Proyecto[]));
    void api().invocar('cuenta:listar').then(r => setCuentas((r as CuentaResumen[]).filter(c => ['costo', 'gasto', 'activo'].includes(c.tipo) && !c.esGrupo)));
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  async function registrar(e: React.FormEvent) {
    e.preventDefault();
    if (ocupado) {
      return;
    }
    setOcupado(true);
    setMensaje(null);
    try {
      const r = (await api().invocar('compra:registrar', {
        contraparteId: proveedorId,
        proyectoId: proyectoId || undefined,
        fechaOperacion: fecha,
        concepto,
        condicion,
        lineas,
        claveIdempotencia: clave.current,
        responsable
      })) as { folio: string };
      setMensaje({ texto: `Compra ${r.folio} registrada y contabilizada.` , tipo: 'ok' });
      setConcepto('');
      setLineas([{ descripcion: '', cuentaCodigo: '5101', cantidad: '1', precioUnitario: '', tasa: '13', tratamiento: 'gravado', precioConIva: true }]);
      clave.current = nuevaClave();
      cargar();
    } catch (err) {
      setMensaje({ texto: String(err instanceof Error ? err.message : err), tipo: 'error' });
    } finally {
      setOcupado(false);
    }
  }

  async function anular(c: CompraResumen) {
    if (!responsable.trim()) {
      setMensaje({ texto: 'Registre el responsable antes de anular.', tipo: 'error' });
      return;
    }
    try {
      await api().invocar('documento:anular', { tipo: 'compra', documentoId: c.id, responsable: responsable.trim(), motivo: `Anulación de ${c.folio} desde la interfaz` });
      cargar();
    } catch (err) {
      setMensaje({ texto: String(err instanceof Error ? err.message : err), tipo: 'error' });
    }
  }

  return (
    <div>
      <h1>Compras y gastos</h1>
      {mensaje && <p className={`aviso ${mensaje.tipo === 'error' ? 'error' : 'ok'}`}>{mensaje.texto}</p>}
      <form onSubmit={registrar}>
        <h2>Registrar compra o gasto</h2>
        <div className="fila">
          <label>Proveedor
            <select value={proveedorId} onChange={e => setProveedorId(Number(e.target.value))} required>
              <option value={0}>— Seleccione —</option>
              {proveedores.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          </label>
          <label>Proyecto (opcional)
            <select value={proyectoId} onChange={e => setProyectoId(Number(e.target.value))}>
              <option value={0}>— Ninguno —</option>
              {proyectos.map(p => <option key={p.id} value={p.id}>{p.codigo} · {p.nombre}</option>)}
            </select>
          </label>
          <label>Fecha<input type="date" value={fecha} onChange={e => setFecha(e.target.value)} required /></label>
          <label style={{ flex: 2 }}>Concepto<input value={concepto} onChange={e => setConcepto(e.target.value)} required /></label>
          <label>Condición
            <select value={condicion} onChange={e => setCondicion(e.target.value as 'credito' | 'contado')}>
              <option value="credito">Crédito</option>
              <option value="contado">Contado</option>
            </select>
          </label>
          <label>Responsable<input value={responsable} onChange={e => setResponsable(e.target.value)} required /></label>
        </div>
        {lineas.map((l, i) => (
          <div className="fila" key={i}>
            <label style={{ flex: 2 }}>Descripción<input value={l.descripcion} onChange={e => {
              const copia = [...lineas];
              copia[i] = { ...l, descripcion: e.target.value };
              setLineas(copia);
            }} required /></label>
            <label>Cuenta
              <select value={l.cuentaCodigo} onChange={e => {
                const copia = [...lineas];
                copia[i] = { ...l, cuentaCodigo: e.target.value };
                setLineas(copia);
              }}>
                {cuentas.map(c => <option key={c.id} value={c.codigo}>{c.codigo} · {c.nombre}</option>)}
              </select>
            </label>
            <label>Cantidad<input value={l.cantidad} onChange={e => {
              const copia = [...lineas];
              copia[i] = { ...l, cantidad: e.target.value };
              setLineas(copia);
            }} required /></label>
            <label>Precio unitario<input value={l.precioUnitario} onChange={e => {
              const copia = [...lineas];
              copia[i] = { ...l, precioUnitario: e.target.value };
              setLineas(copia);
            }} required placeholder="0.00" /></label>
            <label>Tratamiento
              <select value={l.tratamiento} onChange={e => {
                const copia = [...lineas];
                copia[i] = { ...l, tratamiento: e.target.value as LineaForm['tratamiento'] };
                setLineas(copia);
              }}>
                <option value="gravado">Gravado</option>
                <option value="exento">Exento</option>
                <option value="no_sujeto">No sujeto</option>
              </select>
            </label>
            <label><input type="checkbox" checked={l.precioConIva} onChange={e => {
              const copia = [...lineas];
              copia[i] = { ...l, precioConIva: e.target.checked };
              setLineas(copia);
            }} /> IVA incluido</label>
            <label>Tasa %<input value={l.tasa} onChange={e => {
              const copia = [...lineas];
              copia[i] = { ...l, tasa: e.target.value };
              setLineas(copia);
            }} /></label>
            {lineas.length > 1 && <button type="button" onClick={() => setLineas(lineas.filter((_, j) => j !== i))}>Quitar</button>}
          </div>
        ))}
        <div className="fila">
          <button type="button" onClick={() => setLineas([...lineas, { descripcion: '', cuentaCodigo: '5101', cantidad: '1', precioUnitario: '', tasa: '13', tratamiento: 'gravado', precioConIva: true }])}>Agregar línea</button>
          <button className="primario" type="submit" disabled={ocupado}>{ocupado ? 'Registrando…' : 'Registrar y contabilizar'}</button>
        </div>
        <p className="menor">El IVA documentado del proveedor se conserva; no se clasifica como crédito fiscal automáticamente.</p>
      </form>

      <h2>Compras recientes</h2>
      {compras.length === 0 ? (
        <p className="vacio">Sin compras registradas.</p>
      ) : (
        <table>
          <thead><tr><th>Folio</th><th>Fecha</th><th>Concepto</th><th>Proveedor</th><th className="numero">Total</th><th className="numero">Saldo</th><th>Estado</th><th></th></tr></thead>
          <tbody>
            {compras.map(c => (
              <tr key={c.id}>
                <td>{c.folio}</td>
                <td>{c.fecha}</td>
                <td>{c.concepto}</td>
                <td>{c.contraparteNombre}</td>
                <td className="numero">${c.totalMinor}</td>
                <td className="numero">${c.saldoMinor}</td>
                <td>{c.estado}</td>
                <td>{c.estado === 'registrada' && <button onClick={() => void anular(c)}>Anular</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
