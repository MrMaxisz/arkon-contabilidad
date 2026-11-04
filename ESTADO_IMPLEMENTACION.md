# ESTADO DE IMPLEMENTACIÓN — ARKON Contabilidad

Actualizado: 4 de noviembre de 2026 (tras la sexta revisión del PR #1). Documento de continuidad entre sesiones. Las secciones históricas conservan la evidencia de su momento; el estado presente es esta sección y «Qué falta».

## Correcciones de la sexta revisión (sobre el commit 84e142e) — aplicadas y probadas

- **[P2] Tipos y verificación del renderer**: nuevos **contratos compartidos** en `src/shared/contratos.ts` (contrapartes, cuentas, proyectos, cotizaciones, ventas, compras, movimientos de tesorería, respaldos) usados tanto por los servicios como por las vistas, sin declaraciones divergentes ni `any`. Los tres errores TS2339 detectados por la revisión (`esGrupo` en Compras, `condiciones` y `contraparteId` en Cotizaciones) quedan resueltos por contrato compartido, incluida la nulabilidad de `condiciones`.
- Nueva configuración `tsconfig.renderer.json` (DOM + JSX, strict, noUncheckedIndexedAccess) y el script `typecheck` ejecuta **ambas** comprobaciones (proceso principal y renderer); falla si hay errores de tipos en cualquier parte de la aplicación.

Evidencia (Linux): `npm run typecheck` sin errores en ambas configuraciones; `npm test` → **55/55 en verde** (8 archivos); `npm run build` OK. La suite pasó también en Windows según la sexta revisión (55/55).

## Correcciones de la quinta revisión (sobre el commit e093124) — aplicadas y probadas

- **[P2] Edición de cotizaciones**: al editar se cargan condiciones, cliente y fecha del documento; cliente y fecha se deshabilitan durante la edición (el servicio no los actualiza); «Guardar» se bloquea mientras carga. El servicio conserva las condiciones cuando el campo no se envía y solo las reemplaza cuando se envían explícitamente. Prueba de conservación y reemplazo explícito en verde.
- **[P2] Filtro por identificador**: `listarVentas` y `listarCompras` devuelven `contraparteId`; la vista Cobros y pagos filtra por identificador, no por nombre (homónimos ya no ven documentos ajenos). Prueba con dos contrapartes homónimas en verde. La validación de propiedad sigue en el servicio.
- **[P2] Ciclo de vida de pruebas**: la preparación cierra su conexión y las suites de hito 3 y revisiones registran las conexiones abiertas con cierre garantizado en `afterEach` aunque una aserción falle, para que la limpieza de archivos funcione también en Windows. Pendiente: volver a ejecutar la suite completa en Windows y actualizar la evidencia por entorno.

Evidencia (Linux): `npm test` → **55/55 pruebas en verde** (8 archivos); `tsc --noEmit` sin errores; `npm run build` OK.

## Correcciones de la cuarta revisión (sobre el commit bcaf54f) — aplicadas y probadas

- **[P1] Cobros y pagos cruzados**: `validarAplicaciones` verifica en el servicio que cada documento pertenezca a la contraparte del movimiento, esté en estado registrada y sea del tipo correcto; la interfaz filtra los documentos por contraparte y limpia las aplicaciones al cambiarla. Pruebas de cobro y pago cruzado rechazados sin movimiento, aplicación ni asiento.
- **[P1] Aplicaciones acumuladas por documento**: las aplicaciones se agrupan por documento, se suman y se validan contra el saldo pendiente dentro de la petición; el exceso se rechaza (nunca deuda negativa). Prueba con aplicaciones duplicadas que exceden la deuda (rollback completo) y acumulación válida.
- **[P1] Anulación aislada de asientos comerciales**: `anularAsiento` rechaza asientos con origen venta/compra/cobro/pago/transferencia salvo llamada interna autorizada (`rutaAutorizada`); los servicios de documento y movimiento anulan documento, aplicaciones y asiento de forma atómica. Pruebas: anulación manual rechazada; la ruta del documento conserva conciliación; venta con cobros no evade el bloqueo.
- **[P1] Captura de ventas desde la interfaz**: nueva vista «Ventas» (registro de venta reconocida con cliente, proyecto, tipo de ingreso, base y tasa; listado con saldo y anulación por la ruta autorizada). La cotización aprobada sigue sin convertirse automáticamente en ingreso.
- **[P2] Redondeo compartido**: `multiplicarLinea` (half-up) sustituye la división truncada en cotizaciones y compras. Pruebas de residuo por debajo, en y sobre el punto medio, con conservación del total.
- **[P2] Edición de revisiones**: `actualizarCotizacionBorrador` + comando `cotizacion:guardar` + flujo «Editar» en la vista; solo borradores; la versión previa conserva su contenido exacto. Prueba completa de editar-revisar-aprobar.
- **Detalles**: `listarProyectos` mapea a camelCase (`contraparteNombre`); la vista Compras envía `proyectoId` con selector de proyectos.

Evidencia: `npm test` → **53/53 pruebas en verde** (7 archivos); `tsc --noEmit` sin errores; `npm run build` OK. El hito comercial no se declara completo hasta los recorridos gráficos en Windows.

## Hito 3 — Operación comercial (implementado; evidencia histórica de su entrega inicial)

- **Migración v4 `operacion_comercial`**: cotizaciones y líneas, proyectos, ventas, compras y líneas, movimientos de tesorería, tabla de aplicaciones, cuentas marcadas `es_efectivo` (1101/1102/1103), cuenta `1203` IVA crédito fiscal y parámetros `perfil_iva_inscrito`/`iva_compras_credito_fiscal` (ambos en '0': sin inscripción no se registra IVA débito; el IVA de compras va al costo/gasto, no a crédito fiscal automático).
- **Cotizaciones versionadas** (`servicios/cotizaciones.ts`): líneas de servicio/material con IVA incluido o separado por línea; revisiones numeradas; la aprobación congela la versión; no generan asientos ni obligaciones por sí solas.
- **Proyectos** vinculables solo a cotizaciones aprobadas.
- **Ventas reconocidas** (`servicios/operacion.ts`): CxC + ingreso (instalaciones/O&M); con IVA se rechaza si no hay inscripción vigente (regla del plan: sin débitos fiscales ficticios en el régimen administrativo).
- **Compras** con líneas por cuenta de costo/gasto/activo y tratamiento gravado/exento/no sujeto; el IVA documentado se conserva y se lleva al costo por defecto, a crédito fiscal solo con la política activada. Pagar después no duplica el gasto.
- **Tesorería** (`servicios/tesoreria.ts`): cobros y pagos con tabla de aplicaciones que no pueden exceder el saldo pendiente; el excedente queda como anticipo (clientes → 2102, proveedores → 1202); transferencias internas sin ingreso/gasto; anulación de movimientos por reverso.
- **Anulación de documentos** bloqueada si tienen aplicaciones; sin ellas, reverso trazable.
- **Interfaz**: menú lateral completo (clientes y proveedores, cotizaciones, proyectos, compras y gastos, cobros y pagos, caja y bancos) con idempotencia por operación y estados vacíos reales.
- **Prueba de aceptación del hito**: flujo completo (contraparte → cotización → revisión → aprobación → proyecto → venta → compra → cobro con excedente → pago parcial → transferencia) se cierra, **reabre la base** y reconcilia saldos con el mayor; ecuación patrimonial cuadra.
- Corregido durante el hito: la semilla del catálogo ahora es idempotente (la migración v4 crea la 1203 antes que la semilla; antes la semilla se saltaba por el contador de cuentas).

Evidencia: `npm test` → 42/42 pruebas en verde (6 archivos); `tsc --noEmit` sin errores; `npm run build` OK.

## Correcciones de la segunda revisión (sobre el commit 62b9cbd) — aplicadas y probadas

- **[P1] Divergencia de catálogos**: migración v3 `catalogo_canonico_y_traslado_lineas` con catálogo canónico (1202 = anticipos a proveedores, activo; 2102 = anticipos recibidos de clientes, pasivo). La base v1 migrada converge con la instalación nueva conservando el `id` de cada cuenta y su historial de movimientos (la cuenta que llevaba anticipos de clientes recibe el código 2102 sin reasignar la operación económica). Prueba que reproduce ambos recorridos y compara identidad, clasificación y saldos.
- **[P1] Traslado de líneas por UPDATE**: el trigger v3 de UPDATE de `asiento_linea` verifica asiento de origen y destino; mover una línea hacia un asiento contabilizado se rechaza sin alterar saldos. Prueba en verde con verificación de cuadre.
- **[P2] Conexión abandonada en restauración rechazada**: el ciclo de vida se centralizó en `servicios/restauracion.ts`; `manejarRestauracion` solo reabre la base si la conexión fue cerrada (verificación `db.open`), y `reabrirBase` cierra la conexión previa si sigue abierta. Pruebas: archivo inexistente, hash alterado (rechazos previos al cierre conservan la misma conexión abierta) y restauración exitosa seguida de otra restauración (una única conexión activa y utilizable).
- **[P2] Catálogo de respaldos dependiente de la base activa**: `respaldo:listar` ahora descubre las copias y manifiestos del directorio (`descubrirRespaldos`), independiente de la tabla `respaldo` de la instantánea. Tras restaurar, la copia restaurada sigue visible; una copia externa válida colocada en la carpeta se descubre y restaura desde una base limpia. Pruebas en verde.
- **Fecha local**: `fechaLocalElSalvador` usa UTC-6 explícito (El Salvador no tiene horario de verano), independiente de la zona del equipo. Prueba con límite de medianoche en verde.
- **Bug adicional detectado por las pruebas**: `saldosCrudos` sumaba líneas de asientos en borrador al balance (LEFT JOIN sin filtro efectivo); corregido con `CASE` sobre el estado. El balance solo considera asientos contabilizados y anulados.

Evidencia: `npm test` → 34/34 pruebas en verde (5 archivos); `tsc --noEmit` sin errores; `npm run build` OK.

## Correcciones de la primera revisión del PR #1 (sobre el commit e504d45) — aplicadas y probadas

- **[P1] Anticipos reclasificados**: «Anticipos recibidos de clientes» ahora es pasivo (grupo 21) y «Anticipos a proveedores» activo (grupo 12). La migración v2 corrige bases existentes; la semilla crea la clasificación correcta en bases nuevas. Prueba de presentación del balance para ambos tipos de anticipo en verde.
- **[P1] Idempotencia en captura manual**: la interfaz asigna una clave de idempotencia por operación (estable entre reintentos, renovada al iniciar operación nueva), bloquea el envío mientras procesa y la capa de comandos IPC exige la clave para contabilizar.
- **[P1] Importes uniformes**: `listarAsientos` entrega texto monetario (`minorATexto`), igual que el mayor; el listado ya no muestra centavos como dólares. Prueba de contrato en verde.
- **[P1] Anulación funcional en Electron**: eliminado `window.prompt` (no disponible en Electron); diálogo propio con motivo y responsable obligatorios y confirmación.
- **[P2] Protección persistente**: triggers de la migración v2 impiden insertar/editar/borrar líneas y cambiar contenido o borrar asientos contabilizados; solo permiten la transición `contabilizado → anulado` del flujo autorizado. El flujo interno pasó a `borrador → líneas → contabilizado` en una transacción. Pruebas en verde para cambios ilegales y para el flujo autorizado.
- **[P2] Fechas de calendario**: validación real de año/mes/día (bisiestos incluidos) y pertenencia al período derivado, sin normalización silenciosa. La fecha predeterminada de la interfaz usa la fecha local de El Salvador (no UTC).
- **[P2] Contrato de respaldos**: `listarRespaldos` mapea a camelCase (`creadoEn`, `versionEsquema`); el listado conserva fecha, hash y versiones tras reiniciar.
- **[P2] Bitácora de restauración**: el evento `restauracion_completada` se registra en la base restaurada tras reabrirla (antes se perdía con la base sustituida); los errores posteriores al cierre reabren la base activa.
- **Adicional (pendiente de alcance señalado)**: la vista Respaldo permite restaurar una copia desde la propia aplicación (confirmación, verificación de hash e integridad), sin comandos manuales.
- **Prueba de atomicidad reforzada**: fallo inducido por trigger después de insertar la cabecera demuestra rollback efectivo de asiento y líneas.

Evidencia de la primera ronda: 27/27 pruebas en verde en su momento. Los recorridos en el ejecutable Windows (captura, doble envío, anulación, respaldo, restauración sin internet) siguen pendientes; la integridad del núcleo no se declara terminada hasta esa verificación.

## Qué funciona (verificado)

- **Proyecto aislado** `arkon-contabilidad` (Electron 33 + TypeScript + React 18 + SQLite local better-sqlite3 12). Versiones fijadas en `package-lock.json`.
- **Dinero exacto** (`src/shared/dinero.ts`): enteros BigInt en unidades mínimas; parseo/serialización decimal exacta; redondeo half-up determinista; desglose IVA incluido (`base = total/(1+tasa)`, `iva = total − base`, el total nunca aumenta) e IVA separado aplicado una sola vez.
- **Esquema v2 + migraciones versionadas** en transacción, con registro en bitácora (`src/main/db/migraciones.ts`).
- **Motor contable** (`src/main/servicios/motorAsientos.ts`):
  - Asientos cuadrados, atómicos; líneas con importe positivo en un solo lado; solo cuentas de movimiento vigentes.
  - Idempotencia por `clave_idempotencia` UNIQUE (doble clic/reintento → mismo asiento).
  - Períodos mensuales con cierre/reapertura (motivo + bitácora); contabilización bloqueada en período cerrado.
  - Anulación solo por reverso trazable (`reverso_de_id`), conservando folio y estado `anulado`; reverso no se anula dos veces.
  - Mayor por cuenta con saldo corrido; original anulado + reverso cancelan el efecto.
- **Estados financieros** (`estadosFinancieros.ts`): saldos derivados del mayor; balance con ecuación patrimonial (verificador `cuadra`); resultado = ingresos − costos − gastos. Sin saldos almacenados.
- **Respaldo/restauración** (`respaldo.ts`): API `backup` de SQLite, verificación `integrity_check`, hash SHA-256, manifiesto `.manifest.json`, restauración a área temporal con verificación, copia previa `.antes-restauracion`, bloqueo de esquemas futuros.
- **Bitácora** de contabilizaciones, anulaciones, cierres/reaperturas, respaldos, migraciones.
- **Seguridad Electron**: contextIsolation + sandbox, sin nodeIntegration, CSP restrictiva, preload con lista de comandos permitidos, IPC con verificación de remitente y validación de payloads; SQL parametrizado; instancia única.
- **Interfaz mínima funcional** (español, identidad ARKON con Barlow Condensed + IBM Plex Sans empaquetadas localmente): Inicio (balance), Contabilidad (asientos, mayor, anulación), Respaldo, Bitácora. Estados vacíos reales, sin datos precargados. Catálogo base **propuesto** sembrado como estructura editable (sin cifras).
- **Pruebas**: 27 pruebas Vitest en verde — dinero exacto y desgloses IVA (incluido/separado/redondeo), cuadre, rechazos (descuadre, dos lados, importe cero, cuenta grupo/inexistente), idempotencia, atomicidad con fallo inducido tras la cabecera (rollback efectivo), período cerrado/reapertura, reverso y cancelación de efecto, ecuación patrimonial, clasificación de anticipos, protección por triggers, fechas de calendario, contrato de importes del listado, respaldo (hash, manifiesto, contrato camelCase, restauración en entorno limpio, rechazo de hash alterado, evento de restauración en la bitácora activa).
- **Empaquetado**: `electron-builder --dir` verificado en Linux con módulo nativo better-sqlite3 (`asarUnpack`), Electron 33.4.11 descargado y empaquetado.

## Qué comprobé y cómo

- `npx tsc --noEmit -p tsconfig.node.json` → sin errores.
- `npx vitest run` → 27/27 pruebas en verde.
- `npm run build` (main + renderer con fuentes locales) → OK.
- `npx electron-builder --dir --linux` → paquete generado con app.asar; el binario no se pudo ejecutar en el sandbox por falta de bibliotecas gráficas del contenedor (documentado como pendiente en Windows).

## Qué falta (siguiente paso)

1. **Hito 4 — Adaptación salvadoreña** (siguiente paso inmediato): motor fiscal por línea con perfil por vigencia, anticipos (reconocimiento financiero vs hecho generador), retenciones, libros de IVA y conciliaciones, manteniendo separados el régimen administrativo actual, los cálculos de planificación y los futuros registros fiscales.
2. Flujo para aplicar posteriormente un anticipo ya recibido o entregado sin registrar dinero nuevamente.
3. Módulo propio de catálogo de servicios y materiales (hoy las líneas se capturan como texto libre, con precios y rendimientos iniciales vacíos).
4. Respaldo automático previo a migraciones y al trabajar; respaldo de adjuntos coordinado con la instantánea de la base.
5. Hito 5 — reportes y cierre completo. Hito 6 — exportadores fiscales por versión, manual final e instalador comprobado en Windows sin internet.
6. Verificación en Windows del instalador NSIS, de los recorridos gráficos (captura, doble envío, anulación, varias copias de respaldo, selección, restauración y actualización) y de la ruta `%LOCALAPPDATA%\ARKON Contabilidad` fuera de OneDrive.

## Decisiones tomadas

- Ámbito contable único inicial `administrativo`, identificado en cada asiento; la entidad jurídica futura será otro ámbito sin recalcular historial.
- Folio de asiento secuencial por ámbito (`A-000001`).
- El IVA incluido deriva `iva = total − base` (reconcilia exactamente con el total); el IVA separado se calcula con redondeo half-up sobre la base.
- Catálogo base sembrado solo como estructura (grupos y cuentas de movimiento), editable, pendiente del contador; ninguna cifra del negocio se usó.
- La restauración requiere manifiesto o registro previo con hash coincidente; copia del estado anterior siempre preservada.

## Cómo continuar en otra sesión

- Arrancar por este archivo y `docs/PENDIENTES.md`; el plan maestro es `PLAN_SISTEMA_CONTABLE_ARKON_PARA_VIBE.md` (proporcionado por el propietario).
- Todo cambio de esquema va en `src/main/db/migraciones.ts` como nueva versión; nunca editar una migración ya aplicada.
- Pruebas siempre con datos sintéticos en base temporal (`pruebas/utilidades.ts`), nunca en la base operativa.
