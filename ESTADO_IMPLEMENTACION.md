# ESTADO DE IMPLEMENTACIÓN — ARKON Contabilidad

Actualizado: 4 de noviembre de 2026 (tras la segunda revisión del PR #1). Documento de continuidad entre sesiones.

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

1. **Hito 3 — Operación comercial** (siguiente paso inmediato): CRUD de contrapartes, catálogo de servicios/materiales vacío, cotizaciones versionadas con congelamiento de la versión aprobada, proyectos con costos previstos/reales (costo desconocido ≠ cero → rentabilidad provisional), compras y gastos, CxC/CxP con tabla de aplicaciones y saldos no aplicados, caja/bancos con transferencias internas que no generan ingreso/gasto.
2. Respaldo automático previo a migraciones y al trabajar; respaldo de adjuntos coordinado con la instantánea de la base.
3. Hito 4 — motor fiscal por línea con perfil por vigencia, anticipos (reconocimiento financiero vs hecho generador), retenciones, libros de IVA y conciliaciones.
4. Hito 5 — reportes y cierre completo. Hito 6 — exportadores fiscales por versión, manual final e instalador comprobado en Windows sin internet.
5. Verificación en Windows del instalador NSIS y de la ruta `%LOCALAPPDATA%\ARKON Contabilidad` fuera de OneDrive.

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
