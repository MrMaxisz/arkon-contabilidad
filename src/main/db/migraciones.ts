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
  },
  {
    version: 2,
    nombre: 'anticipos_y_proteccion_asientos',
    sql: `
UPDATE cuenta SET tipo = 'pasivo', padre_id = (SELECT id FROM cuenta WHERE codigo = '21'),
  nombre = 'Anticipos recibidos de clientes'
WHERE codigo = '1202';

UPDATE cuenta SET tipo = 'activo', padre_id = (SELECT id FROM cuenta WHERE codigo = '12')
WHERE codigo = '2102';

CREATE TRIGGER trg_asiento_linea_insert BEFORE INSERT ON asiento_linea
BEGIN
  SELECT CASE WHEN (SELECT estado FROM asiento WHERE id = NEW.asiento_id) != 'borrador'
    THEN RAISE(ABORT, 'Un asiento contabilizado no admite líneas nuevas') END;
END;

CREATE TRIGGER trg_asiento_linea_update BEFORE UPDATE ON asiento_linea
BEGIN
  SELECT CASE WHEN (SELECT estado FROM asiento WHERE id = OLD.asiento_id) != 'borrador'
    THEN RAISE(ABORT, 'Un asiento contabilizado no admite editar sus líneas') END;
END;

CREATE TRIGGER trg_asiento_linea_delete BEFORE DELETE ON asiento_linea
BEGIN
  SELECT CASE WHEN (SELECT estado FROM asiento WHERE id = OLD.asiento_id) != 'borrador'
    THEN RAISE(ABORT, 'Un asiento contabilizado no admite borrar sus líneas') END;
END;

CREATE TRIGGER trg_asiento_update BEFORE UPDATE ON asiento
WHEN OLD.estado != 'borrador'
BEGIN
  SELECT CASE
    WHEN NEW.folio IS NOT OLD.folio
      OR NEW.fecha_operacion IS NOT OLD.fecha_operacion
      OR NEW.periodo_id IS NOT OLD.periodo_id
      OR NEW.ambito_id IS NOT OLD.ambito_id
      OR NEW.concepto IS NOT OLD.concepto
      OR NEW.origen_tipo IS NOT OLD.origen_tipo
      OR NEW.origen_id IS NOT OLD.origen_id
      OR NEW.clave_idempotencia IS NOT OLD.clave_idempotencia
      OR NEW.reverso_de_id IS NOT OLD.reverso_de_id
      OR NEW.responsable IS NOT OLD.responsable
      OR NEW.fecha_registro IS NOT OLD.fecha_registro
      OR NEW.contabilizado_en IS NOT OLD.contabilizado_en
    THEN RAISE(ABORT, 'Un asiento contabilizado no admite cambios de contenido')
    WHEN NEW.estado = OLD.estado THEN NULL
    WHEN OLD.estado = 'contabilizado' AND NEW.estado = 'anulado' THEN NULL
    ELSE RAISE(ABORT, 'Transición de estado no permitida') END;
END;

CREATE TRIGGER trg_asiento_delete BEFORE DELETE ON asiento
WHEN OLD.estado != 'borrador'
BEGIN
  SELECT RAISE(ABORT, 'Un asiento contabilizado no se borra; use reverso');
END;
`
  }
];
