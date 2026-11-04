export interface Migracion {
  version: number;
  nombre: string;
  sql: string;
}

export const migraciones: Migracion[] = [
  {
    version: 1,
    nombre: 'nucleo_contable',
    sql: `
CREATE TABLE ambito (
  id TEXT PRIMARY KEY,
  nombre TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('administrativo','juridico')),
  activo INTEGER NOT NULL DEFAULT 1,
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE cuenta (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo TEXT NOT NULL UNIQUE,
  nombre TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('activo','pasivo','patrimonio','ingreso','costo','gasto')),
  es_grupo INTEGER NOT NULL DEFAULT 0,
  padre_id INTEGER REFERENCES cuenta(id),
  activa INTEGER NOT NULL DEFAULT 1,
  creado_en TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (es_grupo IN (0,1)),
  CHECK (activa IN (0,1))
);

CREATE TABLE periodo (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  inicio TEXT NOT NULL,
  fin TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'abierto' CHECK (estado IN ('abierto','cerrado')),
  UNIQUE (inicio, fin)
);

CREATE TABLE asiento (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  folio TEXT NOT NULL UNIQUE,
  fecha_operacion TEXT NOT NULL,
  fecha_registro TEXT NOT NULL DEFAULT (datetime('now')),
  periodo_id INTEGER NOT NULL REFERENCES periodo(id),
  ambito_id TEXT NOT NULL REFERENCES ambito(id),
  concepto TEXT NOT NULL,
  origen_tipo TEXT,
  origen_id TEXT,
  clave_idempotencia TEXT UNIQUE,
  estado TEXT NOT NULL DEFAULT 'contabilizado' CHECK (estado IN ('borrador','contabilizado','anulado')),
  reverso_de_id INTEGER REFERENCES asiento(id),
  responsable TEXT NOT NULL,
  motivo TEXT,
  contabilizado_en TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE asiento_linea (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asiento_id INTEGER NOT NULL REFERENCES asiento(id),
  cuenta_id INTEGER NOT NULL REFERENCES cuenta(id),
  debe_minor INTEGER NOT NULL DEFAULT 0 CHECK (debe_minor >= 0),
  haber_minor INTEGER NOT NULL DEFAULT 0 CHECK (haber_minor >= 0),
  CHECK ((debe_minor = 0) OR (haber_minor = 0)),
  CHECK (debe_minor + haber_minor > 0)
);
CREATE INDEX idx_linea_asiento ON asiento_linea(asiento_id);
CREATE INDEX idx_linea_cuenta ON asiento_linea(cuenta_id);

CREATE TABLE bitacora_evento (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fecha TEXT NOT NULL DEFAULT (datetime('now')),
  actor TEXT NOT NULL,
  tipo TEXT NOT NULL,
  entidad TEXT NOT NULL,
  entidad_id TEXT,
  detalle TEXT
);
CREATE INDEX idx_bitacora_fecha ON bitacora_evento(fecha);

CREATE TABLE respaldo (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  creado_en TEXT NOT NULL DEFAULT (datetime('now')),
  nombre TEXT NOT NULL,
  hash_sha256 TEXT NOT NULL,
  version_app TEXT NOT NULL,
  version_esquema INTEGER NOT NULL,
  estado TEXT NOT NULL CHECK (estado IN ('disponible','invalido'))
);

CREATE TABLE configuracion (
  clave TEXT PRIMARY KEY,
  valor TEXT,
  fuente TEXT,
  vigencia TEXT,
  actualizado_en TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE contraparte (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  es_cliente INTEGER NOT NULL DEFAULT 0,
  es_proveedor INTEGER NOT NULL DEFAULT 0,
  nrc TEXT,
  nit TEXT,
  clasificacion_tributaria TEXT,
  notas TEXT,
  activa INTEGER NOT NULL DEFAULT 1,
  creado_en TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (es_cliente IN (0,1)),
  CHECK (es_proveedor IN (0,1))
);
`
  }
];
