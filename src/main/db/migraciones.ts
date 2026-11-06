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
  },
  {
    version: 3,
    nombre: 'catalogo_canonico_y_traslado_lineas',
    sql: `
UPDATE cuenta SET codigo = '__tmp_arkon__' WHERE codigo = '1202' AND tipo = 'pasivo';

UPDATE cuenta SET codigo = '1202', nombre = 'Anticipos a proveedores',
  padre_id = (SELECT id FROM cuenta WHERE codigo = '12')
WHERE codigo = '2102' AND tipo = 'activo';

UPDATE cuenta SET codigo = '2102', nombre = 'Anticipos recibidos de clientes',
  padre_id = (SELECT id FROM cuenta WHERE codigo = '21')
WHERE codigo = '__tmp_arkon__';

DROP TRIGGER IF EXISTS trg_asiento_linea_update;

CREATE TRIGGER trg_asiento_linea_update BEFORE UPDATE ON asiento_linea
BEGIN
  SELECT CASE
    WHEN (SELECT estado FROM asiento WHERE id = OLD.asiento_id) != 'borrador'
      THEN RAISE(ABORT, 'Un asiento contabilizado no admite editar sus líneas')
    WHEN (SELECT estado FROM asiento WHERE id = NEW.asiento_id) != 'borrador'
      THEN RAISE(ABORT, 'Una línea no puede trasladarse a un asiento contabilizado') END;
END;
`
  },
  {
    version: 4,
    nombre: 'operacion_comercial',
    sql: `
ALTER TABLE cuenta ADD COLUMN es_efectivo INTEGER NOT NULL DEFAULT 0;

UPDATE cuenta SET es_efectivo = 1 WHERE codigo IN ('1101','1102','1103');

INSERT INTO cuenta (codigo, nombre, tipo, es_grupo, padre_id)
SELECT '1203', 'IVA crédito fiscal', 'activo', 0, (SELECT id FROM cuenta WHERE codigo = '12')
WHERE NOT EXISTS (SELECT 1 FROM cuenta WHERE codigo = '1203');

CREATE TABLE cotizacion (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  numero TEXT NOT NULL UNIQUE,
  revision INTEGER NOT NULL DEFAULT 1,
  contraparte_id INTEGER NOT NULL REFERENCES contraparte(id),
  fecha TEXT NOT NULL,
  vigencia TEXT,
  estado TEXT NOT NULL DEFAULT 'borrador' CHECK (estado IN ('borrador','aprobada','anulada')),
  condiciones TEXT,
  responsable TEXT NOT NULL,
  congelada INTEGER NOT NULL DEFAULT 0 CHECK (congelada IN (0,1)),
  proyecto_id INTEGER,
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE cotizacion_linea (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cotizacion_id INTEGER NOT NULL REFERENCES cotizacion(id),
  tipo TEXT NOT NULL CHECK (tipo IN ('servicio','material')),
  descripcion TEXT NOT NULL,
  cantidad TEXT NOT NULL,
  precio_unitario_minor INTEGER NOT NULL CHECK (precio_unitario_minor >= 0),
  precio_con_iva INTEGER NOT NULL CHECK (precio_con_iva IN (0,1)),
  tasa_puntos_base INTEGER NOT NULL DEFAULT 0,
  base_minor INTEGER NOT NULL,
  iva_minor INTEGER NOT NULL,
  total_minor INTEGER NOT NULL,
  orden INTEGER NOT NULL
);

CREATE TABLE proyecto (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo TEXT NOT NULL UNIQUE,
  nombre TEXT NOT NULL,
  contraparte_id INTEGER NOT NULL REFERENCES contraparte(id),
  cotizacion_id INTEGER REFERENCES cotizacion(id),
  estado TEXT NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo','cerrado')),
  responsable TEXT NOT NULL,
  alcance TEXT,
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE venta (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  folio TEXT NOT NULL UNIQUE,
  contraparte_id INTEGER NOT NULL REFERENCES contraparte(id),
  proyecto_id INTEGER REFERENCES proyecto(id),
  fecha_operacion TEXT NOT NULL,
  concepto TEXT NOT NULL,
  tipo_ingreso TEXT NOT NULL DEFAULT 'instalaciones' CHECK (tipo_ingreso IN ('instalaciones','oym')),
  base_minor INTEGER NOT NULL,
  iva_minor INTEGER NOT NULL,
  total_minor INTEGER NOT NULL,
  asiento_id INTEGER NOT NULL REFERENCES asiento(id),
  estado TEXT NOT NULL DEFAULT 'registrada' CHECK (estado IN ('registrada','anulada')),
  clave_idempotencia TEXT UNIQUE,
  responsable TEXT NOT NULL,
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE compra (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  folio TEXT NOT NULL UNIQUE,
  contraparte_id INTEGER NOT NULL REFERENCES contraparte(id),
  proyecto_id INTEGER REFERENCES proyecto(id),
  fecha_operacion TEXT NOT NULL,
  concepto TEXT NOT NULL,
  condicion TEXT NOT NULL DEFAULT 'credito' CHECK (condicion IN ('contado','credito')),
  base_minor INTEGER NOT NULL,
  iva_minor INTEGER NOT NULL,
  total_minor INTEGER NOT NULL,
  asiento_id INTEGER NOT NULL REFERENCES asiento(id),
  estado TEXT NOT NULL DEFAULT 'registrada' CHECK (estado IN ('registrada','anulada')),
  clave_idempotencia TEXT UNIQUE,
  responsable TEXT NOT NULL,
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE compra_linea (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  compra_id INTEGER NOT NULL REFERENCES compra(id),
  descripcion TEXT NOT NULL,
  cuenta_id INTEGER NOT NULL REFERENCES cuenta(id),
  cantidad TEXT NOT NULL,
  precio_unitario_minor INTEGER NOT NULL,
  tasa_puntos_base INTEGER NOT NULL DEFAULT 0,
  tratamiento TEXT NOT NULL DEFAULT 'gravado' CHECK (tratamiento IN ('gravado','exento','no_sujeto')),
  base_minor INTEGER NOT NULL,
  iva_minor INTEGER NOT NULL,
  total_minor INTEGER NOT NULL
);

CREATE TABLE tesoreria_movimiento (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  folio TEXT NOT NULL UNIQUE,
  tipo TEXT NOT NULL CHECK (tipo IN ('cobro','pago','transferencia')),
  fecha_operacion TEXT NOT NULL,
  contraparte_id INTEGER REFERENCES contraparte(id),
  cuenta_origen_id INTEGER NOT NULL REFERENCES cuenta(id),
  cuenta_destino_id INTEGER REFERENCES cuenta(id),
  monto_minor INTEGER NOT NULL CHECK (monto_minor > 0),
  referencia TEXT,
  concepto TEXT NOT NULL,
  asiento_id INTEGER NOT NULL REFERENCES asiento(id),
  estado TEXT NOT NULL DEFAULT 'registrado' CHECK (estado IN ('registrado','anulado')),
  clave_idempotencia TEXT UNIQUE,
  responsable TEXT NOT NULL,
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE aplicacion (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  movimiento_id INTEGER NOT NULL REFERENCES tesoreria_movimiento(id),
  documento_tipo TEXT NOT NULL CHECK (documento_tipo IN ('venta','compra')),
  documento_id INTEGER NOT NULL,
  monto_minor INTEGER NOT NULL CHECK (monto_minor > 0)
);
CREATE INDEX idx_aplicacion_documento ON aplicacion(documento_tipo, documento_id);

INSERT INTO configuracion (clave, valor, fuente, vigencia)
SELECT 'perfil_iva_inscrito', '0', 'Pendiente de inscripción ante el Ministerio de Hacienda', NULL
WHERE NOT EXISTS (SELECT 1 FROM configuracion WHERE clave = 'perfil_iva_inscrito');

INSERT INTO configuracion (clave, valor, fuente, vigencia)
SELECT 'iva_compras_credito_fiscal', '0', 'Política pendiente del contador responsable', NULL
WHERE NOT EXISTS (SELECT 1 FROM configuracion WHERE clave = 'iva_compras_credito_fiscal');
`
  },
  {
    version: 5,
    nombre: 'adaptacion_fiscal',
    sql: `
CREATE TABLE vigencia_fiscal (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  desde TEXT NOT NULL,
  hasta TEXT,
  inscrito_iva INTEGER NOT NULL DEFAULT 0 CHECK (inscrito_iva IN (0,1)),
  descripcion TEXT,
  fuente TEXT,
  responsable TEXT NOT NULL,
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE retencion (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  folio TEXT NOT NULL UNIQUE,
  tipo TEXT NOT NULL CHECK (tipo IN ('efectuada','recibida')),
  contraparte_id INTEGER NOT NULL REFERENCES contraparte(id),
  fecha_operacion TEXT NOT NULL,
  base_minor INTEGER NOT NULL CHECK (base_minor > 0),
  tasa_puntos_base INTEGER NOT NULL CHECK (tasa_puntos_base > 0),
  monto_minor INTEGER NOT NULL CHECK (monto_minor > 0),
  regla TEXT NOT NULL,
  comprobante TEXT,
  concepto TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'registrada' CHECK (estado IN ('registrada','anulada')),
  clave_idempotencia TEXT UNIQUE,
  responsable TEXT NOT NULL,
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE aplicacion_anticipo (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  folio TEXT NOT NULL UNIQUE,
  tipo TEXT NOT NULL CHECK (tipo IN ('cliente','proveedor')),
  contraparte_id INTEGER NOT NULL REFERENCES contraparte(id),
  documento_tipo TEXT NOT NULL CHECK (documento_tipo IN ('venta','compra')),
  documento_id INTEGER NOT NULL,
  fecha_operacion TEXT NOT NULL,
  monto_minor INTEGER NOT NULL CHECK (monto_minor > 0),
  asiento_id INTEGER NOT NULL REFERENCES asiento(id),
  estado TEXT NOT NULL DEFAULT 'registrada' CHECK (estado IN ('registrada','anulada')),
  clave_idempotencia TEXT UNIQUE,
  responsable TEXT NOT NULL,
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);
`
  },
  {
    version: 6,
    nombre: 'iva_credito_por_compra',
    sql: `
ALTER TABLE compra ADD COLUMN iva_credito_minor INTEGER NOT NULL DEFAULT 0;
`
  },
  {
    version: 7,
    nombre: 'iva_credito_backfill',
    sql: `
UPDATE compra SET iva_credito_minor = (
  SELECT COALESCE(SUM(l.debe_minor - l.haber_minor), 0)
  FROM asiento_linea l
  JOIN cuenta c ON c.id = l.cuenta_id
  WHERE l.asiento_id = compra.asiento_id AND c.codigo = '1203'
)
WHERE iva_credito_minor = 0;
`
  },
  {
    version: 8,
    nombre: 'clasificacion_documental',
    sql: `
ALTER TABLE venta ADD COLUMN clasificacion_documento TEXT;
ALTER TABLE venta ADD COLUMN tipo_documento TEXT;
ALTER TABLE compra ADD COLUMN clasificacion_documento TEXT;
ALTER TABLE compra ADD COLUMN tipo_documento TEXT;

INSERT INTO configuracion (clave, valor, fuente, vigencia)
SELECT 'anticipo_hecho_generador', 'pendiente', 'Política pendiente del contador responsable', NULL
WHERE NOT EXISTS (SELECT 1 FROM configuracion WHERE clave = 'anticipo_hecho_generador');
`
  },
  {
    version: 9,
    nombre: 'catalogo_items',
    sql: `
CREATE TABLE item_catalogo (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo TEXT NOT NULL CHECK (tipo IN ('servicio','material')),
  codigo TEXT NOT NULL UNIQUE,
  nombre TEXT NOT NULL,
  unidad TEXT,
  descripcion TEXT,
  precio_venta_minor INTEGER,
  precio_costo_minor INTEGER,
  activo INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0,1)),
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);

ALTER TABLE cotizacion_linea ADD COLUMN item_id INTEGER REFERENCES item_catalogo(id);
ALTER TABLE compra_linea ADD COLUMN item_id INTEGER REFERENCES item_catalogo(id);
`
  },
  {
    version: 10,
    nombre: 'snapshot_documental_y_adjuntos',
    sql: `
ALTER TABLE cotizacion ADD COLUMN cliente_snapshot TEXT;

CREATE TABLE adjunto (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entidad TEXT NOT NULL,
  entidad_id TEXT NOT NULL,
  nombre_original TEXT NOT NULL,
  ruta_relativa TEXT NOT NULL,
  hash_sha256 TEXT NOT NULL,
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO configuracion (clave, valor, fuente, vigencia)
SELECT 'respaldo_retencion_automatica', '5', 'Política operativa editable por el propietario', NULL
WHERE NOT EXISTS (SELECT 1 FROM configuracion WHERE clave = 'respaldo_retencion_automatica');
`
  },
  {
    version: 11,
    nombre: 'snapshot_aprobadas_heredadas',
    sql: `
UPDATE cotizacion
SET cliente_snapshot = (SELECT nombre FROM contraparte WHERE id = cotizacion.contraparte_id)
WHERE estado = 'aprobada' AND cliente_snapshot IS NULL;
`
  },
  {
    version: 12,
    nombre: 'respaldo_periodico',
    sql: `
INSERT INTO configuracion (clave, valor, fuente, vigencia)
SELECT 'respaldo_intervalo_minutos', '0', 'Política operativa editable por el propietario (0 = desactivado)', NULL
WHERE NOT EXISTS (SELECT 1 FROM configuracion WHERE clave = 'respaldo_intervalo_minutos');
`
  },
  {
    version: 13,
    nombre: 'cierre_ejercicio',
    sql: `
CREATE TABLE cierre_ejercicio (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ambito_id TEXT NOT NULL REFERENCES ambito(id),
  anio INTEGER NOT NULL,
  estado TEXT NOT NULL CHECK (estado IN ('cerrado','reabierto')),
  asiento_id INTEGER REFERENCES asiento(id),
  responsable TEXT NOT NULL,
  motivo TEXT NOT NULL,
  creado_en TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (ambito_id, anio)
);
`
  },
  {
    version: 14,
    nombre: 'cierre_ejercicio_backfill',
    sql: `
INSERT INTO cierre_ejercicio (ambito_id, anio, estado, asiento_id, responsable, motivo)
SELECT a.ambito_id,
       CAST(substr(a.fecha_operacion, 1, 4) AS INTEGER),
       'cerrado',
       a.id,
       a.responsable,
       COALESCE(a.motivo, a.concepto)
FROM asiento a
WHERE a.origen_tipo = 'cierre'
  AND a.estado = 'contabilizado'
  AND NOT EXISTS (
    SELECT 1 FROM cierre_ejercicio ce
    WHERE ce.ambito_id = a.ambito_id
      AND ce.anio = CAST(substr(a.fecha_operacion, 1, 4) AS INTEGER)
  );

INSERT INTO cierre_ejercicio (ambito_id, anio, estado, asiento_id, responsable, motivo)
SELECT a.ambito_id,
       CAST(substr(a.fecha_operacion, 1, 4) AS INTEGER),
       'reabierto',
       a.id,
       a.responsable,
       'Cierre anulado antes del bloqueo persistido; reapertura implícita documentada'
FROM asiento a
WHERE a.origen_tipo = 'cierre'
  AND a.estado = 'anulado'
  AND NOT EXISTS (
    SELECT 1 FROM cierre_ejercicio ce
    WHERE ce.ambito_id = a.ambito_id
      AND ce.anio = CAST(substr(a.fecha_operacion, 1, 4) AS INTEGER)
  );
`
  },
  {
    version: 15,
    nombre: 'metadatos_fiscales_documentos',
    sql: `
ALTER TABLE venta ADD COLUMN clase_documento_fiscal TEXT;
ALTER TABLE venta ADD COLUMN numero_resolucion TEXT;
ALTER TABLE venta ADD COLUMN serie_documento TEXT;
ALTER TABLE venta ADD COLUMN numero_documento_autorizado TEXT;
ALTER TABLE venta ADD COLUMN tratamiento_venta TEXT;
ALTER TABLE venta ADD COLUMN tipo_operacion_renta TEXT;
ALTER TABLE venta ADD COLUMN tipo_ingreso_renta TEXT;
ALTER TABLE compra ADD COLUMN clase_documento_fiscal TEXT;
ALTER TABLE compra ADD COLUMN numero_resolucion TEXT;
ALTER TABLE compra ADD COLUMN serie_documento TEXT;
ALTER TABLE compra ADD COLUMN numero_documento_autorizado TEXT;
`
  },
  {
    version: 16,
    nombre: 'metadatos_fiscales_compras_renta',
    sql: `
ALTER TABLE compra ADD COLUMN tipo_operacion_renta TEXT;
ALTER TABLE compra ADD COLUMN clasificacion_renta TEXT;
ALTER TABLE compra ADD COLUMN sector TEXT;
ALTER TABLE compra ADD COLUMN tipo_costo_gasto TEXT;
`
  },
  {
    version: 17,
    nombre: 'metadatos_fiscales_retenciones_f14',
    sql: `
ALTER TABLE retencion ADD COLUMN domiciliado TEXT;
ALTER TABLE retencion ADD COLUMN codigo_pais TEXT;
ALTER TABLE retencion ADD COLUMN nit_nif TEXT;
ALTER TABLE retencion ADD COLUMN dui TEXT;
ALTER TABLE retencion ADD COLUMN codigo_ingreso TEXT;
ALTER TABLE retencion ADD COLUMN tipo_operacion_f14 TEXT;
ALTER TABLE retencion ADD COLUMN clasificacion_f14 TEXT;
ALTER TABLE retencion ADD COLUMN sector_f14 TEXT;
ALTER TABLE retencion ADD COLUMN tipo_costo_gasto_f14 TEXT;
`
  },
  {
    version: 18,
    nombre: 'obligacion_f14_y_nomina',
    sql: `
ALTER TABLE vigencia_fiscal ADD COLUMN obligacion_f14 INTEGER NOT NULL DEFAULT 0;
ALTER TABLE retencion ADD COLUMN involucra_nomina INTEGER;
`
  },
  {
    version: 19,
    nombre: 'persona_natural_retencion_f14',
    sql: `
ALTER TABLE retencion ADD COLUMN persona_natural INTEGER;
`
  },
];
