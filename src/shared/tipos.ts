export type TipoCuenta = 'activo' | 'pasivo' | 'patrimonio' | 'ingreso' | 'costo' | 'gasto';
export type EstadoAsiento = 'borrador' | 'contabilizado' | 'anulado';
export type EstadoPeriodo = 'abierto' | 'cerrado';
export type TipoAmbito = 'administrativo' | 'juridico';

export interface Cuenta {
  id: number;
  codigo: string;
  nombre: string;
  tipo: TipoCuenta;
  esGrupo: boolean;
  padreId: number | null;
  activa: boolean;
}

export interface LineaAsiento {
  cuentaId: number;
  debeMinor: string;
  haberMinor: string;
}

export interface AsientoResumen {
  id: number;
  folio: string;
  fechaOperacion: string;
  concepto: string;
  estado: EstadoAsiento;
  totalMinor: string;
  reversoDeId: number | null;
  origenTipo: string | null;
  origenId: string | null;
}

export interface EntradaAsiento {
  fechaOperacion: string;
  concepto: string;
  lineas: Array<{ cuentaId: number; debeMinor: string; haberMinor: string }>;
  origenTipo?: string;
  origenId?: string;
  claveIdempotencia?: string;
  responsable: string;
  ambitoId: string;
}

export interface ResultadoContabilizacion {
  asientoId: number;
  folio: string;
  duplicado: boolean;
}
