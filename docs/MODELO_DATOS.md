# MODELO DE DATOS (esquema v1)

Esquema inicial del núcleo contable. Las migraciones son versionadas (`_migracion`) y se aplican en transacción; cada aplicación registra el evento en bitácora.

## Tablas actuales

| Tabla | Contenido y reglas clave |
| --- | --- |
| `ambito` | Ámbitos contables identificables. Inicial: `administrativo` (control previo a la constitución). Un futuro ámbito `juridico` separará las operaciones de la entidad formal sin recalcular historial. |
| `cuenta` | Catálogo propio de ARKON: código único, tipo (activo/pasivo/patrimonio/ingreso/costo/gasto), `es_grupo` (cuentas de agrupación, sin movimiento), jerarquía `padre_id`, `activa`. |
| `periodo` | Períodos mensuales con estado `abierto`/`cerrado`. Se crean por demanda al contabilizar. |
| `asiento` | Folio secuencial por ámbito, fecha de operación y de registro, período, ámbito, concepto, origen (`origen_tipo`/`origen_id`), `clave_idempotencia` UNIQUE, estado, `reverso_de_id`, responsable y motivo. |
| `asiento_linea` | Cuenta, `debe_minor` y `haber_minor` (enteros ≥ 0). CHECKs: un solo lado con importe, importe positivo. |
| `bitacora_evento` | Actor, tipo, entidad, id y detalle JSON de cada evento relevante. |
| `respaldo` | Registro de respaldos: nombre, hash SHA-256, versión de app y de esquema, estado. |
| `configuracion` | Clave/valor/fuente/vigencia para parámetros (ej. tasas legales con su fuente oficial). |
| `contraparte` | Clientes y proveedores (una contraparte puede tener ambos roles), NRC/NIT cuando existan, clasificación tributaria. |

## Reglas de integridad

- Claves foráneas activas; los asientos contabilizados no se borran ni editan: la anulación crea un **reverso** (`reverso_de_id`) en la misma transacción que marca el original `anulado`.
- El folio del original anulado y su PDF archivado se conservan.
- Los saldos nunca se almacenan: se derivan de `asiento_linea` (mayor y auxiliares consumen los mismos datos).
- Aplicaciones de cobros/pagos (tabla `aplicacion`, hito 3) deberán impedir aplicar más que el saldo disponible mediante restricciones y validación transaccional.

## Catálogo base propuesto (sembrado, editable)

Grupos: 1 Activos, 2 Pasivos, 3 Patrimonio, 4 Ingresos, 5 Costos, 6 Gastos. Con auxiliares para caja/bancos, clientes, proveedores, anticipos, inventarios, proyectos en proceso, herramientas y depreciación, IVA débito, retenciones, remuneraciones, participantes, ingresos de instalaciones y O&M, costos de materiales/personal/transporte/subcontratación, y gastos de administración/comercialización/finanzas. Queda pendiente de revisión del contador responsable; los códigos y nombres se ajustarán al sistema contable aprobado.
