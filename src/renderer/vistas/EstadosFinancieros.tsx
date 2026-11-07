import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { limpiarMensajeError } from '../limpiarMensajeError';
import { BotonSecundario, EstadoCarga, EstadoError, formatoDineroPantalla } from '../componentes';

interface FilaComprobacion {
  cuentaId: number;
  codigo: string;
  nombre: string;
  tipo: string;
  esGrupo: boolean;
  saldoInicialMinor: string;
  cargosMinor: string;
  abonosMinor: string;
  saldoFinalMinor: string;
}

interface BalanceComprobacion {
  desde: string;
  hasta: string;
  filas: FilaComprobacion[];
  totalCargosMinor: string;
  totalAbonosMinor: string;
  cuadra: boolean;
}

interface Seccion { codigo: string; nombre: string; importeMinor: string }

interface EstadoResultadosEstructurado {
  desde: string;
  hasta: string;
  ingresos: Seccion[];
  costos: Seccion[];
  otrosCostos: Seccion[];
  utilidadBrutaMinor: string;
  gastosAdministracion: Seccion[];
  gastosComercializacion: Seccion[];
  otrosGastos: Seccion[];
  utilidadOperacionMinor: string;
  otrosIngresos: Seccion[];
  gastosFinancieros: Seccion[];
  resultadoAntesImpuestosMinor: string;
  periodoAnterior: EstadoResultadosEstructurado | null;
}

interface FilaSituacion { codigo: string; nombre: string; corriente: boolean; sinClasificar: boolean; saldoMinor: string }

interface EstadoSituacionFinanciera {
  corte: string;
  activo: { corriente: FilaSituacion[]; noCorriente: FilaSituacion[]; sinClasificar: FilaSituacion[]; totalMinor: string };
  pasivo: { corriente: FilaSituacion[]; noCorriente: FilaSituacion[]; sinClasificar: FilaSituacion[]; totalMinor: string };
  patrimonio: { filas: FilaSituacion[]; resultadoEjercicioMinor: string; totalMinor: string };
  cuadra: boolean;
  saldosContrarios: Array<{ codigo: string; nombre: string; saldoMinor: string }>;
  comparativo: EstadoSituacionFinanciera | null;
}

type Pestana = 'comprobacion' | 'resultados' | 'situacion';

function filasSeccion(filas: Seccion[], presentarPositivo = false): string[][] {
  return filas.map(f => {
    const importe = presentarPositivo && f.importeMinor.startsWith('-') ? f.importeMinor.slice(1) : f.importeMinor;
    return [f.codigo, f.nombre, formatoDineroPantalla(importe)];
  });
}

// El PDF conserva el signo de los saldos contrarios y usa separador de miles.
function filasImporte(filas: Array<{ codigo: string; nombre: string; saldoMinor: string }>): string[][] {
  return filas.map(f => [f.codigo, f.nombre, formatoDineroPantalla(f.saldoMinor)]);
}

function tablasSituacion(e: EstadoSituacionFinanciera): Array<{
  titulo?: string;
  encabezados: string[];
  filas: string[][];
  total?: string[];
}> {
  const encabezados = ['Código', 'Nombre', 'Importe'];
  const seccion = (titulo: string, filas: Array<{ codigo: string; nombre: string; saldoMinor: string }>) => ({
    titulo,
    encabezados,
    filas: filasImporte(filas)
  });
  const tablas = [
    seccion('Activo corriente', e.activo.corriente),
    seccion('Activo no corriente', e.activo.noCorriente),
    seccion('Activo sin clasificar', e.activo.sinClasificar),
    seccion('Pasivo corriente', e.pasivo.corriente),
    seccion('Pasivo no corriente', e.pasivo.noCorriente),
    seccion('Pasivo sin clasificar', e.pasivo.sinClasificar),
    seccion('Patrimonio', e.patrimonio.filas),
    {
      titulo: 'Totales',
      encabezados,
      filas: [
        ['Total activo', '', formatoDineroPantalla(e.activo.totalMinor)],
        ['Total pasivo', '', formatoDineroPantalla(e.pasivo.totalMinor)],
        ['Total patrimonio', '', formatoDineroPantalla(e.patrimonio.totalMinor)]
      ]
    }
  ].filter(tabla => tabla.filas.length > 0);
  if (e.saldosContrarios.length > 0) {
    tablas.push(seccion('Saldos contrarios', e.saldosContrarios));
  }
  if (e.comparativo) {
    tablas.push({
      titulo: `Comparativo al ${e.comparativo.corte}`,
      encabezados: ['Concepto', 'Importe'],
      filas: [
        ['Total activo', formatoDineroPantalla(e.comparativo.activo.totalMinor)],
        ['Total pasivo', formatoDineroPantalla(e.comparativo.pasivo.totalMinor)],
        ['Total patrimonio', formatoDineroPantalla(e.comparativo.patrimonio.totalMinor)]
      ]
    });
  }
  return tablas;
}

export default function EstadosFinancieros() {
  const [pestana, setPestana] = useState<Pestana>('comprobacion');
  const [desde, setDesde] = useState('2026-01-01');
  const [hasta, setHasta] = useState('2026-12-31');
  const [ocultarSinMovimiento, setOcultarSinMovimiento] = useState(false);
  const [comprobacion, setComprobacion] = useState<BalanceComprobacion | null>(null);
  const [resultados, setResultados] = useState<EstadoResultadosEstructurado | null>(null);
  const [corte, setCorte] = useState('2026-12-31');
  const [corteComparativo, setCorteComparativo] = useState('');
  const [situacion, setSituacion] = useState<EstadoSituacionFinanciera | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const consultaId = useRef(0);

  const cargarComprobacion = useCallback(() => {
    const numeroConsulta = ++consultaId.current;
    setCargando(true);
    void api()
      .invocar('balance:comprobacion', { desde, hasta, ocultarSinMovimiento })
      .then(r => {
        if (consultaId.current === numeroConsulta) {
          setComprobacion(r as BalanceComprobacion);
        }
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
  }, [desde, hasta, ocultarSinMovimiento]);

  const cargarResultados = useCallback(() => {
    const numeroConsulta = ++consultaId.current;
    setCargando(true);
    void api()
      .invocar('resultados:estructurado', { desde, hasta, comparativo: true })
      .then(r => {
        if (consultaId.current === numeroConsulta) {
          setResultados(r as EstadoResultadosEstructurado);
        }
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
  }, [desde, hasta]);

  const cargarSituacion = useCallback(() => {
    const numeroConsulta = ++consultaId.current;
    setCargando(true);
    void api()
      .invocar('situacion:consultar', { corte, corteComparativo: corteComparativo || undefined })
      .then(r => {
        if (consultaId.current === numeroConsulta) {
          setSituacion(r as EstadoSituacionFinanciera);
        }
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
  }, [corte, corteComparativo]);

  useEffect(() => {
    if (pestana === 'comprobacion') {
      cargarComprobacion();
    } else if (pestana === 'resultados') {
      cargarResultados();
    } else {
      cargarSituacion();
    }
  }, [pestana, cargarComprobacion, cargarResultados, cargarSituacion]);

  async function imprimir(
    titulo: string,
    periodo: string,
    tablas: { titulo?: string; encabezados: string[]; filas: string[][]; total?: string[]; linea?: string[] }[]
  ) {
    try {
      const r = (await api().reportePdf({ titulo, periodo, ambito: 'administrativo', tablas })) as { guardado: boolean; ruta?: string };
      setMensaje(r.guardado && r.ruta ? `Reporte guardado en ${r.ruta}.` : 'Impresión cancelada.');
    } catch (err) {
      setMensaje(limpiarMensajeError(err));
    }
  }

  return (
    <div>
      <h1>Estados financieros</h1>
      {mensaje && <EstadoError mensaje={mensaje} />}
      <p className="aviso">
        Registro de control interno, no estado financiero legal. ARKON sin constituir ni inscrita en IVA.
        Clasificación corriente/no corriente y agrupación documentadas para revisión del contador.
      </p>
      <div className="fila no-imprimir" role="tablist">
        <BotonSecundario onClick={() => setPestana('comprobacion')} className={pestana === 'comprobacion' ? 'activo-pestana' : ''}>Balance de comprobación</BotonSecundario>
        <BotonSecundario onClick={() => setPestana('resultados')} className={pestana === 'resultados' ? 'activo-pestana' : ''}>Estado de resultados</BotonSecundario>
        <BotonSecundario onClick={() => setPestana('situacion')} className={pestana === 'situacion' ? 'activo-pestana' : ''}>Estado de situación financiera</BotonSecundario>
      </div>

      {cargando && <EstadoCarga texto="Calculando estado…" />}

      {pestana === 'comprobacion' && !cargando && comprobacion && (
        <div>
          <div className="fila no-imprimir">
            <label>Desde<input type="date" value={desde} onChange={e => setDesde(e.target.value)} /></label>
            <label>Hasta<input type="date" value={hasta} onChange={e => setHasta(e.target.value)} /></label>
            <label>Ocultar sin movimiento
              <select value={ocultarSinMovimiento ? 'si' : 'no'} onChange={e => setOcultarSinMovimiento(e.target.value === 'si')}>
                <option value="no">No</option>
                <option value="si">Sí</option>
              </select>
            </label>
            <BotonSecundario onClick={() => cargarComprobacion()}>Recalcular</BotonSecundario>
            <BotonSecundario onClick={() => void imprimir('Balance de comprobación', `${desde} a ${hasta}`, [{
              encabezados: ['Cuenta', 'Nombre', 'Saldo inicial', 'Cargos', 'Abonos', 'Saldo final'],
              filas: comprobacion.filas.map(f => [f.codigo, f.nombre, formatoDineroPantalla(f.saldoInicialMinor), formatoDineroPantalla(f.cargosMinor), formatoDineroPantalla(f.abonosMinor), formatoDineroPantalla(f.saldoFinalMinor)]),
              total: ['Totales', '', '', formatoDineroPantalla(comprobacion.totalCargosMinor), formatoDineroPantalla(comprobacion.totalAbonosMinor), '']
            }])}>Imprimir…</BotonSecundario>
          </div>
          <table>
            <thead><tr><th>Cuenta</th><th>Nombre</th><th className="numero">Saldo inicial</th><th className="numero">Cargos</th><th className="numero">Abonos</th><th className="numero">Saldo final</th></tr></thead>
            <tbody>
              {comprobacion.filas.map(f => (
                <tr key={f.cuentaId} className={f.esGrupo ? 'total' : ''}>
                  <td className="folio">{f.codigo}</td>
                  <td>{f.nombre}</td>
                  <td className="numero">{formatoDineroPantalla(f.saldoInicialMinor)}</td>
                  <td className="numero">{formatoDineroPantalla(f.cargosMinor)}</td>
                  <td className="numero">{formatoDineroPantalla(f.abonosMinor)}</td>
                  <td className="numero">{formatoDineroPantalla(f.saldoFinalMinor)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="total">
                <td>Totales</td>
                <td></td>
                <td></td>
                <td className="numero">{formatoDineroPantalla(comprobacion.totalCargosMinor)}</td>
                <td className="numero">{formatoDineroPantalla(comprobacion.totalAbonosMinor)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
          <p className={`aviso ${comprobacion.cuadra ? 'ok' : 'error'}`}>
            {comprobacion.cuadra ? 'Debe y haber cuadran en el rango.' : 'Debe y haber NO cuadran en el rango.'}
          </p>
        </div>
      )}

      {pestana === 'resultados' && !cargando && resultados && (
        <div>
          <div className="fila no-imprimir">
            <label>Desde<input type="date" value={desde} onChange={e => setDesde(e.target.value)} /></label>
            <label>Hasta<input type="date" value={hasta} onChange={e => setHasta(e.target.value)} /></label>
            <BotonSecundario onClick={() => cargarResultados()}>Recalcular</BotonSecundario>
            <BotonSecundario onClick={() => void imprimir('Estado de resultados', `${resultados.desde} a ${resultados.hasta}`, [
              {
                titulo: 'Ingresos',
                encabezados: ['Código', 'Nombre', 'Importe'],
                filas: filasSeccion(resultados.ingresos)
              },
              {
                titulo: 'Costos',
                encabezados: ['Código', 'Nombre', 'Importe'],
                filas: filasSeccion([...resultados.costos, ...resultados.otrosCostos], true),
                total: ['Utilidad bruta', '', formatoDineroPantalla(resultados.utilidadBrutaMinor)]
              },
              {
                titulo: 'Gastos de administración y comercialización',
                encabezados: ['Código', 'Nombre', 'Importe'],
                filas: filasSeccion([...resultados.gastosAdministracion, ...resultados.gastosComercializacion, ...resultados.otrosGastos], true),
                total: ['Utilidad de operación', '', formatoDineroPantalla(resultados.utilidadOperacionMinor)]
              },
              ...(resultados.otrosIngresos.length > 0 || resultados.gastosFinancieros.length > 0 ? [{
                titulo: 'Otros ingresos y gastos financieros',
                encabezados: ['Código', 'Nombre', 'Importe'],
                filas: [
                  ...filasSeccion(resultados.otrosIngresos),
                  ...filasSeccion(resultados.gastosFinancieros, true)
                ],
                total: ['Resultado antes de impuestos', '', formatoDineroPantalla(resultados.resultadoAntesImpuestosMinor)]
              }] : [{
                encabezados: [],
                filas: [],
                linea: ['Resultado antes de impuestos', formatoDineroPantalla(resultados.resultadoAntesImpuestosMinor)]
              }])
            ])}>
              Imprimir…
            </BotonSecundario>
          </div>
          <h2>Ingresos</h2>
          <table><tbody>{resultados.ingresos.map(f => <tr key={f.codigo}><td className="folio">{f.codigo}</td><td>{f.nombre}</td><td className="numero">{formatoDineroPantalla(f.importeMinor)}</td></tr>)}</tbody></table>
          <h2>Costos</h2>
          <table><tbody>{[...resultados.costos, ...resultados.otrosCostos].map(f => <tr key={f.codigo}><td className="folio">{f.codigo}</td><td>{f.nombre}</td><td className="numero">{formatoDineroPantalla(f.importeMinor)}</td></tr>)}</tbody>
            <tfoot><tr className="total"><td>Utilidad bruta</td><td></td><td className="numero">{formatoDineroPantalla(resultados.utilidadBrutaMinor)}</td></tr></tfoot></table>
          <h2>Gastos de administración y comercialización</h2>
          <table><tbody>{[...resultados.gastosAdministracion, ...resultados.gastosComercializacion, ...resultados.otrosGastos].map((f, i) => <tr key={i}><td className="folio">{f.codigo}</td><td>{f.nombre}</td><td className="numero">{formatoDineroPantalla(f.importeMinor)}</td></tr>)}</tbody>
            <tfoot><tr className="total"><td>Utilidad de operación</td><td></td><td className="numero">{formatoDineroPantalla(resultados.utilidadOperacionMinor)}</td></tr></tfoot></table>
          <h2>Otros ingresos y gastos financieros</h2>
          <table><tbody>{[...resultados.otrosIngresos, ...resultados.gastosFinancieros].map((f, i) => <tr key={i}><td className="folio">{f.codigo}</td><td>{f.nombre}</td><td className="numero">{formatoDineroPantalla(f.importeMinor)}</td></tr>)}</tbody>
            <tfoot><tr className="total"><td>Resultado antes de impuestos</td><td></td><td className="numero">{formatoDineroPantalla(resultados.resultadoAntesImpuestosMinor)}</td></tr></tfoot></table>
          <p className="menor">Sin cálculo de ISR: queda como decisión del contador.</p>
          {resultados.periodoAnterior && (
            <p className="menor">
              Comparativo {resultados.periodoAnterior.desde} a {resultados.periodoAnterior.hasta}: resultado antes de impuestos {formatoDineroPantalla(resultados.periodoAnterior.resultadoAntesImpuestosMinor)}.
            </p>
          )}
        </div>
      )}

      {pestana === 'situacion' && !cargando && situacion && (
        <div>
          <div className="fila no-imprimir">
            <label>Corte<input type="date" value={corte} onChange={e => setCorte(e.target.value)} /></label>
            <label>Corte comparativo (opcional)<input type="date" value={corteComparativo} onChange={e => setCorteComparativo(e.target.value)} /></label>
            <BotonSecundario onClick={() => cargarSituacion()}>Recalcular</BotonSecundario>
            <BotonSecundario onClick={() => void imprimir('Estado de situación financiera', `Al ${situacion.corte}`, tablasSituacion(situacion))}>Imprimir…</BotonSecundario>
          </div>
          <h2>Activo</h2>
          <table><tbody>{[...situacion.activo.corriente, ...situacion.activo.noCorriente, ...situacion.activo.sinClasificar].map(f => <tr key={f.codigo}><td className="folio">{f.codigo}</td><td>{f.nombre} {f.sinClasificar ? '(sin clasificar)' : f.corriente ? '' : '(no corriente)'}</td><td className="numero">{formatoDineroPantalla(f.saldoMinor)}</td></tr>)}</tbody>
            <tfoot><tr className="total"><td>Total activo</td><td></td><td className="numero">{formatoDineroPantalla(situacion.activo.totalMinor)}</td></tr></tfoot></table>
          <h2>Pasivo</h2>
          <table><tbody>{[...situacion.pasivo.corriente, ...situacion.pasivo.noCorriente, ...situacion.pasivo.sinClasificar].map(f => <tr key={f.codigo}><td className="folio">{f.codigo}</td><td>{f.nombre} {f.sinClasificar ? '(sin clasificar)' : f.corriente ? '' : '(no corriente)'}</td><td className="numero">{formatoDineroPantalla(f.saldoMinor)}</td></tr>)}</tbody>
            <tfoot><tr className="total"><td>Total pasivo</td><td></td><td className="numero">{formatoDineroPantalla(situacion.pasivo.totalMinor)}</td></tr></tfoot></table>
          <h2>Patrimonio</h2>
          <table><tbody>{situacion.patrimonio.filas.map((f, i) => <tr key={i}><td className="folio">{f.codigo}</td><td>{f.nombre}</td><td className="numero">{formatoDineroPantalla(f.saldoMinor)}</td></tr>)}</tbody>
            <tfoot><tr className="total"><td>Total patrimonio</td><td></td><td className="numero">{formatoDineroPantalla(situacion.patrimonio.totalMinor)}</td></tr></tfoot></table>
          <p className={`aviso ${situacion.cuadra ? 'ok' : 'error'}`}>
            {situacion.cuadra ? 'Activo = Pasivo + Patrimonio al corte.' : 'Activo ≠ Pasivo + Patrimonio al corte.'}
          </p>
          {situacion.saldosContrarios.length > 0 && (
            <p className="aviso seguridad">
              Saldos contrarios visibles: {situacion.saldosContrarios.map(s => `${s.codigo} (${s.saldoMinor})`).join(', ')}. Revíselos con el contador.
            </p>
          )}
          {situacion.comparativo && (
            <p className="menor">
              Comparativo al {situacion.comparativo.corte}: activo {formatoDineroPantalla(situacion.comparativo.activo.totalMinor)}, pasivo {formatoDineroPantalla(situacion.comparativo.pasivo.totalMinor)}, patrimonio {formatoDineroPantalla(situacion.comparativo.patrimonio.totalMinor)}.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
