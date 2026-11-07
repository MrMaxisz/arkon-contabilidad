import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { mensajeImpresionAndroid } from '../mensajeImpresionAndroid';
import { limpiarMensajeError } from '../limpiarMensajeError';
import { BotonSecundario, EstadoCarga, EstadoError, EstadoVacio, formatoDineroPantalla } from '../componentes';
import { minorATexto } from '../../shared/dinero';

interface CuentaCosto {
  codigo: string;
  nombre: string;
  tipo: string;
  importeMinor: string;
}

interface FilaCostoProyecto {
  proyectoId: number | null;
  codigo: string;
  nombre: string;
  materialesMinor: string;
  personalMinor: string;
  transporteMinor: string;
  subcontratacionMinor: string;
  otrosMinor: string;
  costoMinor: string;
  ingresoMinor: string;
  margenMinor: string;
  margenPorcentaje: string | null;
  cuentas: CuentaCosto[];
}

interface ReporteProyecto {
  desde: string;
  hasta: string;
  ambitoId: string;
  proyectos: FilaCostoProyecto[];
  sinProyecto: FilaCostoProyecto;
  totalCostoMinor: string;
  totalIngresoMinor: string;
  totalMargenMinor: string;
  margenPorcentaje: string | null;
  provisional: boolean;
}

interface TipoCosto {
  tipo: string;
  nombre: string;
  importeMinor: string;
  cuentas: CuentaCosto[];
}

interface PeriodoTipo {
  desde: string;
  hasta: string;
  ambitoId: string;
  tipos: TipoCosto[];
  totalCostoMinor: string;
}

interface ReporteTipo extends PeriodoTipo {
  periodoAnterior: PeriodoTipo | null;
}

interface ConciliacionCostos {
  desde: string;
  hasta: string;
  ambitoId: string;
  totalCostosMinor: string;
  costosEstadoResultadosMinor: string;
  diferenciaMinor: string;
  cuadra: boolean;
}

interface Mensaje {
  texto: string;
  tipo: 'ok' | 'error';
}

const ENCABEZADOS_PROYECTO = [
  'Código',
  'Proyecto',
  'Materiales',
  'Personal',
  'Transporte',
  'Subcontratación',
  'Otros',
  'Costo',
  'Ingreso',
  'Margen',
  'Margen %'
];

function minorDe(texto: string): bigint {
  return BigInt(texto.replace('.', ''));
}

function variacionMinor(actual: string, anterior: string): string {
  return minorATexto(minorDe(actual) - minorDe(anterior));
}

function porcentajeTexto(valor: string | null): string {
  return valor === null ? '—' : `${valor}%`;
}

function filaProyecto(p: FilaCostoProyecto): string[] {
  return [
    p.codigo || '—',
    p.nombre,
    formatoDineroPantalla(p.materialesMinor),
    formatoDineroPantalla(p.personalMinor),
    formatoDineroPantalla(p.transporteMinor),
    formatoDineroPantalla(p.subcontratacionMinor),
    formatoDineroPantalla(p.otrosMinor),
    formatoDineroPantalla(p.costoMinor),
    formatoDineroPantalla(p.ingresoMinor),
    formatoDineroPantalla(p.margenMinor),
    porcentajeTexto(p.margenPorcentaje)
  ];
}

export default function Costos() {
  const [desde, setDesde] = useState('2026-01-01');
  const [hasta, setHasta] = useState('2026-12-31');
  const [comparativo, setComparativo] = useState(true);
  const [proyecto, setProyecto] = useState<ReporteProyecto | null>(null);
  const [tipo, setTipo] = useState<ReporteTipo | null>(null);
  const [conciliacion, setConciliacion] = useState<ConciliacionCostos | null>(null);
  const [cargando, setCargando] = useState(false);
  const [guardandoPdf, setGuardandoPdf] = useState(false);
  const [mensaje, setMensaje] = useState<Mensaje | null>(null);
  const consultaActual = useRef(0);

  const cargar = useCallback(() => {
    const numeroConsulta = ++consultaActual.current;
    if (!desde || !hasta) {
      setProyecto(null);
      setTipo(null);
      setConciliacion(null);
      setCargando(false);
      return;
    }
    setCargando(true);
    setMensaje(null);
    const rango = { desde, hasta };
    void Promise.all([
      api().invocar('reporte:costosPorProyecto', rango),
      api().invocar('reporte:costosPorTipo', { ...rango, comparativo }),
      api().invocar('reporte:costosConciliacion', rango)
    ])
      .then(([costosProyecto, costosTipo, costosConciliacion]) => {
        if (consultaActual.current !== numeroConsulta) return;
        setProyecto(costosProyecto as ReporteProyecto);
        setTipo(costosTipo as ReporteTipo);
        setConciliacion(costosConciliacion as ConciliacionCostos);
      })
      .catch(err => {
        if (consultaActual.current !== numeroConsulta) return;
        setProyecto(null);
        setTipo(null);
        setConciliacion(null);
        setMensaje({ texto: `Error al consultar costos: ${limpiarMensajeError(err)}`, tipo: 'error' });
      })
      .finally(() => {
        if (consultaActual.current === numeroConsulta) setCargando(false);
      });
  }, [desde, hasta, comparativo]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  async function guardarPdf() {
    if (!proyecto || !tipo || !conciliacion) return;
    setGuardandoPdf(true);
    setMensaje(null);
    try {
      const tablas = [
        {
          titulo: 'Por proyecto y margen',
          encabezados: ENCABEZADOS_PROYECTO,
          filas: [...proyecto.proyectos, proyecto.sinProyecto].map(filaProyecto),
          total: [
            'Total',
            '',
            '',
            '',
            '',
            '',
            '',
            formatoDineroPantalla(proyecto.totalCostoMinor),
            formatoDineroPantalla(proyecto.totalIngresoMinor),
            formatoDineroPantalla(proyecto.totalMargenMinor),
            porcentajeTexto(proyecto.margenPorcentaje)
          ]
        },
        {
          titulo: 'Por tipo y comparativo',
          encabezados: ['Tipo', 'Actual', 'Anterior', 'Variación'],
          filas: tipo.tipos.map(t => {
            const anterior = tipo.periodoAnterior?.tipos.find(a => a.tipo === t.tipo);
            return [
              t.nombre,
              formatoDineroPantalla(t.importeMinor),
              anterior ? formatoDineroPantalla(anterior.importeMinor) : '—',
              anterior ? formatoDineroPantalla(variacionMinor(t.importeMinor, anterior.importeMinor)) : '—'
            ];
          }),
          total: [
            'Total',
            formatoDineroPantalla(tipo.totalCostoMinor),
            tipo.periodoAnterior ? formatoDineroPantalla(tipo.periodoAnterior.totalCostoMinor) : '—',
            tipo.periodoAnterior
              ? formatoDineroPantalla(variacionMinor(tipo.totalCostoMinor, tipo.periodoAnterior.totalCostoMinor))
              : '—'
          ]
        },
        {
          titulo: 'Conciliación',
          encabezados: ['Concepto', 'Importe'],
          filas: [
            ['Costos por proyecto', formatoDineroPantalla(conciliacion.totalCostosMinor)],
            ['Costos del estado de resultados', formatoDineroPantalla(conciliacion.costosEstadoResultadosMinor)]
          ],
          total: ['Diferencia', formatoDineroPantalla(conciliacion.diferenciaMinor)]
        }
      ];
      const r = (await api().reportePdf({
        titulo: 'Costos por proyecto y tipo',
        periodo: `${proyecto.desde} a ${proyecto.hasta}`,
        ambito: proyecto.ambitoId,
        tablas
      })) as { guardado?: boolean; ruta?: string };
      setMensaje({
        texto: mensajeImpresionAndroid(r) ?? (r.guardado && r.ruta ? `PDF de costos guardado en ${r.ruta}.` : 'Guardado del PDF cancelado.'),
        tipo: r.guardado ? 'ok' : 'error'
      });
    } catch (err) {
      setMensaje({ texto: `Error al guardar el PDF: ${limpiarMensajeError(err)}`, tipo: 'error' });
    } finally {
      setGuardandoPdf(false);
    }
  }

  const datosListos = Boolean(proyecto && tipo && conciliacion);

  return (
    <div>
      <h1>Costos</h1>
      {mensaje && (
        mensaje.tipo === 'error'
          ? <EstadoError mensaje={mensaje.texto} />
          : <p className="aviso ok">{mensaje.texto}</p>
      )}
      <p className="aviso">
        Registro de control interno, no estado financiero legal. Los costos se calculan con asientos del ámbito
        administrativo y excluyen los asientos de cierre del ejercicio.
      </p>
      <div className="fila no-imprimir">
        <label>Desde
          <input type="date" value={desde} onChange={e => setDesde(e.target.value)} />
        </label>
        <label>Hasta
          <input type="date" value={hasta} onChange={e => setHasta(e.target.value)} />
        </label>
        <label>Comparativo
          <select value={comparativo ? 'si' : 'no'} onChange={e => setComparativo(e.target.value === 'si')}>
            <option value="si">Sí</option>
            <option value="no">No</option>
          </select>
        </label>
        <BotonSecundario disabled={!datosListos || guardandoPdf} onClick={() => void guardarPdf()}>
          Guardar PDF…
        </BotonSecundario>
      </div>
      <p className="filtros-impresion menor">
        Filtros: {desde || 'sin desde'} a {hasta || 'sin hasta'} · Comparativo: {comparativo ? 'Sí' : 'No'}
      </p>

      {cargando && <EstadoCarga texto="Calculando costos…" />}
      {!cargando && !datosListos && !mensaje && <EstadoVacio texto="Sin costos para el rango seleccionado." />}

      {!cargando && proyecto && tipo && conciliacion && (
        <div>
          <h2>Por proyecto y margen</h2>
          {proyecto.provisional && (
            <p className="aviso seguridad">
              Hay compras registradas sin proyecto asignado; la rentabilidad es provisional.
            </p>
          )}
          <table aria-label="Costos por proyecto">
            <thead>
              <tr>
                {ENCABEZADOS_PROYECTO.map((encabezado, i) => (
                  <th key={encabezado} className={i >= 2 ? 'numero' : ''}>{encabezado}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...proyecto.proyectos, proyecto.sinProyecto].map(p => (
                <tr key={p.proyectoId ?? 'sin-proyecto'}>
                  <td className="folio">{p.codigo || '—'}</td>
                  <td>{p.nombre}</td>
                  <td className="numero">{formatoDineroPantalla(p.materialesMinor)}</td>
                  <td className="numero">{formatoDineroPantalla(p.personalMinor)}</td>
                  <td className="numero">{formatoDineroPantalla(p.transporteMinor)}</td>
                  <td className="numero">{formatoDineroPantalla(p.subcontratacionMinor)}</td>
                  <td className="numero">{formatoDineroPantalla(p.otrosMinor)}</td>
                  <td className="numero">{formatoDineroPantalla(p.costoMinor)}</td>
                  <td className="numero">{formatoDineroPantalla(p.ingresoMinor)}</td>
                  <td className="numero">{formatoDineroPantalla(p.margenMinor)}</td>
                  <td className="numero">{porcentajeTexto(p.margenPorcentaje)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="total">
                <td>Total</td>
                <td></td>
                <td></td>
                <td></td>
                <td></td>
                <td></td>
                <td></td>
                <td className="numero">{formatoDineroPantalla(proyecto.totalCostoMinor)}</td>
                <td className="numero">{formatoDineroPantalla(proyecto.totalIngresoMinor)}</td>
                <td className="numero">{formatoDineroPantalla(proyecto.totalMargenMinor)}</td>
                <td className="numero">{porcentajeTexto(proyecto.margenPorcentaje)}</td>
              </tr>
            </tfoot>
          </table>

          <h2>Por tipo</h2>
          {tipo.periodoAnterior ? (
            <p className="menor">
              Comparativo: {tipo.periodoAnterior.desde} a {tipo.periodoAnterior.hasta}.
            </p>
          ) : (
            <p className="menor">Comparativo desactivado.</p>
          )}
          <table aria-label="Costos por tipo">
            <thead>
              <tr>
                <th>Tipo</th>
                <th className="numero">Actual</th>
                <th className="numero">Anterior</th>
                <th className="numero">Variación</th>
              </tr>
            </thead>
            <tbody>
              {tipo.tipos.map(t => {
                const anterior = tipo.periodoAnterior?.tipos.find(a => a.tipo === t.tipo);
                return (
                  <tr key={t.tipo}>
                    <td>{t.nombre}</td>
                    <td className="numero">{formatoDineroPantalla(t.importeMinor)}</td>
                    <td className="numero">{anterior ? formatoDineroPantalla(anterior.importeMinor) : '—'}</td>
                    <td className="numero">
                      {anterior ? formatoDineroPantalla(variacionMinor(t.importeMinor, anterior.importeMinor)) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="total">
                <td>Total</td>
                <td className="numero">{formatoDineroPantalla(tipo.totalCostoMinor)}</td>
                <td className="numero">
                  {tipo.periodoAnterior ? formatoDineroPantalla(tipo.periodoAnterior.totalCostoMinor) : '—'}
                </td>
                <td className="numero">
                  {tipo.periodoAnterior
                    ? formatoDineroPantalla(variacionMinor(tipo.totalCostoMinor, tipo.periodoAnterior.totalCostoMinor))
                    : '—'}
                </td>
              </tr>
            </tfoot>
          </table>

          <h2>Conciliación</h2>
          <table aria-label="Conciliación de costos">
            <thead>
              <tr><th>Concepto</th><th className="numero">Importe</th></tr>
            </thead>
            <tbody>
              <tr>
                <td>Costos por proyecto</td>
                <td className="numero">{formatoDineroPantalla(conciliacion.totalCostosMinor)}</td>
              </tr>
              <tr>
                <td>Costos del estado de resultados</td>
                <td className="numero">{formatoDineroPantalla(conciliacion.costosEstadoResultadosMinor)}</td>
              </tr>
            </tbody>
            <tfoot>
              <tr className="total">
                <td>Diferencia</td>
                <td className="numero">{formatoDineroPantalla(conciliacion.diferenciaMinor)}</td>
              </tr>
            </tfoot>
          </table>
          <p className={`aviso ${conciliacion.cuadra ? 'ok' : 'error'}`}>
            {conciliacion.cuadra
              ? 'Los costos concilian con el estado de resultados del rango.'
              : 'Los costos NO concilian con el estado de resultados del rango; revisa los asientos.'}
          </p>
        </div>
      )}
    </div>
  );
}
