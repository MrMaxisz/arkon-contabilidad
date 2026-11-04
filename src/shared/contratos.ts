export interface ContraparteResumen {
  id: number;
  nombre: string;
  esCliente: boolean;
  esProveedor: boolean;
  nrc: string | null;
  nit: string | null;
  activa: boolean;
}

export interface CuentaResumen {
  id: number;
  codigo: string;
  nombre: string;
  tipo: string;
  esGrupo: boolean;
  padreId: number | null;
  activa: boolean;
}

export interface ProyectoResumen {
  id: number;
  codigo: string;
  nombre: string;
  contraparteNombre: string;
  estado: string;
}

export interface CotizacionResumen {
  id: number;
  numero: string;
  revision: number;
  contraparteId: number;
  contraparteNombre: string;
  fecha: string;
  estado: string;
  congelada: boolean;
  baseMinor: string;
  ivaMinor: string;
  totalMinor: string;
  condiciones: string | null;
}

export interface VentaResumen {
  id: number;
  folio: string;
  fecha: string;
  concepto: string;
  contraparteId: number;
  contraparteNombre: string;
  totalMinor: string;
  saldoMinor: string;
  estado: string;
}

export interface CompraResumen {
  id: number;
  folio: string;
  fecha: string;
  concepto: string;
  contraparteId: number;
  contraparteNombre: string;
  totalMinor: string;
  saldoMinor: string;
  estado: string;
}

export interface MovimientoTesoreriaResumen {
  id: number;
  folio: string;
  tipo: string;
  fecha: string;
  concepto: string;
  montoMinor: string;
  estado: string;
  contraparteNombre: string | null;
}

export interface InfoRespaldo {
  id: number;
  creadoEn: string;
  nombre: string;
  hashSha256: string;
  versionApp: string;
  versionEsquema: number;
  estado: string;
}
