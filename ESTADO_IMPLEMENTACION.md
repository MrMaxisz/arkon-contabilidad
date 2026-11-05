# ESTADO DE IMPLEMENTACIÓN — ARKON Contabilidad

Actualizado: 4 de noviembre de 2026 (auditoría 30 de Codex; ajustes con motor completo). Documento de continuidad entre sesiones. Las secciones históricas conservan la evidencia de su momento; el estado presente es esta sección y el inventario de `docs/PENDIENTES.md`.

## Auditoría 30 (Codex) — ajustes usan el motor contable completo — aplicado y probado

- **[P1] registrarAjuste delega en contabilizarAsiento**: calendario validado (rechaza 2027-02-30), pertenencia al período, período abierto (rechaza en cerrado), ámbito activo, cuentas válidas, cuadre, responsable — todas las garantías del motor central. La referencia de soporte es obligatoria. Patrón: idempotencia → validación de cuentas → contabilizarAsiento (borrador→líneas→contabilizado) → motivo con referencia → bitácora.
- Los comandos `ajuste:registrar` en despachar ahora exigen `referencia` con `texto(p, 'referencia')`.

Pendientes identificados para el próximo incremento (bloque 3 continúa):
- `auxiliarContraparteDetalle`: filtrar también aplicaciones/anticipos por fecha de corte (no solo documentos).
- `exportarCsvAuxiliar`: escapar comillas/comas/saltos en CSV con utilidad común.
- Vista JSX de ajustes, exportación por diálogo nativo, cierre mensual/anual completo.
- Estado periódico: refrescar tras guardado, mostrar fallo reciente, selector de documento en adjuntos.

Evidencia por nivel (Linux): **Servicios y contrato IPC**: `npm test` → **154/154 en verde** (32 archivos). **Tipos**: ambas comprobaciones sin errores. **Compilación**: `tsc` + `vite build` correctos. **Ejecutable**: recorrido gráfico Windows **pendiente**.

## Auditoría 29 (Codex) — coordinador único + bloque 3 avanzado — aplicado y probado

- **[P2] Coordinador único**: `adquirirOperacionRespaldo/liberarOperacionRespaldo` en respaldo.ts, compartido por manual, automática y `manejarRestauracion` (que lo adquiere al inicio en try/finally). Regresiones: manual en curso bloquea automática y restauración; automática en curso bloquea manual.
- **Auxiliares con detalle por documento**: `auxiliarContraparteDetalle` con corte temporal (`hastaFecha`), saldos por documento (total/aplicado/saldo) incluyendo anticipos; `exportarCsvAuxiliar` para cliente/proveedor/efectivo desde el mismo modelo. Pruebas: corte temporal excluye documentos posteriores, saldos correctos con aplicaciones.
- **Ajustes**: `registrarAjuste` con folio AJ-000001, idempotencia por clave, validación de cuadre y cuentas, referencia de soporte, patrón borrador→líneas→contabilizado (compatible con triggers). Pruebas: idempotencia, descuadrado rechazado, persistencia tras reabrir desde despachar.
- **Comandos**: `auxiliar:contraparteDetalle`, `auxiliar:exportarCsv`, `ajuste:registrar` en despachar y preload.

Evidencia por nivel (Linux): **Servicios y contrato IPC**: `npm test` → **154/154 en verde** (32 archivos). **Tipos**: ambas comprobaciones sin errores. **Compilación**: `tsc` + `vite build` correctos. **Ejecutable**: recorrido gráfico Windows **pendiente**.

Pendiente del bloque 3: vista de ajustes en la interfaz, exportación de reportes a archivo desde la vista, cierre mensual/anual con tratamiento de cuentas de resultados y continuidad.

## Auditoría 28 (Codex) — integridad Windows + auxiliares completos — aplicado y probado

Correcciones:
- **[P1] EBUSY Windows**: `dbTemporal` se cierra ANTES de `renameSync` en `respaldoPeriodicoSiCorresponde` (restauracion.ts); `crearRespaldo` manual también cierra antes de renombrar. Los lectores readonly se cierran antes de publicar/depurar.
- **[P1] crearRespaldo manual usa instantánea**: `crearRespaldo` abre la base temporal tras el backup para derivar inventario y versión; mutex `operacionRespaldoEnCurso` compartido impide copias/restauraciones simultáneas. Regresión de intercalación corregida: señal explíta de instantánea producida, operación concurrente ejecutada y afirmada, manifiesto refleja la instantánea.
- **[P1] auxiliarEfectivo filtra borradores**: la suma usa `CASE WHEN a.estado IN ('contabilizado','anulado')` en lugar de LEFT JOIN con filtro en el JOIN (que no excluía líneas de borradores). Regresión: borrador → 0.00; contabilizado → 1.23; reverso → 1.23; concilia en cada paso.
- **[P2] Preload añade auxiliares**: `auxiliar:contrapartes` y `auxiliar:efectivo` en `COMANDOS_PERMITIDOS`; Reportes captura errores y muestra mensajes en lugar de estados vacíos ante rechazo.

Evidencia por nivel (Linux): **Servicios y contrato IPC**: `npm test` → **148/148 en verde** (31 archivos). **Tipos**: ambas comprobaciones sin errores. **Compilación**: `tsc` + `vite build` correctos. **Ejecutable**: recorrido gráfico Windows **pendiente**.

## Auditoría 27 (Codex) — lote de recuperación + bloque 3 (auxiliares) — aplicado y probado

Correcciones del lote de recuperación:
- **[P1] Inventario de la instantánea real**: `respaldoPeriodicoSiCorresponde` abre la base temporal tras el backup y deriva el inventario de adjuntos y la versión de esquema de esa copia (no de la activa); mutex `operacionEnCurso` impide copias/restauraciones simultáneas. Regresión: intercalación determinista (adjunto registrado durante el backup) → el paquete refleja la instantánea y se restaura correctamente en otro perfil.
- **[P2] Vínculo documental validado**: `validarVinculoDocumento` en la ruta real (canal IPC `arkon:registrarAdjunto`) rechaza entidades no reconocidas y documentos inexistentes; el servicio mantiene su API para pruebas. Regresiones: documento inexistente rechazado, entidad inventada rechazada, documento existente aceptado.
- **[P2] Estado periódico visible**: comando `respaldo:estadoPeriodico` devuelve intervalo, último respaldo, último fallo y próxima ejecución; la vista Respaldo consulta y muestra el estado real. Regresión: estado consultable desde despachar con y sin respaldos automáticos.

Bloque 3 — Auxiliares de clientes, proveedores y caja/bancos (inicio):
- `auxiliarContrapartes`: saldos por cliente/proveedor derivados de documentos registrados menos aplicaciones de cobros/pagos y aplicaciones de anticipos; conciliación con el mayor (1201 y 2101). Vista Reportes con tablas y indicador de conciliación.
- `auxiliarEfectivo`: saldos por cuenta de efectivo con conciliación al mayor. Vista Reportes.
- Pruebas sintéticas: auxiliares concilian tras ventas+compras+cobros+pagos; efectivo concilia tras cobros y transferencias; persistencia tras cerrar/reabrir; reversos (anulación de venta) mantienen conciliación.

Evidencia por nivel (Linux): **Servicios y contrato IPC**: `npm test` → **147/147 en verde** (31 archivos). **Tipos**: ambas comprobaciones sin errores. **Compilación**: `tsc` + `vite build` correctos. **Ejecutable**: recorrido gráfico Windows **pendiente**.

## Auditoría 26 (Codex) — integración completa de adjuntos y respaldo periódico — aplicado y probado

Correcciones de los dos P2 de integración:
- **[P2-1] Adjuntos accesibles desde la aplicación**: manejador `adjunto:listar` en `comandos.ts` con filtro por entidad/identificador; panel JSX completo en la vista Respaldo (formulario de registro con entidad/folio/responsable, tabla de adjuntos con hash y fecha, llamada al puente `registrarAdjunto`). Pruebas de componente real: renderiza el panel con datos, registra adjunto a través del puente, guarda configuración periódica. Prueba de despachar real: `adjunto:listar` devuelve adjuntos persistidos, la asociación sobrevive reabrir la base.
- **[P2-2] Respaldo periódico funcional**: temporizador `setInterval` de 60 segundos en `index.ts` que evalúa `respaldoPeriodicoSeguro` mientras la sesión está abierta (no solo al arrancar); fallos registrados en bitácora sin dejar la app sin ventana. Configuración desde interfaz (vista Respaldo) con validación (intervalo 0-1440, retención 1-50), persistencia en `configuracion` y bitácora del cambio. Comandos `config:respaldoPeriodicoLeer/Guardar` y `respaldo:ejecutarPeriodico` en despachar. Exclusión mutua: `respaldoPeriodicoSiCorresponde` se omite si existe marcador de restauración o `.sin-resolver`. Prueba de despachar real: configura intervalo, ejecuta periódico, verifica que respeta el intervalo, restaura el paquete automático en otro perfil sintético con adjunto verificado.

Evidencia por nivel (Linux): **Servicios y contrato IPC**: `npm test` → **141/141 en verde** (29 archivos; 3 pruebas de componente real + 3 de despachar real). **Tipos**: ambas comprobaciones sin errores. **Compilación**: `tsc` + `vite build` correctos. **Ejecutable**: recorrido gráfico Windows **pendiente** — incluye diálogos nativos y temporizador real.

## Auditoría 25 (Codex) — lote de recuperación completo — aplicado y probado

Correcciones de los dos P1:
- **[P1] Verificador sin efectos secundarios**: `baseLegible` abre con `readonly: true, fileMustExist: true` (no crea la base si falta), verifica `integrity_check` y esquema conocido (`_migracion` con versión ≥ 1 y ≤ actual). Una base ausente, vacía o de esquema desconocido **no** se considera conjunto válido durante una recuperación pendiente; se elige un conjunto válido antes de limpiar copias. Regresión: interrupción tras sustituir SQLite + base activa retirada → arranque restaura el conjunto anterior verificado (base + adjuntos con contenido correcto).
- **[P1] Arranque bloqueado sin conjunto válido**: `resolverRestauracionInterrumpida` lanza `ErrorRecuperacionPendiente` cuando ninguna combinación es verificable; `crearContextoBase` la propaga (no devuelve contexto escribible); `index.ts` muestra diálogo de error nativo y cierra la aplicación. El archivo `.sin-resolver` persiste y bloquea arranques posteriores hasta resolverse. Regresión: adjuntos temporal y anterior alterados → arranque rechazado con `ErrorRecuperacionPendiente`, copias preservadas, `.sin-resolver` presente.

Interfaz de adjuntos (mismo lote):
- Comando `adjunto:listar` y canal nativo `arkon:registrarAdjunto` con diálogo de selección de archivo; panel de adjuntos en la vista Respaldo (registro con entidad/folio/responsable, listado con hash y fecha).

Respaldo periódico mientras se trabaja (mismo lote):
- `respaldoPeriodicoSiCorresponde` (migración v12: `respaldo_intervalo_minutos`, 0 = desactivado por defecto): crea respaldo automático con hash, adjuntos y manifiesto; respeta el intervalo; se omite durante restauración pendiente o en curso; aplica retención de paquetes automáticos. Invocado al arrancar desde `index.ts`. Regresión: desactivado por defecto, activo con intervalo, respeta intervalo, omitido durante restauración.

Evidencia por nivel (Linux): **Servicios y contrato IPC**: `npm test` → **135/135 en verde** (27 archivos, con interrupciones en procesos hijos reales, base ausente, adjuntos alterados y respaldo periódico). **Tipos**: ambas comprobaciones sin errores. **Compilación**: `tsc` + `vite build` correctos. **Ejecutable**: recorrido gráfico Windows **pendiente** — incluye diálogos nativos de adjuntos y PDF.

## Correcciones de la vigésima cuarta revisión — aplicadas y probadas

- **[P1] Marcador atrasado resuelto por contenido**: el marcador se escribe con fase 'sustituyendo-base' **antes** de ejecutar `restaurarRespaldo` (la intención precede al cambio de estado). Al arrancar, `resolverRestauracionInterrumpida` **no confía en la fase**: verifica el conjunto activo por contenido (inventario de la base + existencia y **hash** de cada archivo); si es coherente lo confirma; si no, prueba el área temporal; si tampoco, revierte desde las copias previas verificadas; si nada es verificable, **preserva todas las copias** y escribe un archivo `.sin-resolver` identificándolas. Regresión: interrupción inmediatamente tras sustituir SQLite (marcador en fase anterior) → el arranque resuelve por contenido y completa el conjunto nuevo verificado.
- **[P1] Hashes verificados al reiniciar**: `conjuntoCoherente` compara el hash SHA-256 de cada archivo contra el registro de la base (no solo existencia); un adjunto temporal alterado hace que el conjunto se rechace y se revierta al conjunto anterior verificado, sin eliminar copias prematuramente. Regresión: adjunto temporal alterado tras la interrupción → arranque revierte a base y adjuntos anteriores con contenido verificado.
- **[P2] Prueba portátil**: las rutas del proceso hijo se serializan con `JSON.stringify` (válido en Windows); la prueba compila `dist` antes de ejecutar el hijo.

Evidencia por nivel (Linux): **Servicios y contrato IPC**: `npm test` → **132/132 en verde** (26 archivos, con interrupciones en procesos hijos reales en dos ventanas distintas y adjunto alterado al reiniciar). **Tipos**: ambas comprobaciones sin errores. **Compilación**: `tsc` + `vite build` correctos. **Ejecutable**: recorrido gráfico Windows **pendiente**.

## Correcciones de la vigésima tercera revisión — aplicadas y probadas

- **[P1] Restauración interrumpida detectada al arrancar**: `manejarRestauracion` escribe un marcador persistente (`restauracion-en-curso.json`) con la fase de la operación antes de activar componentes; `crearContextoBase` lo detecta al arrancar y resuelve la restauración interrumpida eligiendo un conjunto completo y verificado (fase 'iniciada' → limpia temporales sin tocar el estado; fase 'base-activada' → completa la activación de adjuntos, contrasta el inventario de la base con los archivos y, si falta alguno, revierte base y adjuntos desde las copias previas). Las copias previas solo se eliminan tras confirmar la coherencia. Regresión: interrupción de un proceso hijo real (exit 86) entre la activación de base y la de adjuntos → el arranque posterior completa la restauración coherente (base del respaldo + adjunto nuevo verificado, marcador eliminado).
- **[P1] Inventario validado registro por registro**: `manejarRestauracion` abre la base del respaldo y contrasta cada registro de `adjunto` (ruta y hash) con el manifiesto **antes de sustituir el estado activo**; rechaza omisiones, duplicados e identidades discordantes aunque los totales coincidan; `validarRutasRelativas` impide rutas fuera del paquete (`..`, absolutas). Regresión: manifiesto con misma cantidad pero ruta distinta → restauración rechazada conservando el estado activo.

Evidencia por nivel (Linux): **Servicios y contrato IPC**: `npm test` → **130/130 en verde** (26 archivos, incluida la interrupción en proceso hijo real). **Tipos**: ambas comprobaciones sin errores. **Compilación**: `tsc` + `vite build` correctos. **Ejecutable**: recorrido gráfico Windows **pendiente**.

## Correcciones de la vigésima segunda revisión — aplicadas y probadas

- **[P1] Recuperación coordinada ante fallos**: `manejarRestauracion` protege toda la sustitución con secuencia de recuperación: conserva la copia previa de base y adjuntos hasta abrir y validar el conjunto nuevo (inventario de adjuntos contrastado); ante fallo de cualquier paso restaura base y adjuntos anteriores y deja conexión utilizable; si la compensación falla, lo informa identificando las copias preservadas. Regresión: fallo inducido al activar adjuntos → base y adjuntos anteriores restaurados, conexión abierta, sin éxito parcial.
- **[P1] Inventario de adjuntos desde la base**: `copiarAdjuntosRespaldo` enumera desde la tabla `adjunto` de la instantánea SQLite (no desde la carpeta); verifica existencia y hash documentado de cada registro y **rechaza** faltantes o alterados con mensajes que identifican el registro. Política explícita para esquemas sin tabla de adjuntos (inventario vacío). Regresiones: archivo registrado ausente y archivo alterado al crear copia → respaldo rechazado sin paquete; esquema sin tabla → inventario vacío.
- **[P2] Editor conserva itemId**: el mapeo de `editar` copia `itemId` al estado de cada línea (además del tipo corregido antes).
- **[P2] Prueba de recuperación cierra conexiones**: la prueba de la copia previa cierra la conexión anterior antes de crear el contexto de restauración (compatible con Windows) y el cierre de todos los contextos queda garantizado.

Evidencia por nivel (Linux): **Servicios y contrato IPC**: `npm test` → **128/128 en verde** (25 archivos). **Tipos**: ambas comprobaciones sin errores. **Compilación**: `tsc` + `vite build` correctos. **Ejecutable**: recorrido gráfico Windows **pendiente**.

## Correcciones de la vigésima primera revisión — aplicadas y probadas (desde los flujos reales)

- **[P1] Copia previa a migración con contrato completo**: manifiesto con `hashSha256`, verificación de integridad antes de renombrar, adjuntos incluidos en el paquete, versión de esquema de la copia anterior (no la destino). Regresión: base v9 con datos → copia previa → **se descubre por `descubrirRespaldos` y se restaura por `manejarRestauracion`** recuperando los datos.
- **[P1] Respaldo/restauración coordinan adjuntos**: `respaldo:crear` pasa la carpeta de adjuntos (regresión desde el comando real: manifiesto con 1 adjunto); `manejarRestauracion` valida y copia los adjuntos a un área temporal **antes** de sustituir la base, preserva copia previa de adjuntos y rechaza paquetes alterados sin modificar base ni adjuntos activos. Regresiones: recuperación completa en perfil limpio (base + adjunto + contenido verificado) y paquete alterado rechazado íntegro.
- **[P2] Editor conserva itemId**: el tipo de `lineasGuardadas` en `editar` declara `itemId` y el mapeo lo transporta (ya se corrigió el mapeo en la entrega anterior; el tipo faltante se completa).
- **[P2] Aprobadas heredadas** (migración v11): las cotizaciones aprobadas antes de v10 reciben `cliente_snapshot` fijado con la mejor evidencia disponible al migrar (nombre vigente del cliente en ese momento); posteriores ediciones del maestro ya no cambian su documento. Limitación documentada: esa instantánea proviene de la migración, no del momento original de aprobación (no existe evidencia previa). Regresión de migración incluida.
- **[P2] Retención por paquetes**: cuenta respaldos por archivo base válido y depura el paquete completo (base + manifiesto + adjuntos); integrada en el flujo de arranque tras la copia previa. Regresión: 4 paquetes con retención 2 → se conservan los más recientes completos.

Pendiente del bloque 2: interfaz de adjuntos, respaldos periódicos al trabajar y recorrido gráfico de restauración en el ejecutable Windows.

Evidencia por nivel (Linux): **Servicios y contrato IPC**: `npm test` → **124/124 en verde** (24 archivos, con regresiones desde los comandos y flujos reales). **Tipos**: ambas comprobaciones sin errores. **Compilación**: `tsc` + `vite build` correctos. **Ejecutable**: recorrido gráfico Windows **pendiente**.

## Correcciones de la vigésima revisión + Bloque 2 (recuperación y adjuntos) — aplicados y probados

Correcciones del bloque comercial (3 × P2):
- **Precio no heredado**: al cambiar a un ítem sin precio correspondiente, el importe queda pendiente (vacío) y se exige captura explícita — sin heredar el precio de otro ítem ni asignar cero. La edición de una línea histórica conserva su propio precio documentado.
- **Referencia al catálogo en todas las rutas**: `crearRevision` copia `item_id`; `LineaCompraEntrada` y el INSERT de `compra_linea` lo transportan (validando existencia y estado activo en capturas nuevas, sin borrar referencias históricas por desactivación posterior); el tipo público de líneas declara `itemId` y el editor lo conserva al abrir/guardar.
- **Documento aprobado inmutable** (migración v10): al aprobar se fija `cliente_snapshot`; `generarHtmlCotizacion` usa la instantánea para aprobadas — editar el cliente ya no cambia el documento emitido; una cotización nueva usa los datos actuales.

Bloque 2 — Recuperación y documentos de respaldo (parcial, núcleo probado):
- **Adjuntos** (migración v10, tabla `adjunto`): registro con hash SHA-256 verificado tras la copia (revertida si no coincide), listado por entidad/identificador. Servicio probado.
- **Respaldo coordinado**: `crearRespaldo` copia los adjuntos a un paquete `<respaldo>-adjuntos` y los registra con hash en el manifiesto; la restauración de adjuntos verifica manifiesto/hash y falla ante conjuntos incompletos. Probado en perfil limpio.
- **Respaldo automático previo a migraciones**: al abrir una base con esquema antiguo se genera `respaldo-previo-migracion-<marca>.db` con manifiesto antes de migrar. Probado actualizando de v8 a v10.
- **Retención configurable**: `respaldo_retencion_automatica` (por defecto 5) depura los respaldos automáticos más antiguos; los manuales nunca se depuran.

Pendiente del bloque 2: integración de interfaz para adjuntos (comandos disponibles a nivel de servicio), respaldos automáticos periódicos al trabajar, y recorrido gráfico de restauración en el ejecutable Windows.

Evidencia por nivel (Linux): **Servicios y contrato IPC**: `npm test` → **120/120 en verde** (23 archivos). **Tipos**: ambas comprobaciones sin errores. **Compilación**: `tsc` + `vite build` correctos. **Ejecutable**: recorrido gráfico Windows **pendiente**.

## Bloque 1 — Operación comercial utilizable de principio a fin (implementado y probado)

- **Migración v9 `catalogo_items`**: tabla `item_catalogo` (servicio/material, código único, unidad, descripción, precios de venta y de costo **opcionales** — sin valores inventados) y referencias `item_id` en líneas de cotización y compra.
- **Catálogo** (`servicios/catalogo.ts` + vista «Catálogo»): crear, editar y desactivar/activar ítems; **nunca se borran** — los documentos que los usan conservan identidad, texto y precios propios (regresión: editar o desactivar un ítem no modifica cotizaciones históricas).
- **Uso del catálogo**: las líneas de cotización y compra pueden seleccionar un ítem (rellena tipo, descripción y precio si existe) o capturarse libre. Los documentos guardan su propia copia.
- **Contrapartes**: editar (nombre, NRC, NIT, notas) y desactivar/activar; desactivar se bloquea si hay ventas o compras registradas activas; sin borrar identidades usadas en documentos. Vista con acciones.
- **Cuentas**: `cuenta:desactivar` con verificación de movimientos (cuenta con asientos no se desactiva).
- **Documento imprimible de cotizaciones**: `generarHtmlCotizacion` deriva contenido y cifras del **único modelo validado** (las mismas líneas del documento) con encabezado «Documento interno de control administrativo… No es un documento tributario electrónico (DTE)»; sin costos ni márgenes internos. Canal `arkon:pdfCotizacion` genera PDF real vía `printToPDF` de Electron con diálogo de guardado; la versión aprobada queda congelada y el documento de la revisión anterior se conserva.
- **Prueba de aceptación del bloque** (datos sintéticos, persistencia real): crear cliente e ítem sin valores precargados → cotizar con ítem → cerrar y reabrir la base → crear revisión → aprobar (versión previa conservada íntegra) → generar documento (contenido y cifras correctas, sin costos) → vincular proyecto → compra con ítem → bitácora y registros persistidos tras reinicio.

Evidencia por nivel (Linux): **Servicios y contrato IPC**: `npm test` → **114/114 en verde** (22 archivos). **Tipos**: ambas comprobaciones sin errores. **Compilación**: `tsc` + `vite build` correctos. **Ejecutable**: el PDF vía diálogo nativo y el recorrido completo requieren el ejecutable Windows, **pendiente**.

## Correcciones de la decimoctava revisión (sobre el commit f6753d4) — aplicadas y probadas

- **[P2] Rentabilidad coherente con el mayor**: `rentabilidadProyectos` calcula ingreso y costo/gasto desde los **asientos vinculados a los documentos del proyecto** (cuentas de ingreso y de costo/gasto): el IVA acreditable (1203) no es costo, el IVA al costo sí lo es, y las compras de activo no se convierten en gasto. Los **totales documentales** se muestran aparte como métrica informativa, con el criterio visible en la vista. Regresiones: IVA acreditable (margen 50.00 = estado de resultados), compra de equipo a activo (costo 0, margen 100.00 = mayor), anulaciones excluidas.
- **[P2] Estado de resultados asociado al mes vigente**: la consulta del reporte lleva identificador de solicitud y verificación contra el mes vigente y el mes del propio reporte; se limpia al cambiar de mes (encabezado «Estado de resultados de {mes}») y los errores de consultas viejas se descartan. Regresiones de componente: respuestas de dos meses en orden inverso con resultados distintos (la tardía no reemplaza) y cambio de mes limpia el reporte anterior.
- **[P2] Guardado centralizado**: el canal `arkon:guardarCsv` usa el servicio validado `guardarExportacionArchivo` (sin escritura directa en el canal): genera la exportación, normaliza la ruta (sin extensión → `.csv`; extensión ajena → **rechazada**; `.CSV` aceptado por mayúsculas), escribe y registra bitácora. Regresiones: ruta válida escribe y registra evento; `.txt` rechazada sin escribir; sin extensión se normaliza; `.CSV` se acepta.

Evidencia por nivel (Linux): **Servicios, contrato IPC y componentes**: `npm test` → **109/109 en verde** (21 archivos). **Tipos**: ambas comprobaciones sin errores. **Compilación**: `tsc` + `vite build` correctos. **Ejecutable**: recorrido gráfico del ejecutable Electron en Windows sin internet **pendiente** — incluye el diálogo nativo de guardado.

## Avance tras la decimoséptima revisión (sin hallazgos) — aplicado y probado

- **Guardado del CSV como archivo** (pendiente explícito resuelto): canal `arkon:guardarCsv` con diálogo de guardado nativo (`dialog.showSaveDialog`) que valida remitente, genera la exportación interna, escribe el archivo `.csv` y registra el evento en bitácora; el preload expone `guardarCsv(tipo, mes)` y la vista Impuestos ofrece «Guardar libro de ventas/compras en archivo…». El servicio de escritura (`guardarCsvArchivo`) exige extensión `.csv` y se prueba con fs real. La cancelación del diálogo no escribe nada.
- **Estado de resultados mensual** (hito 5): `estadoResultados(db, mes)` explica el resultado desde el mayor (ingresos, costos y gastos por cuenta del mes, con totales); se muestra en la vista Impuestos junto a la conciliación. Prueba: ingresos 300.00, costos 80.00, resultado 220.00 con tres cuentas; mes sin movimientos en cero.
- **Rentabilidad por proyecto** (hito 5): `rentabilidadProyectos` con ingreso, costo y margen por proyecto (ventas y compras registradas vinculadas); **provisional** cuando existen compras sin proyecto asignado — el costo desconocido nunca se trata como cero. Se muestra en la vista Proyectos con la nota visible. Prueba incluida.
- Corregido durante el avance: la vista Impuestos protege el render del estado de resultados ante respuestas malformadas.

Evidencia por nivel (Linux): **Servicios, contrato IPC y componentes**: `npm test` → **102/102 en verde** (20 archivos). **Tipos**: ambas comprobaciones sin errores. **Compilación**: `tsc` + `vite build` correctos. **Ejecutable**: recorrido gráfico del ejecutable Electron en Windows sin internet **pendiente** — incluido el diálogo nativo de guardado, que requiere ese recorrido.

## Corrección de la decimosexta revisión (sobre el commit d1f33ed) — aplicada y probada

- **[P2] Reinicio de página al cambiar el mes**: los manejadores del filtro de mes en Ventas y Compras ahora reinician `pagina` a cero en el mismo evento que cambia `mesFiltro` (React agrupa ambos estados en una sola renderización, sin petición intermedia con mes nuevo y página anterior). El control de respuestas obsoletas se conserva. Regresiones de componente en ambas vistas: avanzar a la segunda página (contenido distinto visible), cambiar a un mes con un documento y verificar que la solicitud usa `desde: 0` y que sus filas aparecen inmediatamente, sin volver atrás. Corregido además el mock de `filtrosComponente` (leía `arguments` de la función envolvente en vez del payload recibido) y las aserciones ahora verifican el contenido visible de la página siguiente, no solo la emisión de la consulta.

Evidencia por nivel (Linux): **Servicios, contrato IPC y componentes**: `npm test` → **99/99 en verde** (19 archivos). **Tipos**: ambas comprobaciones sin errores. **Compilación**: `tsc` + `vite build` correctos. **Ejecutable**: recorrido gráfico del ejecutable Electron en Windows sin internet **pendiente** y no declarado completado.

## Correcciones de la decimoquinta revisión (sobre el commit 5102847) — aplicadas y probadas

- **[P1] Contrato IPC de listados**: el validador de payloads acepta `undefined`/`null` como objeto vacío (los tipos incorrectos se siguen rechazando); Cobros y pagos vuelve a cargar ventas y compras sin opciones y sus errores de carga ahora son visibles. El despacho de comandos se extrajo a `src/main/comandos.ts` (sin dependencia de Electron), lo que permite probar el **contrato IPC real** con bases SQLite sintéticas: regresión con `venta:listar`/`compra:listar` sin opciones, con objeto vacío, con filtro de mes y con payloads inválidos (texto, arreglo) rechazados.
- **[P2] Filtros y paginación conectados**: las vistas Ventas y Compras separan la carga de catálogos de la de documentos; `cargarDocumentos` depende de `mesFiltro` y `pagina` y protege respuestas obsoletas por identificador de consulta; Ventas incorpora el filtro de mes y botones Anteriores/Siguientes que faltaban. Regresiones de componente: cambiar de mes genera una consulta con ese mes (y título del listado actualizado), Siguientes consulta con `desde: 100`, y Cobros y pagos consulta sin opciones sin error visible. **Corrección del registro anterior**: la sección de la decimocuarta revisión declaraba controles de la vista Ventas que en realidad no se habían aplicado; ahora existen y están conectados, y la evidencia de servicios se distingue del funcionamiento de la interfaz.

Evidencia por nivel (Linux): **Servicios y contrato IPC**: `npm test` → **97/97 en verde** (19 archivos; incluye pruebas del despacho real con base SQLite). **Componentes**: pruebas de vistas reales con IPC simulado. **Tipos**: ambas comprobaciones sin errores. **Compilación**: `tsc` + `vite build` correctos. **Ejecutable**: recorrido gráfico del ejecutable Electron en Windows sin internet **pendiente** y no declarado completado.

## Correcciones de la decimocuarta revisión (sobre el commit 727be68) — aplicadas y probadas

- **[P2] Documentos históricos accesibles**: `listarVentas`/`listarCompras` aceptan filtro por mes y paginación (`mes`, `limite`, `desde`); las vistas Ventas y Compras ofrecen «Filtrar por mes» y botones Anteriores/Siguientes. Un documento fuera de los últimos 100 se localiza por su mes, se clasifica y su mes exporta. Regresiones con 101+ documentos por tipo (ventas y compras): el histórico excluido del listado reciente aparece con el filtro, se clasifica y el CSV del mes se genera; paginación verificada.
- **[P2] Diálogo precargado desde el documento**: al abrir «Clasificar» ambos selectores se inicializan con los valores existentes del documento; el campo faltante muestra «— Seleccione —» y se exige elección explícita antes de enviar (validación en el envío). No se hereda la selección de otro documento y el botón también se ofrece para corregir documentos ya completos (acción auditada). Regresiones de componente: clasificación conocida con tipo pendiente (payload conserva `consumidor_final`), y apertura consecutiva de documentos diferentes sin herencia.
- **[P2] Atomicidad de la auditoría documental**: `completarClasificacionDocumento` ejecuta actualización y evento de bitácora en una única transacción; si falla cualquier escritura, los metadatos previos se conservan y no queda evento parcial. Regresión con fallo inducido por trigger en bitácora: el documento queda exactamente como estaba, sin eventos; el éxito posterior persiste ambos.

Evidencia por nivel (Linux): **Servicios y componentes**: `npm test` → **92/92 en verde** (17 archivos). **Tipos**: ambas comprobaciones sin errores. **Compilación**: `tsc` + `vite build` correctos. **Ejecutable**: recorrido gráfico del ejecutable Electron en Windows sin internet **pendiente** y no declarado completado.

## Correcciones de la decimotercera revisión (sobre el commit 6e3d96e) — aplicadas y probadas

- **[P2] Completar clasificación documental de documentos ya registrados**: nuevo servicio auditado `completarClasificacionDocumento` + comando `documento:clasificar` + acción «Clasificar» en las vistas Ventas y Compras (columna de clasificación con estado «Pendiente»). Valida valores, exige responsable y motivo, registra valores anteriores/nuevos y motivo en bitácora, y **no altera importes, asiento, aplicaciones, folio ni clave de idempotencia** (el registro idempotente conserva su semántica). Regresiones: documento nuevo sin clasificar, documento con cobro aplicado (conserva aplicaciones y clave; el reenvío idempotente sigue devolviendo duplicado), documentos con anticipo aplicado y pago aplicado, y rechazo de anulados/falta de responsable o motivo. Tras completar metadatos, el CSV se genera conservando mayor y saldos.
- **[P2] CSV asociado a mes y tipo**: la exportación mostrada identifica mes y libro («Exportación de 2026-10 · libro de ventas»), se limpia e invalida al cambiar de mes, y las respuestas se descartan por identidad de solicitud y mes vigente (también en errores). Regresiones de componente con promesas diferidas y contenidos distinguibles: cambio de mes limpia el CSV; respuesta tardía de septiembre no reemplaza la de octubre; respuesta tardía de ventas no reemplaza la de compras posterior.

Evidencia por nivel (Linux): **Servicios y componentes**: `npm test` → **87/87 en verde** (15 archivos). **Tipos**: ambas comprobaciones sin errores. **Compilación**: `tsc` + `vite build` correctos. **Ejecutable**: recorrido gráfico del ejecutable Electron en Windows sin internet **pendiente** y no declarado completado.

## Avance del hito fiscal tras la duodécima revisión (sin hallazgos) — aplicado y probado

- **Migración v8 `clasificacion_documental`**: `venta` y `compra` admiten clasificación tributaria del receptor/emisor (contribuyente, consumidor final, otro) y tipo documental (factura, crédito fiscal, recibo, otro); política `anticipo_hecho_generador` en configuración, **'pendiente' por defecto** (sin efecto fiscal automático en anticipos hasta la decisión del contador).
- **Exportación interna de trabajo** (`generarCsvLibro`): CSV por mes y libro con importes monetarios exactos; **bloquea documentos sin clasificación** enumerando sus folios; declara versión (`interna-v1`) y advertencia explícita de que **no constituye el formato oficial** de F-07/F-14 ni se declara compatible sin verificación contra la plantilla vigente del Ministerio de Hacienda. Vista Impuestos: botones de exportación, políticas visibles (hecho generador pendiente, crédito fiscal inactivo) y advertencia en pantalla.
- **Clasificación en captura**: las vistas Ventas y Compras incluyen clasificación del receptor/emisor y tipo documental (opcional en captura; obligatorio para exportar).
- Regresiones: política pendiente por defecto; exportación bloquea sin clasificar (folio enumerado); exportación correcta con clasificación y contenido exacto; meses sin documentos exportan solo encabezado.

Evidencia por nivel (Linux): **Servicios y componentes**: `npm test` → **80/80 en verde** (13 archivos). **Tipos**: ambas comprobaciones sin errores. **Compilación**: `tsc` + `vite build` correctos. **Ejecutable**: recorrido gráfico del ejecutable Electron en Windows sin internet **pendiente** y no declarado completado.

## Corrección de la undécima revisión (sobre el commit 994467d) — aplicada y probada

- **[P2] Respuestas de selecciones anteriores**: la consulta de saldo invalida las peticiones previas al cambiar o quitar la selección (aunque no se envíe una petición nueva) y al desmontar la vista; el resultado se asocia a la selección vigente (modo, tipo de anticipo y contraparte) además del identificador de petición; durante una aplicación pendiente los selectores (tipo, contraparte y documento) quedan bloqueados para que un manejador de una operación anterior no pueda reactivar una selección obsoleta.
- **Regresiones deterministas** (promesas diferidas con respuestas distinguibles, sin temporizadores iguales): respuesta tardía de Alfa no reemplaza el saldo de Beta ($50.00 permanece); aplicación pendiente bloquea los selectores y al resolverse refresca el saldo de su propia selección ($100.00 → $70.00); quitar la selección con consulta pendiente no muestra saldo sin contraparte.

Evidencia por nivel (Linux): **Servicios y componentes**: `npm test` → **76/76 en verde** (12 archivos). **Tipos**: ambas comprobaciones sin errores. **Compilación**: `tsc` + `vite build` correctos. **Ejecutable**: recorrido gráfico del ejecutable Electron en Windows sin internet **pendiente** y no declarado completado.

## Corrección de la décima revisión (sobre el commit f693799) — aplicada y probada

- **[P2] Saldo visible de anticipos**: la consulta del saldo es una función reutilizable que se ejecuta al cambiar selección y **después de cada aplicación exitosa**; las respuestas obsoletas se descartan por identificador de consulta (cambios rápidos de contraparte o tipo no sobrescriben el saldo de la selección actual); durante la consulta se muestra estado de carga y nunca el importe anterior como vigente. El saldo se presenta en formato monetario con conversión exacta (`minorATexto`), igual que el resto del formulario.
- **Regresión de componente** (nuevo nivel de verificación): se añadieron `jsdom` + `@testing-library/react` como dependencias de desarrollo y una prueba que renderiza la vista real de Cobros y pagos con IPC simulado: aplica un anticipo, comprueba la **segunda consulta de saldo** con el remanente ($100.00 → $70.00) y verifica que una respuesta obsoleta de una selección anterior no sobrescriba el saldo actual.
- **Detalle**: la prueba de migración cuyo título prometía una comparación «base nueva vs actualizada» se renombró para describir exactamente lo que ejecuta.

Evidencia por nivel de verificación (entorno Linux):
- **Servicios**: suite completa en verde.
- **Componentes**: pruebas de la vista real con IPC simulado (jsdom + Testing Library), incluida la regresión de la décima revisión.
- **Tipos**: ambas comprobaciones sin errores. **Compilación**: `tsc` + `vite build` correctos.
- **Ejecutable**: el recorrido gráfico del ejecutable Electron en Windows **sigue pendiente** y no se declara completado.

## Correcciones de la novena revisión (sobre el commit c6a296e) — aplicadas y probadas

- **[P2] Migración v7 `iva_credito_backfill`**: rellena `iva_credito_minor` de compras anteriores desde el asiento original vinculado (líneas en la cuenta 1203), sin usar la política global actual; cubre documentos anulados (su asiento original conserva el tratamiento inicial; el reverso no se suma). Las migraciones v6/v5 quedan inmutables en el historial. Prueba de regresión v5→v7: compras con crédito y al costo y compra anulada conservan importes, tratamiento y conciliación al migrar.
- **[P2] Formulario de anticipos**: el modo «Aplicar anticipo existente» ofrece selección explícita entre anticipo de cliente (a una venta) y a proveedor (a una compra); contrapartes, documentos y payload se derivan coherentemente del tipo elegido y las selecciones incompatibles se limpian al cambiar tipo o contraparte. En modo anticipo solo se piden los datos necesarios (documento, monto, fecha, responsable) y se muestra el saldo disponible de la contraparte.
- **[P2] Selección única**: la aplicación de anticipo presenta una selección única de documento (no captura múltiple silenciosa); el resto de modos conserva la captura por documento con acumulación validada en el servicio.

Evidencia por nivel de verificación (entorno Linux):
- **Servicios**: `npm test` → **72/72 en verde** (11 archivos), incluida la regresión v5→v7 del crédito fiscal.
- **Tipos**: ambas comprobaciones (`tsconfig.node.json` y `tsconfig.renderer.json`) sin errores.
- **Compilación**: `tsc` del proceso principal y `vite build` correctos.
- **Componentes**: la lógica del formulario de anticipos se verificó por contratos y tipos; **falta el recorrido gráfico del ejecutable Electron en Windows**, que no se declara completado.

## Correcciones de la octava revisión (sobre el commit 8ddd406) — aplicadas y probadas

- **[P1] Saldo centralizado**: nuevo `servicios/saldos.ts` con `saldoPendienteDocumento` (descuenta aplicaciones de dinero **y** de anticipos activos) y `aplicacionesActivasDocumento`; operacion, tesorería y fiscal consumen la misma fuente. Los listados de ventas y compras restan ambos tipos de aplicación. Pruebas: anticipo aplicado total y parcial descuenta del saldo y bloquea el cobro/pago por encima del restante.
- **[P1] Anulación de documento con anticipo aplicado**: `anularDocumento` bloquea con aplicaciones de anticipo vigentes (consistente con cobros/pagos); revertida la aplicación, la anulación autorizada conserva conciliación y devuelve disponibilidad al anticipo.
- **[P1] Anulación del movimiento que financia anticipos**: `anularMovimiento` valida la bolsa de anticipos por contraparte (excedentes de movimientos activos menos aplicaciones activas); rechaza cuando el excedente del movimiento ya sostiene aplicaciones (clientes y proveedores), con prueba de varias fuentes y cobertura restante.
- **[P2] Transición de vigencias**: la vista permite `hasta` al crear y **cerrar una vigencia abierta** (`vigencia:cerrar` con fecha, motivo y auditoría; sin solaparse con la siguiente). Prueba: régimen actual cerrado → inscripción futura registrable; consultas antes/después sin recálculo.
- **[P2] Conciliación por tratamiento**: `compra.iva_credito_minor` (migración v6) registra el IVA acreditable según la política vigente **al registrar cada compra**; la conciliación compara IVA acreditable del libro con el mayor 1203 y muestra el IVA documentado por separado. Cambiar la política no reinterpreta compras históricas. Pruebas con IVA al costo, con crédito activo y mezcla.
- **Integración gráfica de anticipos**: la vista Cobros y pagos incorpora el modo «Aplicar anticipo existente» (pendiente de la revisión resuelto en interfaz).

Evidencia (Linux): `npm run typecheck` sin errores en ambas capas; `npm test` → **70/70 en verde** (10 archivos); `npm run build` OK. La suite de la octava revisión pasó también en Windows (62/62 en su momento). El hito fiscal sigue **parcial**: faltan tratamiento del hecho generador de anticipos, clasificación tributaria/documental y exportadores verificados contra especificación oficial; la vista mensual no es un conjunto completo de libros o anexos oficiales.

## Corrección de la séptima revisión (sobre el commit 70e5c9c) — aplicada

- **[P3] Títulos de Cotizaciones restituidos**: «Cotizaciones» y «Cotizaciones recientes» vuelven a ser los textos visibles; el contrato conserva su nombre técnico.

## Hito 4 — Adaptación fiscal salvadoreña (parcial, implementado y probado)

- **Migración v5 `adaptacion_fiscal`**: `vigencia_fiscal` (perfil por vigencia sin solapamientos), `retencion` (control con base, regla, tasa, comprobante) y `aplicacion_anticipo` (aplicación posterior de anticipos sin mover dinero).
- **Vigencias**: `inscritoIvaEnFecha` gobierna el IVA débito por fecha de operación; una vigencia futura no recalcula el historial ni atribuye operaciones anteriores. Fallback al parámetro de configuración mientras no existan vigencias.
- **Libros y conciliación de IVA**: libro mensual de ventas y compras (solo documentos `registrada` suman a totales) y conciliación con las cuentas 2201/1203 del mayor, con nota explícita cuando la política de crédito fiscal está inactiva. Vista «Impuestos» con vigencias, mes seleccionable, libros y conciliación.
- **Retenciones**: registro de control (efectuada/recibida) con base, regla, contraparte y comprobante, **sin efecto contable automático** hasta la política del contador (regla del plan: no activar por defecto). Idempotencia por clave.
- **Aplicación posterior de anticipos** (pendiente de la cuarta revisión resuelto): `aplicarAnticipo` aplica el excedente de un cliente (2102→1201) o proveedor (1202→2101) a un documento pendiente de la misma contraparte, con asiento, idempotencia, validación de saldo disponible y anulación por reverso. El saldo de anticipo se deriva por contraparte de los movimientos, no de un saldo almacenado.
- La anulación manual de asientos de aplicación de anticipo queda bloqueada (origen administrado).

Evidencia (Linux): `npm run typecheck` sin errores en ambas configuraciones; `npm test` → **62/62 en verde** (9 archivos); `npm run build` OK. Siguen pendientes del hito 4: anticipos con hecho generador fiscal diferenciado (política del contador), exportadores fiscales verificados por versión (F-07/F-14 y libros), y soporte del F-11.

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

## Bloque auditoría 31 (ajustes en interfaz, detalle de auxiliares con corte temporal, exportación CSV)

### Corregido

- **P1 regresión de `referencia`**: `cobro:registrar`, `pago:registrar` y `transferencia:registrar` vuelven a aceptar `referencia` opcional (`src/main/comandos.ts`); la exigencia queda solo en `ajuste:registrar`. Prueba de regresión por despachar real en `pruebas/auditoria31.prueba.ts`: cobro/pago/transferencia sin referencia contabilizan; ajuste sin referencia rechaza sin asientos espurios.
- **Bug de parámetros en `auxiliarContraparteDetalle`** (`src/main/servicios/fiscal.ts`): el orden de parámetros con corte era incorrecto (`contraparteId` se enlazaba al filtro de fecha), por lo que el corte devolvía cero documentos. Corregido a `[hastaFecha, hastaFecha, contraparteId, hastaFecha]`; SQL parametrizado, sin concatenación de entrada.
- **CSV**: `escaparCsv` serializa comillas, comas y saltos de línea; verificado con parser CSV independiente en `pruebas/auditoria29.prueba.ts` (nombre sintético con comas, comillas y salto de línea).

### Añadido

- **Vista Ajustes** (`src/renderer/vistas/Ajustes.tsx`): fecha, concepto, referencia de soporte obligatoria, responsable, líneas con cuentas activas de movimiento y debe/haber, validación/cuadre, clave de idempotencia por operación, cancelación y mensajes de error; usa el motor central (`ajuste:registrar` → `contabilizarAsiento`).
- **Vista Reportes** (`src/renderer/vistas/Reportes.tsx`): detalle por documento de auxiliar con fecha de corte (aplicaciones y anticipos posteriores al corte no afectan el saldo mostrado), conciliación y botón GUARDAR CSV por diálogo nativo (`arkon:guardarCsvAuxiliar` en `src/main/ipc.ts`, puente en `src/preload/index.ts`, contrato en `src/renderer/api.ts`), contenido derivado del mismo modelo mostrado.

### Comprobación

- `npm run typecheck` (ambas capas) → sin errores.
- `npx vitest run` → 157/157 (33 archivos).
- `npm run build` → OK.

### Pendiente tras este bloque

- Cierre mensual/anual completo (prevalidación, cuentas de resultados, continuidad al ejercicio siguiente); el bloqueo de período actual no es cierre.
- Estado periódico: refresco tras guardado y fallo reciente visible; próxima ejecución.
- Selector de documento existente en adjuntos (hoy folio libre).
- Paquete fiscal (F-07/F-14/F-11) contra especificación oficial; instalador NSIS y recorridos reales en Windows offline.

## Bloque auditoría 32 (exportación con corte, respuestas tardías, validación de calendario, apertura y cierre de ejercicio)

### Corregido (P2 de la auditoría 32)

- **Exportación transporta corte/selección**: contrato extendido `{tipo, alcance: 'resumen'|'detalle', contraparteId?, hastaFecha?}` en toda la cadena (`Reportes.tsx → api.ts → preload → arkon:guardarCsvAuxiliar → exportarCsvAuxiliarDetalle`). El detalle exportado deriva del MISMO modelo (`auxiliarContraparteDetalle`) con el mismo corte mostrado; los botones de resumen se identifican como "actual". Prueba: venta 100.00 noviembre + cobro 60.00 diciembre → corte noviembre exporta 100.00 sin 60.00; exportación actual incluye 60.00.
- **Respuestas tardías**: `Reportes.tsx` usa token de consulta (`consultaDetalle`); las respuestas de una consulta anterior se ignoran; el detalle se invalida al cambiar tipo/contraparte/corte y ante error no queda saldo viejo. Prueba de componente con respuestas invertidas (cliente1 pendiente → llega después de seleccionar cliente2) y prueba de error con limpieza.
- **Validación de calendario de `hastaFecha`**: `auxiliarContraparteDetalle` aplica `validarFechaCalendario` antes de leer (cubre `auxiliar:contraparteDetalle` por despachar) y la exportación de detalle valida lo mismo al guardar. Pruebas: 2026-11-31 y 2027-02-30 rechazados por despachar y por exportación.

### Añadido (apertura y cierre de ejercicio)

- **Apertura documentada** (`src/main/servicios/cierre.ts`, `apertura:registrar`): fecha, concepto, referencia de soporte obligatoria, responsable, líneas con cuentas activas de movimiento, cuadre e idempotencia por operación; delega en `contabilizarAsiento` (calendario, período abierto, ámbito activo). Selector de tipo Ajuste/Apertura en la vista Ajustes.
- **Cierre de ejercicio** (`cierre:estado`, `cierre:ejercicio`, `cierre:reabrir`): prevalidación (sin resultados → rechazo; diciembre cerrado → rechazo; cierre duplicado → rechazo), asiento que lleva las cuentas de ingreso/costo/gasto con saldo a la cuenta 3201 Resultados acumulados (parametrizado), cierre del período de diciembre vía `cerrarPeriodo`, evento auditado en bitácora. Reapertura con motivo registrada. Continuidad: las cuentas de balance arrastran saldos por el mayor sin duplicación; el siguiente ejercicio parte de períodos nuevos.
- **Vista Cierre** (`src/renderer/vistas/Cierre.tsx`, menú en `App.tsx`): estado del ejercicio (períodos, saldos de resultados, neto, cierre existente), formulario de cierre con responsable/motivo/referencia, reapertura, mensajes de error sin estado falso. Bug corregido durante la prueba: el refresco tras cerrar borraba el mensaje de éxito.
- **Allowlist del preload** extraída a `src/preload/comandosPermitidos.ts` (exportada), probada directamente: `apertura:registrar`, `cierre:estado`, `cierre:ejercicio`, `cierre:reabrir` permitidos.

### Comprobación

- `npm run typecheck` (ambas capas) → sin errores.
- `npx vitest run` → 167/167 (36 archivos).
- `npm run build` → OK.

### Pendiente tras este bloque (declarado honestamente)

- Estado periódico: refresco tras guardado/ejecución, fallo reciente visible aunque exista éxito anterior, próxima ejecución.
- Selector de documento existente en adjuntos (hoy folio libre) y consulta del archivo desde la app.
- Paquete fiscal (F-07/F-14/F-11) contra especificación oficial; instalador NSIS y recorridos reales en Windows offline.

## Bloque auditoría 33 (P1 del cierre + estado periódico completo + adjuntos con selector y consulta)

### Corregido (P1 de la auditoría 33)

- **Saldos de resultados alineados con el mayor** (`src/main/servicios/cierre.ts`): `saldosResultado` ahora incluye asientos `contabilizados` Y `anulados` (misma semántica que `mayorDeCuenta`), de modo que originales anulados y sus reversos se cancelan. Prueba: venta 100.00 anulada + venta 30.00 viva → estado 30.00 = mayor; el cierre traslada 30.00 a 3201; mayor de 4101 queda 0.00 y 3201 refleja el resultado; conciliación por cuenta antes/después.
- **Bloqueo de ejercicio persistido** (migración v13, tabla `cierre_ejercicio`): aplicado en el MOTOR CENTRAL (`contabilizarAsiento` y `anularAsiento` en `motorAsientos.ts`), cubre todas las rutas (ventas, compras, cobros, pagos, ajustes, apertura, anulaciones de documentos) y meses aún no creados (la validación ocurre antes de derivar el período, así que no se crean períodos espurios). `reabrirEjercicio` marca el ejercicio `reabierto` con motivo auditado y reabre diciembre; tras ello se puede anular el asiento de cierre y contabilizar uno nuevo. Prueba del recorrido completo: cierre → rechazo retroactivo en noviembre y septiembre (mes inexistente) → ajuste rechazado → anulación rechazada → reapertura → anulación del cierre → corrección → nuevo cierre (neto 60.00 conciliado con 3201) → ejercicio 2027 utilizable sin duplicar arrastre.
- **Cierre atómico**: `cerrarEjercicio` envuelve validaciones, asiento, soporte, cierre de período, bloqueo y bitácora en una transacción única. Prueba con trigger sintético que aborta al cerrar el período: no queda asiento de cierre, ni bloqueo, ni período diciembre cerrado, ni clave de idempotencia consumida; el reintento con la misma clave completa exactamente una vez.
- Compatibilidad: la consulta de bloqueo tolera bases migradas a versiones previas (verifica existencia de la tabla), sin romper pruebas de migración v5/v7.

### Completado (bloques pendientes)

- **Estado periódico** (`Respaldo.tsx`): muestra intervalo, último respaldo, último fallo (visible aunque exista éxito anterior) y próxima ejecución; se refresca al guardar configuración, tras crear/restaurar respaldo manual y tras "Ejecutar respaldo periódico ahora" (nuevo botón con `respaldo:ejecutarPeriodico`). Prueba de componente: éxito + fallo + próxima ejecución visibles y reconsulta tras guardar.
- **Adjuntos con selector y consulta**: nuevo comando `documento:listarVinculos` (documentos reales de venta/compra/cotización/proyecto) que alimenta un selector en lugar de folio libre; `adjunto:verificar` recalcula SHA-256 desde disco (existe/hashCoincide); puente nativo `arkon:abrirAdjunto` (preload `abrirAdjunto`) que verifica hash antes de abrir con `shell.openPath`. Botones Verificar/Abrir por adjunto en la tabla. Pruebas: despachar real con archivo alterado/ausente/inexistente; selector con documentos reales; componente con puentes.

### Comprobación

- `npm run typecheck` (ambas capas) → sin errores.
- `npx vitest run` → 174/174 (39 archivos).
- `npm run build` → OK.

### Pendiente (límites reales)

- Paquete fiscal (F-07/F-14/F-11) contra especificación oficial con fuentes del contador.
- Instalador NSIS y recorridos gráficos reales en Windows offline (los tests Node/jsdom no equivalen a ese recorrido).

## Bloque auditoría 34 (bundle de preload, backfill de cierres, adjuntos completos, shell sin éxito falso, paquete del contador y Anexo 1 F-07)

### Corregido (P1/P2 de la auditoría 34)

- **P1 Preload sandbox-safe**: el preload se empaqueta con esbuild en un solo archivo CJS (`build:preload`, `dist/preload/index.js`) con `electron` como única dependencia externa; `tsconfig.node.json` ya no emite `src/preload` (nuevo `tsconfig.preload.json` noEmit), por lo que ninguna recompilación de main puede volver a dejar un `require('./comandosPermitidos')` roto. Prueba del artefacto (`auditoria34.prueba.ts`): bundle generado con los mismos argumentos del build no requiere módulos locales y contiene la allowlist; verificación adicional del bundle en `dist` cuando existe. Sandbox/contextIsolation/nodeIntegration intactos.
- **P1 Migración de cierres v12**: migración v14 `cierre_ejercicio_backfill` reconstruye el bloqueo desde cierres vigentes: asiento `cierre` contabilizado → `cerrado` con su asiento/responsable; cierre solo anulado → `reabierto` documentado. Pruebas: base v12 con cierre activo (implementación del SHA 08d55b6) queda bloqueada tras migrar (venta retroactiva rechazada); base v12 con cierre anulado queda operable. Historial, saldos y folios preservados; `aplicarMigraciones` sigue siendo idempotente.
- **P2 Adjuntos >50**: `documento:listarVinculos` acepta `busqueda` (LIKE escapado sobre folio/concepto/nombre/código) y `limite` (1-500, por defecto 50); la vista añade caja de búsqueda en vivo junto al selector. Prueba con 55 ventas: por defecto 50, búsqueda encuentra V-000001, límite 500 devuelve las 55; el límite excesivo se acota.
- **P2 Falso éxito al abrir**: `arkon:abrirAdjunto` examina el string de retorno de `shell.openPath`: texto no vacío → error visible con el mensaje del sistema; vacío → `abierto:true`; rechazo y remitente ajeno propagados; el hash se verifica antes de abrir. Pruebas con Electron simulado (`auditoria34Shell.prueba.ts`): 'No application is associated…' se comunica como fallo, hash alterado no abre.

### Añadido (bloque independiente)

- **Paquete interno para el contador** (`src/main/servicios/paqueteContador.ts`, `paquete:generar`, canal nativo `arkon:guardarPaqueteContador` con diálogo de carpeta, botón en Reportes): LEEME con versión/período/límites, cuentas, auxiliares de clientes/proveedores por documento con el corte pedido, auxiliar de efectivo, estado de resultados mensual, asientos del período y conciliaciones — todo derivado de los mismos servicios ya conciliados; evento en bitácora al guardar. Pruebas por despachar (coherencia de corte, contenido, rechazos) y del handler IPC real con diálogo (escritura, cancelación sin archivos).
- **Anexo 1 F-07 v14 (ventas a contribuyentes)** con especificación OFICIAL verificada: Manual de Usuario Anexos F-07 v14 (DGII, Ministerio de Hacienda, Enero 2025; transparenciafiscal.gob.sv / mh.gob.sv), Anexo 1 columnas A-T, separador ';', fechas DD/MM/AAAA, montos de 10 caracteres con dos decimales, columnas R/S según período 2025-01. `src/main/servicios/anexosFiscales.ts`, comando `fiscal:anexo1Ventas`, canal `arkon:guardarAnexo1Ventas`, sección en Impuestos con previsualización. Sin datos inventados: clase/resolución/serie quedan vacías (ARKON sin autorización de documentos), folios sin NIT/NRC o sin desglose de tratamiento se listan en `incompletos`, anuladas y consumidor final excluidas, y la vista muestra la advertencia de que NO debe presentarse sin activación formal. Pruebas: estructura A-T exacta, exclusión de anuladas/consumidor final, incompletos listados, mes inválido rechazado (vigencia sintética aislada solo en la prueba).

### Comprobación

- `npm run typecheck` (main + preload + renderer) → sin errores.
- `npx vitest run` → 189/189 (43 archivos).
- `npm run build` → OK; `dist/preload/index.js` autocontenido (solo `require("electron")`).

### Pendiente (límites reales)

- Anexos 2 (consumidor final), 3 (compras) y F-14 (retenciones) con la misma especificación oficial ya identificada; decisiones del contador para activación formal.
- Instalador NSIS y recorridos gráficos reales en Windows offline (el arranque real del preload debe confirmarse en Windows como hiciste; aquí se probó el artefacto del build).

## Bloque auditoría 35 (paquete coherente al corte, Anexo 1 con bloqueo y vía auditada, formato, UI)

### Corregido (hallazgos de la auditoría 35)

- **Fallo de suite en Windows**: la prueba del bundle del preload usa ahora la API JS de esbuild (`build()` de 'esbuild') en lugar de `execFileSync` con `.cmd` (EINVAL en Node 24/Windows). La verificación del artefacto real se conserva.
- **P1 Paquete histórico**: `generarPaqueteContador` reescrito (v2) con coherencia total al corte: el universo de contrapartes sale de documentos registrados con fecha ≤ hasta (no de saldos actuales), los saldos de cuentas/balance/conciliaciones se calculan acumulados al corte (`fecha_operacion <= hasta`, estados contabilizado/anulado), y resultados/asientos usan el rango exacto desde–hasta (ya no meses enteros). Conciliaciones comparan auxiliares al corte contra el mayor del MISMO corte (1201/2101/efectivo). Pruebas: cobro TOTAL posterior al corte no vacía el auxiliar (100.00 al corte, 0.00 actual) ni falsea la conciliación; rango parcial 10–20 excluye la venta del día 1 de resultados pero la mantiene en saldos acumulados; anticipo aplicado después del corte no reduce la deuda al corte; rechazos de rango/fechas.
- **P1 Anexo fiscal sin bloqueo/inferencia**: separación estricta entre diagnóstico interno y archivo de presentación. `diagnosticarAnexo1Ventas` (comando `fiscal:anexo1Ventas`) enumera TODOS los campos faltantes por folio (NIT/NRC, clase B, resolución D, serie E, número autorizado F, tratamiento sin IVA, R, S) y no genera archivo. `exportarAnexo1VentasPresentacion` (canal `arkon:guardarAnexo1Ventas`) RECHAZA si algún folio está incompleto o no hay vigencia con IVA inscrito que cubra el mes; sin inferencias: IVA 0 ya no asigna la base a exentas — exige `tratamiento_venta` explícito registrado por la vía auditada. Nueva migración v15 con columnas de metadatos fiscales explícitos y `completarMetadatosFiscales` (comando `fiscal:metadatosCompletar`) que valida contra los catálogos del manual oficial (clase 1/2/4; R: 1/2/3/4/12/13; S: 1-13; tratamiento exenta/no_sujeta) y registra bitácora con motivo. Pruebas: diagnóstico completo sin archivo; bloqueo sin vigencia aunque los metadatos estén completos; generación solo con vigencia sintética aislada + metadatos completos; venta sin IVA usa la columna del tratamiento explícito; anuladas y consumidor final excluidas; catálogos validados.
- **P2 Formo y recorrido**: serialización con escape para separador ';' (comillas dobladas, saltos y comillas protegidos) y validación de 20 columnas por fila; verificado con parser CSV independiente (nombre sintético con `;`, comillas y salto ocupa UNA línea física y 20 campos). UI conectada de verdad en `Impuestos.tsx` (verificada esta vez): advertencia permanente, diagnóstico con faltantes específicos por folio, formulario de metadatos por vía auditada (clase/resolución/serie/número/tratamiento/R/S/responsable/motivo) que refresca el diagnóstico, y guardado de presentación cuyo bloqueo se muestra como error. Prueba del componente real: diagnóstico→faltantes→bloqueo visible; y vía auditada→bitácora→refresco. Etiqueta renombrada a "Período del anexo" para no colisionar con las pruebas aprobadas de la vista.

### Comprobación

- `npm run typecheck` (main + preload + renderer) → sin errores.
- `npx vitest run` → 196/196 (44 archivos).
- `npm run build` → OK; `dist/preload/index.js` autocontenido.

### Pendiente (límites reales)

- Anexos 2 (consumidor final) y 3 (compras) del F-07 v14 y F-14/F-11 con la misma fuente oficial, matriz de campos y bloqueos equivalentes; sin arrastrar inferencias del Anexo 1.
- Instalador NSIS, manual y QA Windows offline.

## Bloque auditoría 36 (corte real en cuentas/efectivo, matriz de validación fiscal, selección de documento)

### Corregido (hallazgos de la auditoría 36)

- **P1 Corte en cuentas.csv/efectivo**: `saldosCuentaCorte` ya no suma líneas cuyo asiento quedó excluido por el LEFT JOIN (`CASE WHEN a.id IS NOT NULL`), de modo que borradores y asientos futuros no influyen; las cuentas sin movimientos se conservan en 0.00. La conciliación `efectivoMayor` compara contra un mayor independiente al corte (ya no tautología) y se añade `cuentas-exportadas-vs-mayor-al-corte`: cada fila exportada de cuentas.csv se verifica contra `mayorCuentaCorte` del mismo corte; cualquier discrepancia hace negativa la conciliación y el balance. Pruebas del repro exacto: venta 100 del 1/nov + cobro TOTAL del 5/dic → al 30/nov: cuentas.csv 1201=100.00 y 1101=0.00, efectivo TOTAL 0.00, conciliaciones ok; asiento borrador con línea en caja y asiento futuro no alteran saldos al corte.
- **P1 Validación fiscal de contenido**: matriz compartida `faltantesDe(db, venta, mes)` usada por diagnóstico y revalidada dentro de la exportación: NIT de 14 dígitos o NRC numérico (identificación alfabética rechazada), clase 1/2/4, resolución/serie/número no vacíos y ≤100 caracteres, tratamiento explícito para IVA 0, R/S requeridos solo desde 2025-01 (períodos anteriores exportan '0' según el manual), y cobertura de vigencia con IVA inscrito **por fecha de cada documento** (no por mes-01). Reglas cruzadas por clase en la columna G: clase 2 → G=F; clase 4 → G vacía; clase 1 → G=control interno (folio). Pruebas: NIT 'ABC', resolución de 101 caracteres y vigencia parcial (1–15 nov con venta del 20) bloquean la presentación; clase 2 exporta G=F; clase 4 exporta G vacía; período 2024-11 exporta R/S=0 sin exigirlos; la mutación del NIT tras el diagnóstico se detecta al exportar.
- **P2 Selección de documento**: el formulario de metadatos ya no exige un id numérico a mano: selector de ventas con búsqueda (`documento:listarVinculos` ahora incluye el id interno), botón "Completar…" por folio del diagnóstico que carga el documento, comando `fiscal:metadatosLeer` que muestra folio/fecha/cliente y metadatos actuales al seleccionar, y refresco de selección y diagnóstico tras guardar. Prueba del componente: diagnóstico→Completar…→documento seleccionado con metadatos previos→registro→refresco; selector con id interno distinto del número de folio.

### Comprobación

- `npm run typecheck` (main + preload + renderer) → sin errores.
- `npx vitest run` → 201/201 (45 archivos).
- `npm run build` → OK; `dist/preload/index.js` autocontenido.

### Pendiente (límites reales)

- Anexos 2/3 del F-07 v14 y F-14/F-11 con la misma fuente oficial y matriz equivalente.
- Instalador NSIS, manual y QA Windows offline (criterios de instalación/actualización/recuperación).

## Bloque auditoría 37 (carrera de selección, límites por columna, Anexos 2 y 3, preparación QA Windows)

### Corregido (P2 de la auditoría 37)

- **Carrera en selección de documento**: `seleccionarDocumento` usa token de consulta (`consultaMeta`); las lecturas de una selección anterior se ignoran; el destino se limpia al deseleccionar (id 0 → formulario bloqueado); durante la carga el guardado queda deshabilitado y el botón muestra 'Cargando documento…'; el error de lectura limpia el destino y muestra mensaje. Prueba del componente con orden inverso (ID 7 pendiente → seleccionar 12 → llega lectura 7 → el selector y el documento visible siguen en 12), deselección (botón deshabilitado) y error de lectura (mensaje y guardado bloqueado).
- **Límite genérico eliminado**: el tope `fila.some(c => c.length > 100)` se sustituyó por la matriz POR COLUMNA del manual (A=10, B=1, C=2, D/E/F/G=100, H=14, I=sin límite, J–P=10, Q=9, R/S=2, T=1). Pruebas: nombre de cliente de 125 caracteres se exporta (columna I sin límite, diagnóstico no bloqueado); resolución/serie/número de exactamente 100 pasan y 101 se rechazan por columna.

### Añadido (bloque F-07 completo)

- **Anexo 2 (ventas a consumidor final)**: `diagnosticarAnexo2VentasConsumidor` + `exportarAnexo2VentasConsumidorPresentacion` — 23 columnas A-W del manual, tipo 01, gravadas con IVA incluido, exentas/no sujetas solo con tratamiento explícito, R/S por período 2025-01, límites por columna, vigencia por fecha de documento, bloqueo y revalidación. Prueba: incompleto bloquea con faltantes; completo exporta fila de 23 columnas con 113.00 en gravadas y total.
- **Anexo 3 (compras)**: migración v16 (tipo_operacion_renta, clasificacion_renta, sector, tipo_costo_gasto en compra); `diagnosticarAnexo3Compras` + `exportarAnexo3ComprasPresentacion` — 21 columnas A-U, montos por línea (exentas/no sujetas de `compra_linea`, gravadas, crédito fiscal = IVA documentado, conciliado con el total), Q/R/S/T explícitos desde 2024-02 ('0' antes), NIT/NRC de proveedor validado, límites por columna, bloqueo y revalidación. `completarMetadatosFiscales` extendido a compras con bitácora. Prueba: compra con línea gravada 100+13 y exenta 50 exporta 50.00/100.00/13.00/163.00 en las columnas correctas.
- **Canal unificado `arkon:guardarAnexoF07`** (anexo 1/2/3, diálogo nativo, bitácora con versión y fuente); preload `guardarAnexoF07`; secciones Anexo 2 y Anexo 3 en Impuestos con diagnóstico y guardado, compartiendo el bloqueo y la advertencia de activación formal.
- **Preparación QA Windows**: variable `ARKON_RUTA_DATOS` (solo para perfiles aislados de QA; la ruta operativa sigue siendo `%LOCALAPPDATA%\ARKON Contabilidad`), `scripts/qa-windows.ps1` (npm ci reproducible, typecheck, suite con rebuild de better-sqlite3 para Node, build main+preload+renderer, NSIS opcional con `-ConInstalador`, arranque con perfil temporal exclusivo bajo LOCALAPPDATA fuera de OneDrive) y `docs/QA-WINDOWS.md` con los criterios de aceptación del recorrido (apertura, captura con doble envío, anulaciones, adjuntos con hash, CSV/PDF/paquete/anexos bloqueados, respaldo/restauración/reapertura offline, instalador y actualización que conservan datos).

### Comprobación

- `npm run typecheck` (main + preload + renderer) → sin errores.
- `npx vitest run` → 206/206 (46 archivos).
- `npm run build` → OK; `dist/preload/index.js` autocontenido (solo `require("electron")`).

### Pendiente (límites reales)

- F-14 (retenciones) y F-11: requieren verificación independiente del manual OFICIAL de cada formulario (el PDF de F-07 no los especifica); fuente candidata: catálogo normativo de Hacienda (transparencia.mh.gob.sv). No declarar compatibilidad sin esa verificación.
- Ejecución real de `scripts/qa-windows.ps1` e instalador NSIS en Windows: preparado aquí, no ejecutado desde este entorno Linux.
