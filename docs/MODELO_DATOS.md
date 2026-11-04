# MODELO DE DATOS (esquema v9)

## Migración v9 (`catalogo_items`)

- `item_catalogo`: servicios y materiales con código único, unidad, descripción y precios de venta/costo **opcionales** (sin valores inventados); activo/inactivo, nunca borrado.
- `cotizacion_linea.item_id` y `compra_linea.item_id`: referencia opcional al ítem; cada documento conserva su propia descripción y precios, por lo que editar o desactivar un ítem no modifica documentos históricos.

## Migraciones v6–v8 (resumen)

- **v6/v7**: `compra.iva_credito_minor` fija el IVA acreditable según la política vigente al registrar cada compra; v7 lo rellena para compras anteriores desde su asiento original (cuenta 1203), incluidas anuladas.
- **v8 `clasificacion_documental`**: `venta`/`compra` con `clasificacion_documento` (contribuyente, consumidor final, otro) y `tipo_documento` (factura, crédito fiscal, recibo, otro); política `anticipo_hecho_generador` ('pendiente' por defecto). La exportación interna de trabajo bloquea documentos sin clasificar y no se declara compatible con formato oficial alguno.

## Migración v5 (`adaptacion_fiscal`)

- `vigencia_fiscal`: perfil tributario por vigencia (`desde`, `hasta` opcional, `inscrito_iva`, fuente y responsable). Las vigencias no se solapan; `inscritoIvaEnFecha(fecha)` decide si una operación admite IVA débito según su fecha de operación, sin recalcular historial.
- `retencion`: control de retenciones efectuadas/recibidas con base, tasa, monto, regla, contraparte y comprobante. Sin efecto contable automático hasta política aprobada.
- `aplicacion_anticipo`: aplicación posterior de un anticipo (cliente 2102→1201; proveedor 1202→2101) a un documento pendiente de la misma contraparte, con asiento e idempotencia. El saldo de anticipo por contraparte se deriva de los movimientos (excedentes de cobros/pagos menos aplicaciones), nunca se almacena.

## Migración v4 (`operacion_comercial`)

- `cuenta.es_efectivo` marca las cuentas de efectivo (1101 caja general, 1102 caja chica, 1103 bancos); se añade `1203` IVA crédito fiscal.
- `cotizacion` / `cotizacion_linea`: cotizaciones numeradas (`C-000001`) con revisiones; estado borrador/aprobada/anulada; `congelada` tras la aprobación. Líneas de servicio/material con cantidad y precio exactos, IVA incluido o separado por línea, base/IVA/total calculados.
- `proyecto`: código único, contraparte y cotización aprobada de origen.
- `venta`: reconocimiento de servicio (CxC); folio `V-…`; base/IVA/total, asiento vinculado, idempotencia. El IVA débito solo se admite con `perfil_iva_inscrito = 1`.
- `compra` / `compra_linea`: folio `CMP-…`; líneas con cuenta de costo/gasto/activo y tratamiento gravado/exento/no sujeto; el IVA se preserva y se lleva al costo salvo política `iva_compras_credito_fiscal = 1` (entonces a 1203).
- `tesoreria_movimiento`: cobros (`COB-…`), pagos (`PAG-…`) y transferencias (`TRF-…`) con asiento vinculado e idempotencia.
- `aplicacion`: aplica cobros a ventas y pagos a compras; la validación impide exceder el saldo pendiente (derivado, nunca almacenado); el excedente queda como anticipo (2102 clientes, 1202 proveedores).
- `configuracion`: `perfil_iva_inscrito` y `iva_compras_credito_fiscal` con fuente y vigencia, en '0' por defecto.

Esquema del núcleo contable. Las migraciones son versionadas (`_migracion`) y se aplican en transacción; cada aplicación registra el evento en bitácora. Nunca se edita una migración ya aplicada; los cambios van en una versión nueva.

## Migración v3 (`catalogo_canonico_y_traslado_lineas`)

- **Catálogo canónico de anticipos**: `1202` = «Anticipos a proveedores» (activo, grupo 12); `2102` = «Anticipos recibidos de clientes» (pasivo, grupo 21). Una base v1 migrada (v2→v3) converge exactamente con una instalación nueva: la cuenta que conservaba los movimientos de anticipos de clientes conserva su `id` e historial y recibe el código canónico `2102`, sin reasignar la operación económica. Prueba de doble recorrido en verde.
- **Traslado de líneas**: el trigger de UPDATE de `asiento_linea` verifica tanto el asiento de origen (`OLD.asiento_id`) como el destino (`NEW.asiento_id`); una línea no puede trasladarse a un asiento contabilizado o anulado.

## Migración v2 (`anticipos_y_proteccion_asientos` — historial conservado)

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
