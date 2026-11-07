import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { fechaLocalElSalvador } from '../../shared/fechas';
import { limpiarMensajeError } from '../limpiarMensajeError';
import {
  BotonPeligro,
  BotonPrimario,
  BotonSecundario,
  EstadoCarga,
  EstadoError,
  EstadoSinResultados,
  EstadoVacio,
  formatoDineroPantalla
} from '../componentes';

interface Cuenta {
  id: number;
  codigo: string;
  nombre: string;
  tipo: string;
  esGrupo: boolean;
  activa: boolean;
}

interface ActivoFijoListado {
  id: number;
  codigo: string;
  descripcion: string;
  categoria: string;
  ubicacion: string;
  responsable: string;
  fechaAdquisicion: string;
  fechaInicioUso: string;
  costoMinor: string;
  residualMinor: string;
  vidaUtilMeses: number;
  estado: string;
  cuentaActivoId: number;
  cuentaDepreciacionId: number;
  cuentaGastoId: number;
  compraId: number | null;
  proyectoId: number | null;
  acumuladaMinor: string;
  valorLibrosMinor: string;
}

interface CuotaFicha {
  mes: string;
  numero: number;
  cuotaMinor: string;
  acumuladoMinor: string;
  aplicada: boolean;
  loteId: number | null;
  asientoFolio: string | null;
  fechaAplicacion: string | null;
}

interface BajaFicha {
  id: number;
  fechaOperacion: string;
  tipo: 'baja' | 'venta';
  importeMinor: string;
  acumuladaMinor: string;
  estado: string;
  responsable: string;
  motivo: string;
}

interface Ficha {
  activo: ActivoFijoListado;
  mesInicio: string;
  cuotas: CuotaFicha[];
  acumuladaMinor: string;
  valorLibrosMinor: string;
  baja: BajaFicha | null;
}

interface Lote {
  id: number;
  mes: string;
  totalMinor: string;
  responsable: string;
  asientoFolio: string;
  fecha: string;
}

interface FilaPrevia {
  activoId: number;
  codigo: string;
  descripcion: string;
  cuentaGastoId: number;
  cuentaDepreciacionId: number;
  numeroCuota: number;
  mes: string;
  cuotaMinor: string;
}

interface Previa {
  mes: string;
  filas: FilaPrevia[];
  totalMinor: string;
}

interface FilaCuadro {
  activoId: number;
  codigo: string;
  descripcion: string;
  categoria: string;
  estado: string;
  costoMinor: string;
  acumuladaMinor: string;
  valorLibrosMinor: string;
  gastoPeriodoMinor: string;
}

interface FilaCategoria {
  categoria: string;
  costoMinor: string;
  acumuladaMinor: string;
  valorLibrosMinor: string;
  gastoPeriodoMinor: string;
}

interface Cuadro {
  corte: string;
  periodoDesde: string;
  periodoHasta: string;
  filas: FilaCuadro[];
  categorias: FilaCategoria[];
  totales: {
    costoMinor: string;
    acumuladaMinor: string;
    valorLibrosMinor: string;
    gastoPeriodoMinor: string;
  };
}

interface FilaConciliacion {
  cuentaId: number;
  codigo: string;
  nombre: string;
  tipo: 'activo' | 'acumulada';
  saldoMayorMinor: string;
  saldoReporteMinor: string;
  diferenciaMinor: string;
}

interface Conciliacion {
  corte: string;
  filas: FilaConciliacion[];
  cuadra: boolean;
  totalDiferenciaMinor: string;
}

interface FormAlta {
  descripcion: string;
  categoria: string;
  ubicacion: string;
  responsable: string;
  fechaAdquisicion: string;
  fechaInicioUso: string;
  costoMinor: string;
  residualMinor: string;
  vidaUtilMeses: string;
  cuentaActivoId: number;
  cuentaDepreciacionId: number;
  cuentaGastoId: number;
  cuentaContrapartidaId: number;
}

type Mensaje = { texto: string; tipo: 'ok' | 'error' } | null;

// Sección plegable (bloque 5D): divide la pantalla larga en bloques con encabezado clicable.
function SeccionPlegable(props: { titulo: string; abierta?: boolean; children: React.ReactNode }): React.JSX.Element {
  return (
    <details className="seccion-plegable" open={props.abierta ?? false}>
      <summary><h2>{props.titulo}</h2></summary>
      <div className="cuerpo-seccion">{props.children}</div>
    </details>
  );
}

function altaInicial(): FormAlta {
  const hoy = fechaLocalElSalvador();
  return {
    descripcion: '',
    categoria: '',
    ubicacion: '',
    responsable: '',
    fechaAdquisicion: hoy,
    fechaInicioUso: hoy,
    costoMinor: '',
    residualMinor: '0.00',
    vidaUtilMeses: '12',
    cuentaActivoId: 0,
    cuentaDepreciacionId: 0,
    cuentaGastoId: 0,
    cuentaContrapartidaId: 0
  };
}

export default function ActivosFijos() {
  const [mensaje, setMensaje] = useState<Mensaje>(null);
  const [cuentas, setCuentas] = useState<Cuenta[]>([]);

  const [activos, setActivos] = useState<ActivoFijoListado[]>([]);
  const [cargandoLista, setCargandoLista] = useState(true);
  const [errorLista, setErrorLista] = useState<string | null>(null);
  const consultaListaRef = useRef(0);
  const [filtroTexto, setFiltroTexto] = useState('');
  const [filtroCategoria, setFiltroCategoria] = useState('');
  const [filtroEstado, setFiltroEstado] = useState('');

  const [alta, setAlta] = useState<FormAlta>(altaInicial);
  const [ocupadoAlta, setOcupadoAlta] = useState(false);
  const [errorAlta, setErrorAlta] = useState<string | null>(null);

  const [fichaId, setFichaId] = useState<number | null>(null);
  const [ficha, setFicha] = useState<Ficha | null>(null);
  const [cargandoFicha, setCargandoFicha] = useState(false);
  const [errorFicha, setErrorFicha] = useState<string | null>(null);
  const consultaFichaRef = useRef(0);

  const [mesDepreciacion, setMesDepreciacion] = useState(fechaLocalElSalvador().slice(0, 7));
  const [responsableDep, setResponsableDep] = useState('');
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [cargandoPrevia, setCargandoPrevia] = useState(false);
  const [errorPrevia, setErrorPrevia] = useState<string | null>(null);
  const [depreciando, setDepreciando] = useState(false);
  const consultaPreviaRef = useRef(0);

  const [ultimoLote, setUltimoLote] = useState<Lote | null>(null);
  const consultaLoteRef = useRef(0);

  const [dialogoAnular, setDialogoAnular] = useState(false);
  const [motivoAnular, setMotivoAnular] = useState('');
  const [responsableAnular, setResponsableAnular] = useState('');
  const [errorAnular, setErrorAnular] = useState<string | null>(null);
  const [ocupadoAnular, setOcupadoAnular] = useState(false);
  const origenAnularRef = useRef<HTMLButtonElement | null>(null);

  const [dialogoBaja, setDialogoBaja] = useState(false);
  const [bajaTipo, setBajaTipo] = useState<'baja' | 'venta'>('baja');
  const [bajaFecha, setBajaFecha] = useState(fechaLocalElSalvador());
  const [bajaImporte, setBajaImporte] = useState('0.00');
  const [bajaCuenta, setBajaCuenta] = useState(0);
  const [bajaResponsable, setBajaResponsable] = useState('');
  const [bajaMotivo, setBajaMotivo] = useState('');
  const [errorBaja, setErrorBaja] = useState<string | null>(null);
  const [ocupadoBaja, setOcupadoBaja] = useState(false);
  const origenBajaRef = useRef<HTMLButtonElement | null>(null);

  const [corte, setCorte] = useState(fechaLocalElSalvador());
  const [cuadro, setCuadro] = useState<Cuadro | null>(null);
  const [conciliacion, setConciliacion] = useState<Conciliacion | null>(null);
  const [cargandoCuadro, setCargandoCuadro] = useState(false);
  const [errorCuadro, setErrorCuadro] = useState<string | null>(null);
  const [guardandoPdf, setGuardandoPdf] = useState(false);
  const consultaCuadroRef = useRef(0);

  const cargarActivos = useCallback(() => {
    const numero = ++consultaListaRef.current;
    setCargandoLista(true);
    setErrorLista(null);
    void api()
      .invocar('activo:listar')
      .then(r => {
        if (consultaListaRef.current === numero) {
          setActivos(r as ActivoFijoListado[]);
        }
      })
      .catch(err => {
        if (consultaListaRef.current === numero) {
          setErrorLista(`Error al consultar activos fijos: ${limpiarMensajeError(err)}`);
        }
      })
      .finally(() => {
        if (consultaListaRef.current === numero) {
          setCargandoLista(false);
        }
      });
  }, []);

  const cargarUltimoLote = useCallback(() => {
    const numero = ++consultaLoteRef.current;
    void api()
      .invocar('activo:ultimoLote')
      .then(r => {
        if (consultaLoteRef.current === numero) {
          setUltimoLote((r as Lote | null) ?? null);
        }
      })
      .catch(() => {
        if (consultaLoteRef.current === numero) {
          setUltimoLote(null);
        }
      });
  }, []);

  const cargarFicha = useCallback((id: number) => {
    const numero = ++consultaFichaRef.current;
    setCargandoFicha(true);
    setErrorFicha(null);
    void api()
      .invocar('activo:ficha', { activoId: id })
      .then(r => {
        if (consultaFichaRef.current === numero) {
          setFicha(r as Ficha);
        }
      })
      .catch(err => {
        if (consultaFichaRef.current === numero) {
          setFicha(null);
          setErrorFicha(`Error al consultar la ficha: ${limpiarMensajeError(err)}`);
        }
      })
      .finally(() => {
        if (consultaFichaRef.current === numero) {
          setCargandoFicha(false);
        }
      });
  }, []);

  useEffect(() => {
    cargarActivos();
    cargarUltimoLote();
    void api()
      .invocar('cuenta:listar')
      .then(r => setCuentas(r as Cuenta[]))
      .catch(() => setCuentas([]));
  }, [cargarActivos, cargarUltimoLote]);

  useEffect(() => {
    if (fichaId === null) {
      consultaFichaRef.current += 1;
      setFicha(null);
      setCargandoFicha(false);
      setErrorFicha(null);
      return;
    }
    cargarFicha(fichaId);
  }, [fichaId, cargarFicha]);

  useEffect(() => {
    if (!dialogoAnular) {
      return;
    }
    const alPresionar = (evento: KeyboardEvent) => {
      if (evento.key === 'Escape' && !ocupadoAnular) {
        cancelarAnulacion();
        origenAnularRef.current?.focus();
      }
    };
    document.addEventListener('keydown', alPresionar);
    return () => document.removeEventListener('keydown', alPresionar);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialogoAnular, ocupadoAnular]);

  useEffect(() => {
    if (!dialogoBaja) {
      return;
    }
    const alPresionar = (evento: KeyboardEvent) => {
      if (evento.key === 'Escape' && !ocupadoBaja) {
        cancelarBaja();
        origenBajaRef.current?.focus();
      }
    };
    document.addEventListener('keydown', alPresionar);
    return () => document.removeEventListener('keydown', alPresionar);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialogoBaja, ocupadoBaja]);

  const categorias = useMemo(
    () => [...new Set(activos.map(a => a.categoria))].sort((a, b) => a.localeCompare(b)),
    [activos]
  );

  const activosFiltrados = useMemo(() => {
    const texto = filtroTexto.trim().toLowerCase();
    return activos.filter(a => {
      const coincideTexto =
        !texto ||
        [a.codigo, a.descripcion, a.ubicacion, a.responsable]
          .some(valor => valor.toLowerCase().includes(texto));
      return (
        coincideTexto &&
        (!filtroCategoria || a.categoria === filtroCategoria) &&
        (!filtroEstado || a.estado === filtroEstado)
      );
    });
  }, [activos, filtroTexto, filtroCategoria, filtroEstado]);

  const cuentasActivo = cuentas.filter(c => c.activa && !c.esGrupo && c.tipo === 'activo' && c.codigo !== '1502');
  const cuentasDepreciacion = cuentas.filter(c => c.activa && !c.esGrupo && c.codigo === '1502');
  const cuentasGasto = cuentas.filter(c => c.activa && !c.esGrupo && c.tipo === 'gasto');
  const cuentasContrapartida = cuentas.filter(
    c => c.activa && !c.esGrupo && c.codigo !== '1502' && c.tipo !== 'gasto' && c.tipo !== 'ingreso'
  );

  function actualizarAlta<K extends keyof FormAlta>(campo: K, valor: FormAlta[K]): void {
    setAlta(actual => ({ ...actual, [campo]: valor }));
  }

  async function registrarAlta(evento: React.FormEvent) {
    evento.preventDefault();
    if (ocupadoAlta) {
      return;
    }
    setErrorAlta(null);
    if (!alta.cuentaActivoId || !alta.cuentaDepreciacionId || !alta.cuentaGastoId) {
      setErrorAlta('Seleccione las cuentas de activo, depreciación acumulada y gasto.');
      return;
    }
    if (!alta.cuentaContrapartidaId) {
      setErrorAlta('Sin compra de origen se requiere la cuenta de contrapartida.');
      return;
    }
    setOcupadoAlta(true);
    try {
      const resultado = (await api().invocar('activo:alta', {
        descripcion: alta.descripcion,
        categoria: alta.categoria,
        ubicacion: alta.ubicacion,
        responsable: alta.responsable,
        fechaAdquisicion: alta.fechaAdquisicion,
        fechaInicioUso: alta.fechaInicioUso,
        costoMinor: alta.costoMinor,
        residualMinor: alta.residualMinor,
        vidaUtilMeses: Number(alta.vidaUtilMeses),
        cuentaActivoId: alta.cuentaActivoId,
        cuentaDepreciacionId: alta.cuentaDepreciacionId,
        cuentaGastoId: alta.cuentaGastoId,
        cuentaContrapartidaId: alta.cuentaContrapartidaId
      })) as { codigo: string; asientoAltaId: number | null };
      setMensaje({
        texto:
          `Activo ${resultado.codigo} dado de alta. ` +
          (resultado.asientoAltaId
            ? 'Se contabilizó el asiento de alta.'
            : 'La compra de origen ya estaba contabilizada; no se duplicó el asiento.'),
        tipo: 'ok'
      });
      setAlta(actual => ({
        ...altaInicial(),
        responsable: actual.responsable,
        fechaAdquisicion: actual.fechaAdquisicion,
        fechaInicioUso: actual.fechaInicioUso
      }));
      cargarActivos();
    } catch (err) {
      setErrorAlta(limpiarMensajeError(err));
    } finally {
      setOcupadoAlta(false);
    }
  }

  function abrirFicha(id: number): void {
    setFichaId(id);
  }

  function cerrarFicha(): void {
    consultaFichaRef.current += 1;
    setFichaId(null);
    setFicha(null);
  }

  function cambiarMesDepreciacion(valor: string): void {
    consultaPreviaRef.current += 1;
    setMesDepreciacion(valor);
    setPrevia(null);
    setErrorPrevia(null);
    setCargandoPrevia(false);
  }

  async function verPrevia() {
    const numero = ++consultaPreviaRef.current;
    setCargandoPrevia(true);
    setErrorPrevia(null);
    setPrevia(null);
    try {
      const r = (await api().invocar('activo:previsualizarDepreciacion', {
        mes: mesDepreciacion
      })) as Previa;
      if (consultaPreviaRef.current === numero) {
        setPrevia(r);
      }
    } catch (err) {
      if (consultaPreviaRef.current === numero) {
        setErrorPrevia(limpiarMensajeError(err));
      }
    } finally {
      if (consultaPreviaRef.current === numero) {
        setCargandoPrevia(false);
      }
    }
  }

  async function aplicarDepreciacion() {
    if (!previa || previa.mes !== mesDepreciacion) {
      setErrorPrevia('Genere la vista previa del mes antes de depreciar.');
      return;
    }
    if (!responsableDep.trim()) {
      setErrorPrevia('La depreciación requiere responsable.');
      return;
    }
    if (depreciando) {
      return;
    }
    setDepreciando(true);
    setErrorPrevia(null);
    try {
      const r = (await api().invocar('activo:depreciarMes', {
        mes: mesDepreciacion,
        responsable: responsableDep.trim()
      })) as { asientoFolio: string; totalMinor: string; existente: boolean };
      setMensaje({
        texto: r.existente
          ? `El mes ${mesDepreciacion} ya estaba depreciado (asiento ${r.asientoFolio}, total ${formatoDineroPantalla(r.totalMinor)}).`
          : `Depreciación de ${mesDepreciacion} contabilizada por ${formatoDineroPantalla(r.totalMinor)} (asiento ${r.asientoFolio}).`,
        tipo: 'ok'
      });
      consultaPreviaRef.current += 1;
      setPrevia(null);
      cargarActivos();
      cargarUltimoLote();
      if (fichaId !== null) {
        cargarFicha(fichaId);
      }
    } catch (err) {
      setErrorPrevia(limpiarMensajeError(err));
    } finally {
      setDepreciando(false);
    }
  }

  function abrirAnulacion(origen: HTMLButtonElement): void {
    origenAnularRef.current = origen;
    setDialogoAnular(true);
    setMotivoAnular('');
    setResponsableAnular(responsableDep.trim());
    setErrorAnular(null);
  }

  function cancelarAnulacion(): void {
    setDialogoAnular(false);
    setMotivoAnular('');
    setResponsableAnular('');
    setErrorAnular(null);
  }

  async function confirmarAnulacion(evento: React.FormEvent) {
    evento.preventDefault();
    if (ocupadoAnular || !ultimoLote) {
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
    setErrorAnular(null);
    try {
      const r = (await api().invocar('activo:anularUltimoLote', {
        responsable: responsableAnular.trim(),
        motivo: motivoAnular.trim()
      })) as { mes: string; reversoFolio: string };
      setMensaje({
        texto: `Lote de ${r.mes} anulado con reverso ${r.reversoFolio}; el mes queda disponible para rehacerse.`,
        tipo: 'ok'
      });
      setDialogoAnular(false);
      setMotivoAnular('');
      setResponsableAnular('');
      cargarActivos();
      cargarUltimoLote();
      if (fichaId !== null) {
        cargarFicha(fichaId);
      }
    } catch (err) {
      setErrorAnular(limpiarMensajeError(err));
    } finally {
      setOcupadoAnular(false);
    }
  }

  function abrirBaja(origen: HTMLButtonElement): void {
    origenBajaRef.current = origen;
    setDialogoBaja(true);
    setBajaTipo('baja');
    setBajaFecha(fechaLocalElSalvador());
    setBajaImporte('0.00');
    setBajaCuenta(0);
    setBajaResponsable(alta.responsable.trim());
    setBajaMotivo('');
    setErrorBaja(null);
  }

  function cancelarBaja(): void {
    setDialogoBaja(false);
    setBajaMotivo('');
    setErrorBaja(null);
  }

  async function confirmarBaja(evento: React.FormEvent) {
    evento.preventDefault();
    if (!ficha || ocupadoBaja) {
      return;
    }
    if (bajaMotivo.trim().length < 10) {
      setErrorBaja('La baja o venta exige un motivo significativo (mínimo 10 caracteres).');
      return;
    }
    if (!bajaResponsable.trim()) {
      setErrorBaja('La baja o venta exige responsable.');
      return;
    }
    if (bajaTipo === 'venta') {
      if (!/^\d+(\.\d{1,2})?$/.test(bajaImporte.trim()) || bajaImporte.trim() === '0.00') {
        setErrorBaja('La venta exige un importe positivo con dos decimales.');
        return;
      }
      if (!bajaCuenta) {
        setErrorBaja('La venta exige la cuenta de cobro.');
        return;
      }
    }
    setOcupadoBaja(true);
    setErrorBaja(null);
    try {
      const r = (await api().invocar('activo:baja', {
        activoId: ficha.activo.id,
        tipo: bajaTipo,
        fechaOperacion: bajaFecha,
        importeMinor: bajaTipo === 'venta' ? bajaImporte : '0.00',
        cuentaCobroId: bajaTipo === 'venta' ? bajaCuenta : undefined,
        responsable: bajaResponsable.trim(),
        motivo: bajaMotivo.trim()
      })) as {
        asientoFolio: string;
        valorLibrosMinor: string;
        resultadoMinor: string;
      };
      setMensaje({
        texto:
          `${bajaTipo === 'venta' ? 'Venta' : 'Baja'} de ${ficha.activo.codigo} contabilizada ` +
          `(asiento ${r.asientoFolio}); valor en libros ${formatoDineroPantalla(r.valorLibrosMinor)}, ` +
          `resultado ${formatoDineroPantalla(r.resultadoMinor)}.`,
        tipo: 'ok'
      });
      setDialogoBaja(false);
      setBajaMotivo('');
      cargarActivos();
      cargarUltimoLote();
      cargarFicha(ficha.activo.id);
    } catch (err) {
      setErrorBaja(limpiarMensajeError(err));
    } finally {
      setOcupadoBaja(false);
    }
  }

  function cambiarCorte(valor: string): void {
    consultaCuadroRef.current += 1;
    setCorte(valor);
    setCuadro(null);
    setConciliacion(null);
    setErrorCuadro(null);
    setCargandoCuadro(false);
  }

  async function consultarCuadro() {
    const numero = ++consultaCuadroRef.current;
    setCargandoCuadro(true);
    setErrorCuadro(null);
    setCuadro(null);
    setConciliacion(null);
    try {
      const [c, conc] = await Promise.all([
        api().invocar('reporte:activosFijosCuadro', { corte }),
        api().invocar('reporte:activosFijosConciliacion', { corte })
      ]);
      if (consultaCuadroRef.current === numero) {
        setCuadro(c as Cuadro);
        setConciliacion(conc as Conciliacion);
      }
    } catch (err) {
      if (consultaCuadroRef.current === numero) {
        setErrorCuadro(`Error al consultar el cuadro general: ${limpiarMensajeError(err)}`);
      }
    } finally {
      if (consultaCuadroRef.current === numero) {
        setCargandoCuadro(false);
      }
    }
  }

  async function guardarPdf() {
    if (!cuadro) {
      return;
    }
    setGuardandoPdf(true);
    setMensaje(null);
    try {
      const tablas = [
        {
          titulo: 'Por activo',
          encabezados: [
            'Categoría',
            'Código',
            'Descripción',
            'Costo',
            'Acumulada',
            'Valor en libros',
            'Gasto del período'
          ],
          filas: cuadro.filas.map(f => [
            f.categoria,
            f.codigo,
            f.descripcion,
            formatoDineroPantalla(f.costoMinor),
            formatoDineroPantalla(f.acumuladaMinor),
            formatoDineroPantalla(f.valorLibrosMinor),
            formatoDineroPantalla(f.gastoPeriodoMinor)
          ]),
          total: [
            'Total',
            '',
            '',
            formatoDineroPantalla(cuadro.totales.costoMinor),
            formatoDineroPantalla(cuadro.totales.acumuladaMinor),
            formatoDineroPantalla(cuadro.totales.valorLibrosMinor),
            formatoDineroPantalla(cuadro.totales.gastoPeriodoMinor)
          ]
        }
      ];
      if (cuadro.categorias.length > 0) {
        tablas.push({
          titulo: 'Por categoría',
          encabezados: ['Categoría', 'Costo', 'Acumulada', 'Valor en libros', 'Gasto del período'],
          filas: cuadro.categorias.map(c => [
            c.categoria,
            formatoDineroPantalla(c.costoMinor),
            formatoDineroPantalla(c.acumuladaMinor),
            formatoDineroPantalla(c.valorLibrosMinor),
            formatoDineroPantalla(c.gastoPeriodoMinor)
          ]),
          total: [
            'Total',
            formatoDineroPantalla(cuadro.totales.costoMinor),
            formatoDineroPantalla(cuadro.totales.acumuladaMinor),
            formatoDineroPantalla(cuadro.totales.valorLibrosMinor),
            formatoDineroPantalla(cuadro.totales.gastoPeriodoMinor)
          ]
        });
      }
      if (conciliacion) {
        tablas.push({
          titulo: 'Conciliación con el mayor',
          encabezados: ['Cuenta', 'Tipo', 'Saldo del mayor', 'Saldo del reporte', 'Diferencia'],
          filas: conciliacion.filas.map(f => [
            `${f.codigo} · ${f.nombre}`,
            f.tipo,
            formatoDineroPantalla(f.saldoMayorMinor),
            formatoDineroPantalla(f.saldoReporteMinor),
            formatoDineroPantalla(f.diferenciaMinor)
          ]),
          total: ['', '', '', '', formatoDineroPantalla(conciliacion.totalDiferenciaMinor)]
        });
      }
      const r = (await api().reportePdf({
        titulo: 'Cuadro general de activos fijos',
        periodo: `Corte ${cuadro.corte} · ${cuadro.periodoDesde} a ${cuadro.periodoHasta}`,
        ambito: 'administrativo',
        tablas
      })) as { guardado?: boolean; ruta?: string };
      setMensaje({
        texto: r.guardado && r.ruta ? `PDF del cuadro guardado en ${r.ruta}.` : 'Guardado del PDF cancelado.',
        tipo: r.guardado ? 'ok' : 'error'
      });
    } catch (err) {
      setMensaje({ texto: `Error al guardar el PDF: ${limpiarMensajeError(err)}`, tipo: 'error' });
    } finally {
      setGuardandoPdf(false);
    }
  }

  return (
    <div>
      <h1>Activos fijos</h1>
      {mensaje && <p className={`aviso ${mensaje.tipo}`}>{mensaje.texto}</p>}

      <SeccionPlegable titulo="Listado" abierta>
      <div className="fila">
        <label>Buscar
          <input
            value={filtroTexto}
            onChange={e => setFiltroTexto(e.target.value)}
            placeholder="Código, descripción, ubicación o responsable"
          />
        </label>
        <label>Categoría
          <select value={filtroCategoria} onChange={e => setFiltroCategoria(e.target.value)}>
            <option value="">Todas</option>
            {categorias.map(categoria => (
              <option key={categoria} value={categoria}>{categoria}</option>
            ))}
          </select>
        </label>
        <label>Estado
          <select value={filtroEstado} onChange={e => setFiltroEstado(e.target.value)}>
            <option value="">Todos</option>
            <option value="activo">Activo</option>
            <option value="dado_de_baja">Dado de baja</option>
            <option value="vendido">Vendido</option>
          </select>
        </label>
        <BotonSecundario onClick={cargarActivos} disabled={cargandoLista}>Actualizar</BotonSecundario>
      </div>

      {errorLista && <EstadoError mensaje={errorLista} />}
      {cargandoLista && activos.length === 0 && <EstadoCarga texto="Cargando activos fijos…" />}
      {!cargandoLista && !errorLista && activos.length === 0 && (
        <EstadoVacio texto="Sin activos fijos registrados." />
      )}
      {activos.length > 0 && activosFiltrados.length === 0 && (
        <EstadoSinResultados texto="Ningún activo coincide con los filtros." />
      )}
      {activosFiltrados.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Código</th>
              <th>Descripción</th>
              <th>Categoría</th>
              <th>Ubicación</th>
              <th className="numero">Costo</th>
              <th className="numero">Acumulada</th>
              <th className="numero">Valor en libros</th>
              <th>Estado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {activosFiltrados.map(a => (
              <tr key={a.id}>
                <td className="folio">{a.codigo}</td>
                <td>{a.descripcion}</td>
                <td>{a.categoria}</td>
                <td>{a.ubicacion}</td>
                <td className="numero">{formatoDineroPantalla(a.costoMinor)}</td>
                <td className="numero">{formatoDineroPantalla(a.acumuladaMinor)}</td>
                <td className="numero">{formatoDineroPantalla(a.valorLibrosMinor)}</td>
                <td>{a.estado}</td>
                <td>
                  <BotonSecundario onClick={() => abrirFicha(a.id)}>Ficha</BotonSecundario>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {fichaId !== null && (
        <section>
          <div className="fila">
            <h2>Ficha del activo</h2>
            <BotonSecundario onClick={cerrarFicha}>Cerrar ficha</BotonSecundario>
          </div>
          {cargandoFicha && <EstadoCarga texto="Cargando ficha del activo…" />}
          {errorFicha && <EstadoError mensaje={errorFicha} />}
          {ficha && (
            <>
              <h3>{ficha.activo.codigo} · {ficha.activo.descripcion}</h3>
              <p className="menor">
                Categoría: {ficha.activo.categoria} · Ubicación: {ficha.activo.ubicacion} · Responsable: {ficha.activo.responsable} ·
                Estado: {ficha.activo.estado}
              </p>
              <p className="menor">
                Adquisición: {ficha.activo.fechaAdquisicion} · Inicio de uso: {ficha.activo.fechaInicioUso} ·
                Vida útil: {ficha.activo.vidaUtilMeses} meses · Primera cuota: {ficha.mesInicio}
              </p>
              <div className="fila">
                <span>Costo: <strong>{formatoDineroPantalla(ficha.activo.costoMinor)}</strong></span>
                <span>Residual: <strong>{formatoDineroPantalla(ficha.activo.residualMinor)}</strong></span>
                <span>Acumulada: <strong>{formatoDineroPantalla(ficha.acumuladaMinor)}</strong></span>
                <span>Valor en libros: <strong>{formatoDineroPantalla(ficha.valorLibrosMinor)}</strong></span>
              </div>

              <h3>Cuadro de depreciación</h3>
              {ficha.cuotas.length === 0 ? (
                <EstadoVacio texto="Sin cuotas de depreciación." />
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Mes</th>
                      <th className="numero">Cuota</th>
                      <th className="numero">Acumulado</th>
                      <th>Estado</th>
                      <th>Asiento</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ficha.cuotas.map(cuota => (
                      <tr key={cuota.mes}>
                        <td>{cuota.numero}</td>
                        <td>{cuota.mes}</td>
                        <td className="numero">{formatoDineroPantalla(cuota.cuotaMinor)}</td>
                        <td className="numero">{formatoDineroPantalla(cuota.acumuladoMinor)}</td>
                        <td>{cuota.aplicada ? 'Aplicada' : 'Pendiente'}</td>
                        <td className="folio">{cuota.asientoFolio ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {ficha.baja && (
                <p className="aviso error">
                  {ficha.baja.tipo === 'venta' ? 'Venta' : 'Baja'} registrada el {ficha.baja.fechaOperacion} por{' '}
                  {formatoDineroPantalla(ficha.baja.importeMinor)}. Motivo: {ficha.baja.motivo}.
                </p>
              )}
              {ficha.activo.estado === 'activo' && (
                <div className="fila">
                  <BotonPeligro onClick={e => abrirBaja(e.currentTarget)}>Baja o venta</BotonPeligro>
                </div>
              )}
            </>
          )}
        </section>
      )}
      </SeccionPlegable>

      <SeccionPlegable titulo="Depreciación del mes">
      <div className="fila">
        <label>Mes
          <input type="month" value={mesDepreciacion} onChange={e => cambiarMesDepreciacion(e.target.value)} />
        </label>
        <label>Responsable
          <input value={responsableDep} onChange={e => setResponsableDep(e.target.value)} required />
        </label>
        <BotonSecundario onClick={() => void verPrevia()} disabled={!mesDepreciacion || cargandoPrevia}>
          {cargandoPrevia ? 'Consultando…' : 'Vista previa'}
        </BotonSecundario>
        <BotonPrimario
          onClick={() => void aplicarDepreciacion()}
          disabled={depreciando || !previa || previa.mes !== mesDepreciacion}
        >
          {depreciando ? 'Depreciando…' : 'Depreciar mes'}
        </BotonPrimario>
      </div>
      {errorPrevia && <EstadoError mensaje={errorPrevia} />}
      {previa && (
        previa.filas.length === 0 ? (
          <EstadoVacio texto={`Sin cuotas pendientes para ${previa.mes}.`} />
        ) : (
          <>
            <table>
              <thead>
                <tr>
                  <th>Activo</th>
                  <th>Mes</th>
                  <th className="numero">Cuota</th>
                </tr>
              </thead>
              <tbody>
                {previa.filas.map(fila => (
                  <tr key={`${fila.activoId}-${fila.mes}`}>
                    <td>{fila.codigo} · {fila.descripcion}</td>
                    <td>{fila.mes}</td>
                    <td className="numero">{formatoDineroPantalla(fila.cuotaMinor)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>Total</td>
                  <td></td>
                  <td className="numero">{formatoDineroPantalla(previa.totalMinor)}</td>
                </tr>
              </tfoot>
            </table>
            <p className="menor">
              Se contabilizará una línea por combinación de cuentas y se respetarán períodos cerrados y cuotas pendientes.
            </p>
          </>
        )
      )}

      <h2>Último lote de depreciación</h2>
      {!ultimoLote ? (
        <EstadoVacio texto="Sin lotes de depreciación." />
      ) : (
        <>
          <p className="menor">
            {ultimoLote.mes} · {formatoDineroPantalla(ultimoLote.totalMinor)} · asiento {ultimoLote.asientoFolio} ·
            responsable {ultimoLote.responsable}
          </p>
          <BotonPeligro onClick={e => abrirAnulacion(e.currentTarget)}>Anular último lote</BotonPeligro>
        </>
      )}

      </SeccionPlegable>

      <SeccionPlegable titulo="Alta de activo fijo">
      {errorAlta && <EstadoError mensaje={errorAlta} />}
      <form onSubmit={registrarAlta}>
        <div className="fila">
          <label style={{ flex: 2 }}>Descripción
            <input value={alta.descripcion} onChange={e => actualizarAlta('descripcion', e.target.value)} required />
          </label>
          <label>Categoría
            <input value={alta.categoria} onChange={e => actualizarAlta('categoria', e.target.value)} required />
          </label>
          <label>Ubicación
            <input value={alta.ubicacion} onChange={e => actualizarAlta('ubicacion', e.target.value)} required />
          </label>
          <label>Responsable
            <input value={alta.responsable} onChange={e => actualizarAlta('responsable', e.target.value)} required />
          </label>
        </div>
        <div className="fila">
          <label>Fecha de adquisición
            <input type="date" value={alta.fechaAdquisicion} onChange={e => actualizarAlta('fechaAdquisicion', e.target.value)} required />
          </label>
          <label>Inicio de uso
            <input type="date" value={alta.fechaInicioUso} onChange={e => actualizarAlta('fechaInicioUso', e.target.value)} required />
          </label>
          <label>Costo
            <input value={alta.costoMinor} onChange={e => actualizarAlta('costoMinor', e.target.value)} required placeholder="0.00" />
          </label>
          <label>Valor residual
            <input value={alta.residualMinor} onChange={e => actualizarAlta('residualMinor', e.target.value)} placeholder="0.00" />
          </label>
          <label>Vida útil (meses)
            <input type="number" min={1} value={alta.vidaUtilMeses} onChange={e => actualizarAlta('vidaUtilMeses', e.target.value)} required />
          </label>
        </div>
        <div className="fila">
          <label>Cuenta de activo
            <select value={alta.cuentaActivoId} onChange={e => actualizarAlta('cuentaActivoId', Number(e.target.value))} required>
              <option value={0}>— Seleccione —</option>
              {cuentasActivo.map(c => <option key={c.id} value={c.id}>{c.codigo} · {c.nombre}</option>)}
            </select>
          </label>
          <label>Depreciación acumulada
            <select value={alta.cuentaDepreciacionId} onChange={e => actualizarAlta('cuentaDepreciacionId', Number(e.target.value))} required>
              <option value={0}>— Seleccione —</option>
              {cuentasDepreciacion.map(c => <option key={c.id} value={c.id}>{c.codigo} · {c.nombre}</option>)}
            </select>
          </label>
          <label>Gasto de depreciación
            <select value={alta.cuentaGastoId} onChange={e => actualizarAlta('cuentaGastoId', Number(e.target.value))} required>
              <option value={0}>— Seleccione —</option>
              {cuentasGasto.map(c => <option key={c.id} value={c.id}>{c.codigo} · {c.nombre}</option>)}
            </select>
          </label>
          <label>Contrapartida
            <select value={alta.cuentaContrapartidaId} onChange={e => actualizarAlta('cuentaContrapartidaId', Number(e.target.value))} required>
              <option value={0}>— Seleccione —</option>
              {cuentasContrapartida.map(c => <option key={c.id} value={c.id}>{c.codigo} · {c.nombre}</option>)}
            </select>
          </label>
          <BotonPrimario type="submit" disabled={ocupadoAlta}>{ocupadoAlta ? 'Registrando…' : 'Dar de alta'}</BotonPrimario>
        </div>
        <p className="menor">
          La depreciación empieza el mes siguiente al inicio de uso (política pendiente de confirmación del contador).
          Sin compra de origen, el alta contabiliza el asiento con la cuenta de contrapartida elegida.
        </p>
      </form>
      </SeccionPlegable>

      <SeccionPlegable titulo="Cuadro general">
      <div className="fila">
        <label>Fecha de corte
          <input type="date" value={corte} onChange={e => cambiarCorte(e.target.value)} />
        </label>
        <BotonSecundario onClick={() => void consultarCuadro()} disabled={!corte || cargandoCuadro}>
          {cargandoCuadro ? 'Consultando…' : 'Consultar cuadro'}
        </BotonSecundario>
        <BotonSecundario onClick={() => void guardarPdf()} disabled={!cuadro || guardandoPdf}>
          {guardandoPdf ? 'Guardando PDF…' : 'Guardar PDF…'}
        </BotonSecundario>
      </div>
      {errorCuadro && <EstadoError mensaje={errorCuadro} />}
      {cuadro && (
        <>
          {cuadro.filas.length === 0 ? (
            <EstadoVacio texto={`Sin activos al corte ${cuadro.corte}.`} />
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Descripción</th>
                  <th>Categoría</th>
                  <th className="numero">Costo</th>
                  <th className="numero">Acumulada</th>
                  <th className="numero">Valor en libros</th>
                  <th className="numero">Gasto del período</th>
                </tr>
              </thead>
              <tbody>
                {cuadro.filas.map(fila => (
                  <tr key={fila.activoId}>
                    <td className="folio">{fila.codigo}</td>
                    <td>{fila.descripcion}</td>
                    <td>{fila.categoria}</td>
                    <td className="numero">{formatoDineroPantalla(fila.costoMinor)}</td>
                    <td className="numero">{formatoDineroPantalla(fila.acumuladaMinor)}</td>
                    <td className="numero">{formatoDineroPantalla(fila.valorLibrosMinor)}</td>
                    <td className="numero">{formatoDineroPantalla(fila.gastoPeriodoMinor)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="total">
                  <td>Total</td>
                  <td></td>
                  <td></td>
                  <td className="numero">{formatoDineroPantalla(cuadro.totales.costoMinor)}</td>
                  <td className="numero">{formatoDineroPantalla(cuadro.totales.acumuladaMinor)}</td>
                  <td className="numero">{formatoDineroPantalla(cuadro.totales.valorLibrosMinor)}</td>
                  <td className="numero">{formatoDineroPantalla(cuadro.totales.gastoPeriodoMinor)}</td>
                </tr>
              </tfoot>
            </table>
          )}
          {cuadro.categorias.length > 0 && (
            <>
              <h3>Por categoría</h3>
              <table>
                <thead>
                  <tr>
                    <th>Categoría</th>
                    <th className="numero">Costo</th>
                    <th className="numero">Acumulada</th>
                    <th className="numero">Valor en libros</th>
                    <th className="numero">Gasto del período</th>
                  </tr>
                </thead>
                <tbody>
                  {cuadro.categorias.map(fila => (
                    <tr key={fila.categoria}>
                      <td>{fila.categoria}</td>
                      <td className="numero">{formatoDineroPantalla(fila.costoMinor)}</td>
                      <td className="numero">{formatoDineroPantalla(fila.acumuladaMinor)}</td>
                      <td className="numero">{formatoDineroPantalla(fila.valorLibrosMinor)}</td>
                      <td className="numero">{formatoDineroPantalla(fila.gastoPeriodoMinor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </>
      )}
      {conciliacion && (
        <>
          <h3>Conciliación con el mayor</h3>
          <p className={`aviso ${conciliacion.cuadra ? 'ok' : 'error'}`}>
            {conciliacion.cuadra
              ? 'El cuadro concilia con el mayor; no hay diferencias.'
              : `El cuadro NO concilia con el mayor. Diferencia total: ${formatoDineroPantalla(conciliacion.totalDiferenciaMinor)}. Se informa, no se ajusta.`}
          </p>
          {conciliacion.filas.length > 0 && (
            <table>
              <thead>
                <tr>
                  <th>Cuenta</th>
                  <th>Tipo</th>
                  <th className="numero">Saldo del mayor</th>
                  <th className="numero">Saldo del reporte</th>
                  <th className="numero">Diferencia</th>
                </tr>
              </thead>
              <tbody>
                {conciliacion.filas.map(fila => (
                  <tr key={`${fila.cuentaId}-${fila.tipo}`}>
                    <td>{fila.codigo} · {fila.nombre}</td>
                    <td>{fila.tipo}</td>
                    <td className="numero">{formatoDineroPantalla(fila.saldoMayorMinor)}</td>
                    <td className="numero">{formatoDineroPantalla(fila.saldoReporteMinor)}</td>
                    <td className="numero">{formatoDineroPantalla(fila.diferenciaMinor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}

      </SeccionPlegable>

      {dialogoAnular && ultimoLote && (
        <div className="aviso" role="dialog" aria-label={`Anular último lote ${ultimoLote.mes}`}>
          <h3>Anular último lote {ultimoLote.mes}</h3>
          <p className="menor">
            Total {formatoDineroPantalla(ultimoLote.totalMinor)} · asiento {ultimoLote.asientoFolio}. Se genera un
            reverso contable y el mes queda disponible para rehacerse; el motivo queda en bitácora.
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
              <BotonPeligro type="submit" disabled={ocupadoAnular}>
                {ocupadoAnular ? 'Anulando…' : 'Sí, anular último lote'}
              </BotonPeligro>
              <BotonSecundario type="button" onClick={cancelarAnulacion}>Cancelar</BotonSecundario>
            </div>
          </form>
        </div>
      )}

      {dialogoBaja && ficha && (
        <div className="aviso" role="dialog" aria-label={`Baja o venta de ${ficha.activo.codigo}`}>
          <h3>Baja o venta de {ficha.activo.codigo}</h3>
          <p className="menor">
            Valor en libros actual: {formatoDineroPantalla(ficha.valorLibrosMinor)}. Se deprecian las cuotas pendientes
            hasta el mes de la operación y se retira el costo y la acumulada.
          </p>
          {errorBaja && <p role="alert" className="aviso error">{errorBaja}</p>}
          <form onSubmit={confirmarBaja}>
            <div className="fila">
              <label>Tipo
                <select value={bajaTipo} onChange={e => setBajaTipo(e.target.value as 'baja' | 'venta')}>
                  <option value="baja">Baja</option>
                  <option value="venta">Venta</option>
                </select>
              </label>
              <label>Fecha
                <input type="date" value={bajaFecha} onChange={e => setBajaFecha(e.target.value)} required />
              </label>
              {bajaTipo === 'venta' && (
                <>
                  <label>Importe
                    <input value={bajaImporte} onChange={e => setBajaImporte(e.target.value)} required placeholder="0.00" />
                  </label>
                  <label>Cuenta de cobro
                    <select value={bajaCuenta} onChange={e => setBajaCuenta(Number(e.target.value))} required>
                      <option value={0}>— Seleccione —</option>
                      {cuentasActivo.map(c => <option key={c.id} value={c.id}>{c.codigo} · {c.nombre}</option>)}
                    </select>
                  </label>
                </>
              )}
            </div>
            <div className="fila">
              <label style={{ flex: 2 }}>Motivo
                <input value={bajaMotivo} onChange={e => setBajaMotivo(e.target.value)} required placeholder="Motivo significativo" autoFocus />
              </label>
              <label>Responsable
                <input value={bajaResponsable} onChange={e => setBajaResponsable(e.target.value)} required />
              </label>
            </div>
            <div className="fila">
              <BotonPeligro type="submit" disabled={ocupadoBaja}>
                {ocupadoBaja ? 'Registrando…' : `Sí, registrar ${bajaTipo}`}
              </BotonPeligro>
              <BotonSecundario type="button" onClick={cancelarBaja}>Cancelar</BotonSecundario>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
