import type Database from 'better-sqlite3';
import { minorATexto, redondearDivision } from '../../shared/dinero';
import { rentabilidadProyectos, escaparCsv, type RentabilidadProyecto } from './fiscal';
import { estadoResultadosEstructurado, rangoAnterior } from './estadosFinancieros';

export interface RangoCostos {
  desde: string;
  hasta: string;
  ambitoId?: string;
}

const TIPOS = [
  ['materiales', 'Materiales', '5101'],
  ['personal', 'Personal', '5102'],
  ['transporte', 'Transporte', '5103'],
  ['subcontratacion', 'Subcontratación', '5104'],
  ['otros', 'Otros costos', '']
] as const;
type TipoCosto = typeof TIPOS[number][0];
type CuentaCosto = RentabilidadProyecto['cuentas'][number];

// Los textos proceden de minorATexto: dos decimales, sin separadores de miles.
const minor = (texto: string): bigint => BigInt(texto.replace('.', ''));
const tipoDe = (codigo: string): TipoCosto => TIPOS.find(t => t[2] === codigo)?.[0] ?? 'otros';
const sumar = (cuentas: CuentaCosto[]): bigint => cuentas.reduce((s, c) => s + minor(c.importeMinor), 0n);

// Porcentaje con dos decimales, half-up y signo; nunca usa punto flotante.
// Sin ingresos el margen porcentual es indefinido, aunque exista costo.
function porcentaje(margen: bigint, ingreso: bigint): string | null {
  if (ingreso === 0n) return null;
  const negativo = (margen < 0n) !== (ingreso < 0n);
  const valor = redondearDivision((margen < 0n ? -margen : margen) * 10000n, ingreso < 0n ? -ingreso : ingreso);
  return minorATexto(negativo ? -valor : valor);
}

function filaProyecto(p: Omit<RentabilidadProyecto, 'id'> & { id: number | null }) {
  const cuentas = p.cuentas.filter(c => c.tipo === 'costo');
  const ingreso = minor(p.ingresoMinor);
  const costo = minor(p.costoMinor);
  const margen = minor(p.margenMinor);
  const deTipo = (tipo: TipoCosto): string => minorATexto(sumar(cuentas.filter(c => tipoDe(c.codigo) === tipo)));
  return {
    proyectoId: p.id, codigo: p.codigo, nombre: p.nombre,
    materialesMinor: deTipo('materiales'), personalMinor: deTipo('personal'),
    transporteMinor: deTipo('transporte'), subcontratacionMinor: deTipo('subcontratacion'),
    otrosMinor: deTipo('otros'), costoMinor: minorATexto(costo),
    ingresoMinor: p.ingresoMinor, margenMinor: p.margenMinor,
    margenPorcentaje: porcentaje(margen, ingreso), cuentas
  };
}

export function costosPorProyecto(db: Database.Database, entrada: RangoCostos) {
  const rentabilidad = rentabilidadProyectos(db, { ...entrada, incluirGastos: false });
  const proyectos = rentabilidad.proyectos.map(filaProyecto);
  const sinProyecto = filaProyecto(rentabilidad.sinProyecto);
  const filas = [...proyectos, sinProyecto];
  const ingreso = filas.reduce((s, f) => s + minor(f.ingresoMinor), 0n);
  const costo = filas.reduce((s, f) => s + minor(f.costoMinor), 0n);
  return {
    ...entrada, ambitoId: entrada.ambitoId ?? 'administrativo', proyectos, sinProyecto,
    totalCostoMinor: minorATexto(costo), totalIngresoMinor: minorATexto(ingreso),
    totalMargenMinor: minorATexto(ingreso - costo), margenPorcentaje: porcentaje(ingreso - costo, ingreso),
    provisional: rentabilidad.provisional
  };
}

function tiposDelRango(db: Database.Database, entrada: RangoCostos) {
  const reporte = costosPorProyecto(db, entrada);
  const cuentas = new Map<string, CuentaCosto>();
  for (const proyecto of [...reporte.proyectos, reporte.sinProyecto]) {
    for (const cuenta of proyecto.cuentas) {
      const previa = cuentas.get(cuenta.codigo);
      cuentas.set(cuenta.codigo, {
        ...cuenta, importeMinor: minorATexto(minor(cuenta.importeMinor) + (previa ? minor(previa.importeMinor) : 0n))
      });
    }
  }
  return {
    desde: entrada.desde, hasta: entrada.hasta, ambitoId: reporte.ambitoId,
    tipos: TIPOS.map(([tipo, nombre]) => {
      const propias = [...cuentas.values()].filter(c => tipoDe(c.codigo) === tipo)
        .sort((a, b) => a.codigo.localeCompare(b.codigo));
      return { tipo, nombre, importeMinor: minorATexto(sumar(propias)), cuentas: propias };
    }),
    totalCostoMinor: reporte.totalCostoMinor
  };
}

export function costosPorTipo(db: Database.Database, entrada: RangoCostos & { comparativo?: boolean }) {
  const actual = tiposDelRango(db, entrada);
  const periodoAnterior = entrada.comparativo === false ? null : tiposDelRango(db, {
    ...rangoAnterior(entrada.desde, entrada.hasta), ambitoId: entrada.ambitoId
  });
  return { ...actual, periodoAnterior };
}

export function conciliacionCostos(db: Database.Database, entrada: RangoCostos) {
  const reporte = costosPorProyecto(db, entrada);
  const resultados = estadoResultadosEstructurado(db, entrada);
  const estado = [...resultados.costos, ...resultados.otrosCostos]
    .reduce((s, c) => s + minor(c.importeMinor), 0n);
  const diferencia = minor(reporte.totalCostoMinor) - estado;
  return {
    ...entrada, ambitoId: reporte.ambitoId, totalCostosMinor: reporte.totalCostoMinor,
    costosEstadoResultadosMinor: minorATexto(estado), diferenciaMinor: minorATexto(diferencia), cuadra: diferencia === 0n
  };
}

export function csvCostos(db: Database.Database, entrada: RangoCostos & { reporte?: 'proyecto' | 'tipo' }) {
  const lineas: string[] = [];
  let filas = 0;
  if (entrada.reporte === 'tipo') {
    const reporte = costosPorTipo(db, entrada);
    lineas.push('tipo,cuenta,nombre,costo,desde,hasta,ambito');
    for (const periodo of [reporte, reporte.periodoAnterior]) {
      if (!periodo) continue;
      for (const tipo of periodo.tipos) {
        for (const c of tipo.cuentas) {
          lineas.push([tipo.nombre, c.codigo, c.nombre, c.importeMinor, periodo.desde, periodo.hasta, periodo.ambitoId]
            .map(escaparCsv).join(','));
          filas++;
        }
      }
      lineas.push(['TOTAL', '', '', periodo.totalCostoMinor, periodo.desde, periodo.hasta, periodo.ambitoId]
        .map(escaparCsv).join(','));
    }
  } else {
    const reporte = costosPorProyecto(db, entrada);
    lineas.push('codigo,proyecto,materiales,personal,transporte,subcontratacion,otros,costo,ingreso,margen,margen_porcentaje');
    for (const p of [...reporte.proyectos, reporte.sinProyecto]) {
      lineas.push([p.codigo, p.nombre, p.materialesMinor, p.personalMinor, p.transporteMinor,
        p.subcontratacionMinor, p.otrosMinor, p.costoMinor, p.ingresoMinor, p.margenMinor, p.margenPorcentaje ?? '']
        .map(escaparCsv).join(','));
      filas++;
    }
    lineas.push(['TOTAL', '', '', '', '', '', '', reporte.totalCostoMinor,
      reporte.totalIngresoMinor, reporte.totalMargenMinor, reporte.margenPorcentaje ?? ''].map(escaparCsv).join(','));
  }
  return { csv: lineas.join('\n'), version: 'costos-v1', filas };
}
