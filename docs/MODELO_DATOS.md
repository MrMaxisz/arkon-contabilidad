# MODELO DE DATOS (esquema v2)

Esquema del núcleo contable. Las migraciones son versionadas (`_migracion`) y se aplican en transacción; cada aplicación registra el evento en bitácora. Nunca se edita una migración ya aplicada; los cambios van en una versión nueva.

## Migración v2 (`anticipos_y_proteccion_asientos`)

- **Reclasificación de anticipos** en bases existentes: `1202` pasa a pasivo («Anticipos recibidos de clientes», bajo el grupo 21) y `2102` a activo («Anticipos a proveedores», bajo el grupo 12). En bases nuevas, la semilla ya crea la clasificación correcta.
- **Protección persistente de asientos contabilizados** mediante triggers:
  - `BEFORE INSERT/UPDATE/DELETE` sobre `asiento_linea`: abortan si el asiento padre no está en `borrador`.
  - `BEFORE UPDATE` sobre `asiento`: aborta cambios de contenido (folio, fechas, período, ámbito, concepto, origen, clave, reverso, responsable) cuando el estado no es `borrador`; solo permite la transición `contabilizado → anulado`.
  - `BEFORE DELETE` sobre `asiento`: aborta borrar asientos no borrador.
- El flujo de contabilización es `borrador → inserción de líneas → contabilizado` dentro de la misma transacción, de modo que la protección no impide el alta inicial.

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

- Claves foráneas activas; los asientos contabilizados no se borran ni editan (reglas más triggers de la migración v2): la anulación crea un **reverso** (`reverso_de_id`) en la misma transacción que marca el original `anulado`. La protección no defiende la base de un administrador del equipo que altere deliberadamente el esquema.
- El folio del original anulado y su PDF archivado se conservan.
- Los saldos nunca se almacenan: se derivan de `asiento_linea` (mayor y auxiliares consumen los mismos datos).
- Aplicaciones de cobros/pagos (tabla `aplicacion`, hito 3) deberán impedir aplicar más que el saldo disponible mediante restricciones y validación transaccional.

## Catálogo base propuesto (sembrado, editable)

Grupos: 1 Activos, 2 Pasivos, 3 Patrimonio, 4 Ingresos, 5 Costos, 6 Gastos. Con auxiliares para caja/bancos, clientes, proveedores, anticipos, inventarios, proyectos en proceso, herramientas y depreciación, IVA débito, retenciones, remuneraciones, participantes, ingresos de instalaciones y O&M, costos de materiales/personal/transporte/subcontratación, y gastos de administración/comercialización/finanzas. Queda pendiente de revisión del contador responsable; los códigos y nombres se ajustarán al sistema contable aprobado.
