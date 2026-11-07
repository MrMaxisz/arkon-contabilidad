import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { fechaLocalElSalvador } from '../../shared/fechas';
import { limpiarMensajeError } from '../limpiarMensajeError';
import { BotonPeligro, BotonPrimario, BotonSecundario, EstadoVacio, formatoDineroPantalla } from '../componentes';
import { minorATexto, parseMontoMinor } from '../../shared/dinero';

interface Cuenta {
  id: number;
  codigo: string;
  nombre: string;
  tipo: string;
  esGrupo: boolean;
  activa: boolean;
}

interface AsientoResumen {
  id: number;
  folio: string;
  fechaOperacion: string;
  concepto: string;
  estado: string;
  totalMinor: string;
  reversoDeId: number | null;
}

interface Movimiento {
  asientoId: number;
  folio: string;
  fecha: string;
  concepto: string;
  debeMinor: string;
  haberMinor: string;
  saldoMinor: string;
}

interface LineaForm {
  cuentaId: number;
  debe: string;
  haber: string;
}

function nuevaClave(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `op-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function Contabilidad({ alCambiar }: { alCambiar: () => void }) {
  const [cuentas, setCuentas] = useState<Cuenta[]>([]);
  const [asientos, setAsientos] = useState<AsientoResumen[]>([]);
  const [mayor, setMayor] = useState<{ cuenta: Cuenta | null; movimientos: Movimiento[]; saldoMinor: string }>({
    cuenta: null,
    movimientos: [],
    saldoMinor: '0.00'
  });
  const [fecha, setFecha] = useState(fechaLocalElSalvador());
  const [concepto, setConcepto] = useState('');
  const [responsable, setResponsable] = useState('');
  const [lineas, setLineas] = useState<LineaForm[]>([
    { cuentaId: 0, debe: '', haber: '' },
    { cuentaId: 0, debe: '', haber: '' }
  ]);
  const [mensaje, setMensaje] = useState<{ texto: string; tipo: 'ok' | 'error' } | null>(null);
  const [cuentaMayor, setCuentaMayor] = useState(0);
  const [ocupado, setOcupado] = useState(false);
  const [anulando, setAnulando] = useState<AsientoResumen | null>(null);
  const [motivoAnular, setMotivoAnular] = useState('');
  const origenAnulacionRef = useRef<HTMLButtonElement | null>(null);
  const [anulandoAsiento, setAnulandoAsiento] = useState(false);
  const claveOperacion = useRef<string>(nuevaClave());

  const cargar = useCallback(() => {
    void api().invocar('cuenta:listar').then(r => setCuentas(r as Cuenta[]));
    void api().invocar('asiento:listar', { limite: 50 }).then(r => setAsientos(r as AsientoResumen[]));
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  useEffect(() => {
    if (!cuentaMayor) {
      setMayor({ cuenta: null, movimientos: [], saldoMinor: '0.00' });
      return;
    }
    void api()
      .invocar('mayor:consultar', { cuentaId: cuentaMayor })
      .then(r => {
        const m = r as { movimientos: Movimiento[]; saldoMinor: string };
        setMayor({ cuenta: cuentas.find(c => c.id === cuentaMayor) ?? null, movimientos: m.movimientos, saldoMinor: m.saldoMinor });
      });
  }, [cuentaMayor, cuentas]);

  const movimientos = cuentas.filter(c => !c.esGrupo && c.activa);

  // Totales del asiento en pantalla: solo sumas exactas de montos ya válidos; lo que
  // aún no se puede leer como monto no se suma (bloque 5D, solo presentación).
  const montoDeTexto = (texto: string): bigint => {
    if (!/^\d+(\.\d+)?$/.test(texto.trim())) {
      return 0n;
    }
    try {
      return parseMontoMinor(texto);
    } catch {
      return 0n;
    }
  };
  const totalDebe = lineas.reduce((suma, l) => suma + montoDeTexto(l.debe), 0n);
  const totalHaber = lineas.reduce((suma, l) => suma + montoDeTexto(l.haber), 0n);

  async function contabilizar(e: React.FormEvent) {
    e.preventDefault();
    if (ocupado) {
      return;
    }
    setOcupado(true);
    setMensaje(null);
    try {
      const resultado = (await api().invocar('asiento:contabilizar', {
        fechaOperacion: fecha,
        concepto,
        responsable,
        ambitoId: 'administrativo',
        claveIdempotencia: claveOperacion.current,
        lineas: lineas.map(l => ({ cuentaId: l.cuentaId, debeMinor: l.debe, haberMinor: l.haber }))
      })) as { folio: string; duplicado: boolean };
      setMensaje({
        texto: resultado.duplicado
          ? `Operación ya registrada: asiento ${resultado.folio}`
          : `Asiento ${resultado.folio} contabilizado`,
        tipo: 'ok'
      });
      setConcepto('');
      setLineas([
        { cuentaId: 0, debe: '', haber: '' },
        { cuentaId: 0, debe: '', haber: '' }
      ]);
      claveOperacion.current = nuevaClave();
      cargar();
      alCambiar();
    } catch (err) {
      setMensaje({ texto: limpiarMensajeError(err), tipo: 'error' });
    } finally {
      setOcupado(false);
    }
  }

  function pedirAnulacion(a: AsientoResumen, origen: HTMLButtonElement) {
    origenAnulacionRef.current = origen;
    setAnulando(a);
    setMotivoAnular('');
  }

  useEffect(() => {
    if (!anulando) {
      return;
    }
    const alPresionar = (evento: KeyboardEvent) => {
      if (evento.key === 'Escape' && !anulandoAsiento) {
        setAnulando(null);
        origenAnulacionRef.current?.focus();
      }
    };
    document.addEventListener('keydown', alPresionar);
    return () => document.removeEventListener('keydown', alPresionar);
  }, [anulando, anulandoAsiento]);

  async function confirmarAnulacion() {
    if (!anulando || anulandoAsiento) {
      return;
    }
    if (!motivoAnular.trim() || !responsable.trim()) {
      setMensaje({ texto: 'La anulación exige motivo y responsable registrados en el formulario.', tipo: 'error' });
      return;
    }
    setAnulandoAsiento(true);
    try {
      await api().invocar('asiento:anular', {
        asientoId: anulando.id,
        responsable: responsable.trim(),
        motivo: motivoAnular.trim()
      });
      setMensaje({ texto: `Asiento ${anulando.folio} anulado con reverso trazable.`, tipo: 'ok' });
      setAnulando(null);
      cargar();
      alCambiar();
    } catch (err) {
      setMensaje({ texto: limpiarMensajeError(err), tipo: 'error' });
    } finally {
      setAnulandoAsiento(false);
    }
  }

  return (
    <div>
      <h1>Contabilidad</h1>
      {mensaje && <p className={`aviso ${mensaje.tipo === 'error' ? 'error' : 'ok'}`}>{mensaje.texto}</p>}
      <form onSubmit={contabilizar}>
        <h2>Nuevo asiento manual</h2>
        <div className="fila">
          <label>Fecha de operación<input type="date" value={fecha} onChange={e => setFecha(e.target.value)} required /></label>
          <label style={{ flex: 2 }}>Concepto<input value={concepto} onChange={e => setConcepto(e.target.value)} required /></label>
          <label>Responsable<input value={responsable} onChange={e => setResponsable(e.target.value)} required /></label>
        </div>
        <div className="fila-linea cabecera-lineas" aria-hidden="true">
          <span>Cuenta</span>
          <span className="numero">Debe</span>
          <span className="numero">Haber</span>
          <span></span>
        </div>
        {lineas.map((l, i) => (
          <div className="fila-linea" key={i}>
            <label>
              Cuenta
              <select
                value={l.cuentaId}
                onChange={e => {
                  const copia = [...lineas];
                  copia[i] = { ...l, cuentaId: Number(e.target.value) };
                  setLineas(copia);
                }}
                required
              >
                <option value={0}>— Seleccione —</option>
                {movimientos.map(c => (
                  <option key={c.id} value={c.id}>{c.codigo} · {c.nombre}</option>
                ))}
              </select>
            </label>
            <label>Debe<input value={l.debe} onChange={e => {
              const copia = [...lineas];
              copia[i] = { ...l, debe: e.target.value, haber: '' };
              setLineas(copia);
            }} placeholder="0.00" /></label>
            <label>Haber<input value={l.haber} onChange={e => {
              const copia = [...lineas];
              copia[i] = { ...l, haber: e.target.value, debe: '' };
              setLineas(copia);
            }} placeholder="0.00" /></label>
            {lineas.length > 2 && (
              <BotonSecundario onClick={() => setLineas(lineas.filter((_, j) => j !== i))}>Quitar</BotonSecundario>
            )}
          </div>
        ))}
        <div className="fila-linea totales-lineas">
          <span>Totales</span>
          <span className="numero">{formatoDineroPantalla(minorATexto(totalDebe))}</span>
          <span className="numero">{formatoDineroPantalla(minorATexto(totalHaber))}</span>
          <span className="numero">Diferencia: {formatoDineroPantalla(minorATexto(totalDebe - totalHaber))}</span>
        </div>
        <div className="fila">
          <BotonSecundario onClick={() => setLineas([...lineas, { cuentaId: 0, debe: '', haber: '' }])}>
            Agregar línea
          </BotonSecundario>
          <BotonPrimario type="submit" disabled={ocupado}>
            {ocupado ? 'Contabilizando…' : 'Contabilizar'}
          </BotonPrimario>
        </div>
      </form>

      {anulando && (
        <form
          onSubmit={e => {
            e.preventDefault();
            void confirmarAnulacion();
          }}
        >
          <h2>Anular asiento {anulando.folio}</h2>
          <p className="menor">
            Se creará un asiento reverso trazable; el original se conserva con estado «anulado».
            Responsable: {responsable.trim() || '(falta registrar responsable arriba)'}.
          </p>
          <div className="fila">
            <label style={{ flex: 2 }}>Motivo (obligatorio)
              <input value={motivoAnular} onChange={e => setMotivoAnular(e.target.value)} required />
            </label>
            <BotonPeligro type="submit" disabled={anulandoAsiento}>{anulandoAsiento ? 'Anulando…' : 'Confirmar anulación'}</BotonPeligro>
            <BotonSecundario onClick={() => setAnulando(null)}>Cancelar</BotonSecundario>
          </div>
        </form>
      )}

      <h2>Asientos recientes</h2>
      {asientos.length === 0 ? (
        <EstadoVacio texto="Sin asientos registrados." />
      ) : (
        <table>
          <thead>
            <tr><th>Folio</th><th>Fecha</th><th>Concepto</th><th>Estado</th><th className="numero">Total</th><th></th></tr>
          </thead>
          <tbody>
            {asientos.map(a => (
              <tr key={a.id}>
                <td className="folio">{a.folio}</td>
                <td>{a.fechaOperacion}</td>
                <td>{a.concepto}</td>
                <td>{a.estado}</td>
                <td className="numero">{formatoDineroPantalla(a.totalMinor)}</td>
                <td>{a.estado === 'contabilizado' && !a.reversoDeId && <BotonSecundario onClick={e => pedirAnulacion(a, e.currentTarget)}>Anular</BotonSecundario>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>Mayor de cuenta</h2>
      <div className="fila">
        <label style={{ minWidth: 320 }}>
          Cuenta
          <select value={cuentaMayor} onChange={e => setCuentaMayor(Number(e.target.value))}>
            <option value={0}>— Seleccione —</option>
            {movimientos.map(c => (
              <option key={c.id} value={c.id}>{c.codigo} · {c.nombre}</option>
            ))}
          </select>
        </label>
        
      </div>
      {mayor.cuenta && mayor.movimientos.length === 0 && <EstadoVacio texto="Sin movimientos en esta cuenta." />}
      {mayor.movimientos.length > 0 && (
        <table>
          <thead>
            <tr><th>Fecha</th><th>Folio</th><th>Concepto</th><th className="numero">Debe</th><th className="numero">Haber</th><th className="numero">Saldo</th></tr>
          </thead>
          <tbody>
            {mayor.movimientos.map((m, i) => (
              <tr key={i}>
                <td>{m.fecha}</td>
                <td className="folio">{m.folio}</td>
                <td>{m.concepto}</td>
                <td className="numero">{formatoDineroPantalla(m.debeMinor)}</td>
                <td className="numero">{formatoDineroPantalla(m.haberMinor)}</td>
                <td className="numero">{formatoDineroPantalla(m.saldoMinor)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="total">
              <td>Saldo</td>
              <td></td>
              <td></td>
              <td></td>
              <td></td>
              <td className="numero">{formatoDineroPantalla(mayor.saldoMinor)}</td>
            </tr>
          </tfoot>
        </table>
      )}
    </div>
  );
}
