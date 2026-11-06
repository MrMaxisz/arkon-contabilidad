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
  itemId?: number;
}

interface Item {
  id: number;
  codigo: string;
  nombre: string;
  precioCostoMinor: string | null;
  activo: boolean;
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
  const [clasificacion, setClasificacion] = useState('');
  const [items, setItems] = useState<Item[]>([]);
  const [tipoDocumento, setTipoDocumento] = useState('');
  const [responsable, setResponsable] = useState('');
  const [lineas, setLineas] = useState<LineaForm[]>([
    { descripcion: '', cuentaCodigo: '5101', cantidad: '1', precioUnitario: '', tasa: '13', tratamiento: 'gravado', precioConIva: true }
  ]);
  const [mensaje, setMensaje] = useState<{ texto: string; tipo: 'ok' | 'error' } | null>(null);
  const [clasificando, setClasificando] = useState<CompraResumen | null>(null);
  const [clasValor, setClasValor] = useState('');
  const [tipoDocValor, setTipoDocValor] = useState('');
  const [motivoClas, setMotivoClas] = useState('');
  const [mesFiltro, setMesFiltro] = useState('');
  const [pagina, setPagina] = useState(0);
  const [ocupado, setOcupado] = useState(false);
  const clave = useRef(nuevaClave());

  const cargaDocumentosId = useRef(0);

  const cargarCatalogos = useCallback(() => {
    void api().invocar('contraparte:listar').then(r => setProveedores((r as Contraparte[]).filter(c => c.esProveedor)));
    void api().invocar('proyecto:listar').then(r => setProyectos(r as Proyecto[]));
    void api().invocar('cuenta:listar').then(r => setCuentas((r as CuentaResumen[]).filter(c => ['costo', 'gasto', 'activo'].includes(c.tipo) && !c.esGrupo)));
    void api().invocar('item:listar', { soloActivos: true }).then(r => setItems(r as Item[]));
  }, []);

  const cargarDocumentos = useCallback(() => {
    const id = ++cargaDocumentosId.current;
    api()
      .invocar('compra:listar', { mes: mesFiltro || undefined, limite: 100, desde: pagina * 100 })
      .then(r => {
        if (cargaDocumentosId.current === id) {
          setCompras(r as CompraResumen[]);
        }
      })
      .catch(err => {
        if (cargaDocumentosId.current === id) {
          setMensaje({ texto: String(err instanceof Error ? err.message : err), tipo: 'error' });
        }
      });
  }, [mesFiltro, pagina]);

  useEffect(() => {
    cargarCatalogos();
  }, [cargarCatalogos]);

  useEffect(() => {
    cargarDocumentos();
  }, [cargarDocumentos]);

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
        clasificacionDocumento: clasificacion || undefined,
        tipoDocumento: tipoDocumento || undefined,
        lineas,
        claveIdempotencia: clave.current,
        responsable
      })) as { folio: string };
      setMensaje({ texto: `Compra ${r.folio} registrada y contabilizada.` , tipo: 'ok' });
      setConcepto('');
      setLineas([{ descripcion: '', cuentaCodigo: '5101', cantidad: '1', precioUnitario: '', tasa: '13', tratamiento: 'gravado', precioConIva: true }]);
      clave.current = nuevaClave();
      cargarDocumentos();
      setTimeout(() => avisoRef.current?.scrollIntoView({ block: 'center' }), 0);
    } catch (err) {
      setMensaje({ texto: String(err instanceof Error ? err.message : err), tipo: 'error' });
    } finally {
      setOcupado(false);
    }
  }

  const [anulando, setAnulando] = useState<CompraResumen | null>(null);
  const [motivoAnular, setMotivoAnular] = useState('');
  const [responsableAnular, setResponsableAnular] = useState('');
  const [ocupadoAnular, setOcupadoAnular] = useState(false);
  const [errorAnular, setErrorAnular] = useState<string | null>(null);
  const avisoRef = useRef<HTMLParagraphElement | null>(null);

  function abrirAnulacion(c: CompraResumen) {
    setAnulando(c);
    setMotivoAnular('');
    setResponsableAnular(responsable.trim());
    setErrorAnular(null);
  }

  function cancelarAnulacion() {
    setAnulando(null);
    setMotivoAnular('');
    setResponsableAnular('');
    setOcupadoAnular(false);
    setErrorAnular(null);
  }

  async function confirmarAnulacion(e: React.FormEvent) {
    e.preventDefault();
    if (!anulando || ocupadoAnular) {
      return;
    }
    if (motivoAnular.trim().length < 10) {
      setErrorAnular('La anulación exige un motivo significativo (mínimo 10 caracteres).');
      return;
    }
    if (!responsableAnular.trim()) {
      setErrorAnular('La anulación exige responsable.');
      return;
    }
    setOcupadoAnular(true);
    setMensaje(null);
    try {
      await api().invocar('documento:anular', {
        tipo: 'compra',
        documentoId: anulando.id,
        responsable: responsableAnular.trim(),
        motivo: motivoAnular.trim()
      });
      setMensaje({ texto: `Compra ${anulando.folio} anulada con reverso contable; motivo registrado en bitácora.`, tipo: 'ok' });
      setAnulando(null);
      setMotivoAnular('');
      setResponsableAnular('');
      cargarDocumentos();
      setTimeout(() => avisoRef.current?.scrollIntoView({ block: 'center' }), 0);
    } catch (err) {
      setErrorAnular(limpiarMensajeError(err));
    } finally {
      setOcupadoAnular(false);
    }
  }

  return (
    <div>
      <h1>Compras y gastos</h1>
      <p ref={avisoRef}>{mensaje && <span className={`aviso ${mensaje.tipo === 'error' ? 'error' : 'ok'}`}>{mensaje.texto}</span>}</p>
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
        <div className="fila">
          <label>Clasificación del emisor
            <select value={clasificacion} onChange={e => setClasificacion(e.target.value)}>
              <option value="">— Pendiente —</option>
              <option value="contribuyente">Contribuyente</option>
              <option value="consumidor_final">Consumidor final</option>
              <option value="otro">Otro</option>
            </select>
          </label>
          <label>Tipo de documento
            <select value={tipoDocumento} onChange={e => setTipoDocumento(e.target.value)}>
              <option value="">— Pendiente —</option>
              <option value="factura">Factura</option>
              <option value="ccf">Crédito fiscal</option>
              <option value="recibo">Recibo</option>
              <option value="otro">Otro</option>
            </select>
          </label>
        </div>
        {lineas.map((l, i) => (
          <div className="fila" key={i}>
            <label>Ítem del catálogo
              <select
                value={l.itemId ?? 0}
                onChange={e => {
                  const itemId = Number(e.target.value);
                  const item = items.find(it => it.id === itemId);
                  const copia = [...lineas];
                  copia[i] = {
                    ...l,
                    itemId: itemId || undefined,
                    descripcion: item ? item.nombre : l.descripcion,
                    precioUnitario: item ? (item.precioCostoMinor ?? '') : l.precioUnitario
                  };
                  setLineas(copia);
                }}
              >
                <option value={0}>— Libre —</option>
                {items.map(it => <option key={it.id} value={it.id}>{it.codigo} · {it.nombre}</option>)}
              </select>
            </label>
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

      {clasificando && (
        <form onSubmit={async e => {
          e.preventDefault();
          if (!clasValor || !tipoDocValor) {
            setMensaje({ texto: 'Seleccione clasificación y tipo documental; no se sustituye un valor conocido por un predeterminado.', tipo: 'error' });
            return;
          }
          try {
            await api().invocar('documento:clasificar', {
              tipo: 'compra',
              documentoId: clasificando.id,
              clasificacionDocumento: clasValor,
              tipoDocumento: tipoDocValor,
              responsable,
              motivo: motivoClas
            });
            setMensaje({ texto: `Clasificación de ${clasificando.folio} completada; acción auditada sin tocar importes ni asiento.`, tipo: 'ok' });
            setClasificando(null);
            cargarDocumentos();
          } catch (err) {
            setMensaje({ texto: String(err instanceof Error ? err.message : err), tipo: 'error' });
          }
        }}>
          <h2>Clasificar {clasificando.folio}</h2>
          <div className="fila">
            <label>Clasificación
              <select value={clasValor} onChange={e => setClasValor(e.target.value)} required>
                <option value="">— Seleccione —</option>
                <option value="contribuyente">Contribuyente</option>
                <option value="consumidor_final">Consumidor final</option>
                <option value="otro">Otro</option>
              </select>
            </label>
            <label>Tipo de documento
              <select value={tipoDocValor} onChange={e => setTipoDocValor(e.target.value)} required>
                <option value="">— Seleccione —</option>
                <option value="factura">Factura</option>
                <option value="ccf">Crédito fiscal</option>
                <option value="recibo">Recibo</option>
                <option value="otro">Otro</option>
              </select>
            </label>
            <label style={{ flex: 2 }}>Motivo (obligatorio)<input value={motivoClas} onChange={e => setMotivoClas(e.target.value)} required /></label>
            <button className="primario" type="submit">Completar clasificación</button>
            <button type="button" onClick={() => setClasificando(null)}>Cancelar</button>
          </div>
        </form>
      )}
      <h2>{mesFiltro ? `Compras de ${mesFiltro}` : 'Compras recientes'}</h2>
      <div className="fila">
        <label>Filtrar por mes (vacío = recientes)<input type="month" value={mesFiltro} onChange={e => { setMesFiltro(e.target.value); setPagina(0); }} /></label>
        <button onClick={() => setPagina(p => Math.max(0, p - 1))} disabled={pagina === 0}>Anteriores</button>
        <button onClick={() => setPagina(p => p + 1)} disabled={compras.length < 100}>Siguientes</button>
      </div>
      {compras.length === 0 ? (
        <p className="vacio">Sin compras registradas.</p>
      ) : (
        <table>
          <thead><tr><th>Folio</th><th>Fecha</th><th>Concepto</th><th>Proveedor</th><th className="numero">Total</th><th className="numero">Saldo</th><th>Estado</th><th>Clasificación</th><th></th></tr></thead>
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
                <td>{c.clasificacionDocumento && c.tipoDocumento ? `${c.clasificacionDocumento} · ${c.tipoDocumento}` : 'Pendiente'}</td>
                <td>
                  {c.estado === 'registrada' && (
                    <button onClick={() => {
                      setClasificando(c);
                      setClasValor(c.clasificacionDocumento ?? '');
                      setTipoDocValor(c.tipoDocumento ?? '');
                      setMotivoClas('');
                    }}>Clasificar</button>
                  )}
                  {c.estado === 'registrada' && <button onClick={() => abrirAnulacion(c)}>Anular</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {anulando && (
        <div className="aviso" role="dialog" aria-label={`Anular compra ${anulando.folio}`}>
          <h3>Anular compra {anulando.folio}</h3>
          <p className="menor">
            Importe: ${anulando.totalMinor} · Saldo: ${anulando.saldoMinor} · Efecto: se genera un reverso
            contable que cancela el asiento original; el motivo y el responsable quedan en bitácora.
          </p>
          {errorAnular && <p role="alert" className="aviso error">{errorAnular}</p>}
          <form onSubmit={confirmarAnulacion}>
            <div className="fila">
              <label style={{ flex: 2 }}>Motivo de la anulación
                <input value={motivoAnular} onChange={e => setMotivoAnular(e.target.value)} required autoFocus placeholder="Motivo significativo" />
              </label>
              <label>Responsable
                <input value={responsableAnular} onChange={e => setResponsableAnular(e.target.value)} required />
              </label>
            </div>
            <div className="fila">
              <button className="primario" type="submit" disabled={ocupadoAnular}>
                {ocupadoAnular ? 'Anulando…' : `Sí, anular ${anulando.folio}`}
              </button>
              <button type="button" onClick={cancelarAnulacion}>Cancelar</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function limpiarMensajeError(err: unknown): string {
  const texto = String(err instanceof Error ? err.message : err);
  return texto
    .replace(/^Error invoking remote method 'arkon':\s*/i, '')
    .replace(/^Error:\s*/i, '')
    .trim();
}
