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

## Bloque auditoría 38 (fórmulas del manual en Anexos 2/3, recorrido UI completo, catálogos y QA Windows corregido)

### Corregido (hallazgos de la auditoría 38)

- **P1-1 Anexo 3, columna O**: Total de Compras = suma G:M según el manual (página impresa 19), sin crédito fiscal: G50 + J100 → O150 (el total financiero 163 se conserva en la compra). Prueba con comparación de fórmula: O = Σ(columnas 7..13) verificada numéricamente, no contra el total financiero.
- **P1-2 Anexo 2, reglas por clase**: clase 1 → F=H y G=I (número autorizado, ya no el folio administrativo); clase 2 → control interno del/al = folio y número del/al = número autorizado; clase 4 (DTE) → agrupación diaria con D/E/F/G='N/A' y H/I = código de generación del primer/último DTE del día, montos sumados. Prueba: clase 2 con F/G=V-000001 y H/I=NUM-C2; dos DTE del 5 de noviembre se agrupan en UNA fila con 226.00 y códigos CODGEN-1..2 en extremos; el DTE del 6 queda en fila propia con 113.00; las ventas no se alteran.
- **P1-3 Interfaz Anexos 2/3**: las secciones existen ahora de verdad (verificado con grep y prueba de componente): diagnóstico (`fiscal:anexo2Ventas`/`fiscal:anexo3Compras`), guardado nativo vía `guardarAnexoF07(2/3,...)`, y el formulario de metadatos soporta compras: selector de tipo venta/compra (que invalida lecturas en curso al cambiar), selector de compras con id interno, `fiscal:metadatosLeer` extendido con tipo (devuelve folio/fecha/cliente/metadatos incl. R/S/T), campos Clasificación/Sector/Tipo costo-gasto solo para compras, y refresco tras guardar. Prueba de componente: secciones visibles, diagnóstico Anexo 3 con faltantes, `guardarAnexoF07(2, '2026-11')` invocado, flujo de compra con lectura por tipo y campos R/S/T presentes.
- **P2-4 Catálogos Anexo 3**: Q/R/S/T validados como numéricos de un dígito (estructura del manual: 1 carácter) en la vía auditada (rechaza X/Y/Z), en el diagnóstico y en la exportación (revalidación). Validaciones separadas venta/compra: la compra no exige campos exclusivos de venta y viceversa. Prueba: X/Y/Z rechazados al guardar; sector alterado a 'Y' bloquea diagnóstico y exportación.
- **P2-5 QA Windows**: el script reconstruye el ABI correcto por etapa (`npm test` para Node; `npx electron-builder install-app-deps` para Electron antes de abrir, o `dist:win`), valida el arranque (espera 8 s y falla si el proceso murió), bloquea la apertura si ya hay una instancia de este repositorio, aísla también Chromium (`--user-data-dir` bajo el perfil), documenta que el instalador se genera en `paquete\` (no dist\), restaura las variables de entorno y permite reabrir el mismo perfil con `-Perfil <ruta>`. `docs/QA-WINDOWS.md` actualizado con el ciclo ABI (rebuild:node tras el QA) y sin afirmar ejecución real desde Linux.

### Comprobación

- `npm run typecheck` (main + preload + renderer) → sin errores.
- `npx vitest run` → 209/209 (46 archivos).
- `npm run build` → OK; `dist/preload/index.js` autocontenido.

### Pendiente (límites reales)

- F-14 (retenciones) y F-11: verificación independiente del manual OFICIAL de cada formulario antes de implementar.
- Ejecución real de `scripts/qa-windows.ps1`, del instalador NSIS y del recorrido gráfico en Windows.
- Catálogos específicos completos de R/S/T del Anexo 3 (página 20 del manual: reglas especiales de códigos 8/9): la validación actual cubre el formato numérico de un dígito verificado en la estructura; los significados de cada código quedan como decisión documental del contador al completar metadatos.

## Bloque auditoría 39 (origen del diagnóstico, contrato por tipo, catálogos del Anexo 3)

### Corregido (hallazgos de la auditoría 39)

- **P1-1 Completar abría venta desde diagnóstico 3**: el diagnóstico guarda ahora su origen (`anexo` 1/2/3 y `tipoDocumento` venta/compra) y el botón "Completar…" pasa el tipo EXPLÍCITO a `seleccionarDocumento(id, tipo)` (sin depender de setState asíncrono); tras guardar se reconsulta el diagnóstico del ANEXO DE ORIGEN (no siempre el 1) y se relee el documento con su tipo. Prueba por despachar con venta y compra del MISMO id simultáneo: `metadatosLeer {documentoId, tipo:'compra'}` devuelve CMP-000001 y `tipo:'venta'` devuelve V-000001; prueba de componente: Completar desde diagnóstico 3 invoca `metadatosLeer` con `tipo:'compra'` y muestra el documento de proveedor.
- **P1-2 R/S/T no se enviaban y se exigía tipoIngresoRenta a la compra**: el payload del formulario ahora se construye POR TIPO (compra envía clasificacionRenta/sector/tipoCostoGasto y omite tipoIngresoRenta/tratamientoVenta; venta al revés); el comando `fiscal:metadatosCompletar` y el servicio validan por separado (venta: R del catálogo Renta y S de ingreso; compra: Q 1-4, R 1-2, S 1-4, T 1-7); la vista oculta los campos exclusivos de venta para compra y muestra el selector Q 1-4 correspondiente. Prueba de aceptación completa por despachar: diagnóstico 3 → lectura compra → guardar R2/S4/T7 SIN tipoIngresoRenta → cierre y REAPERTURA de la base conserva 2/4/7 con tipo_ingreso_renta NULL → diagnóstico 3 listo → exportación con 1/2/4/7 en columnas Q/R/S/T. Prueba de componente: el payload de compra contiene R/S/T y no tipoIngresoRenta; tras guardar se reconsulta fiscal:anexo3Compras.
- **P2-3 Catálogos del Anexo 3**: implementados los catálogos ordinarios del manual (página impresa 20): Q 1-4, R 1-2, S 1-4, T 1-7, compartidos por vía auditada, diagnóstico y exportación. R7/S7/T0 se rechazan al guardar ('catálogo 1-2'), el diagnóstico los lista como faltantes y la exportación se bloquea. Impedimento exacto documentado: los códigos excepcionales 8/9 mencionados por el auditor no se aceptan hasta verificar el texto de sus reglas — la descarga del PDF oficial se trunca antes de la página 20 y la extracción disponible no incluye esas reglas; rechazarlos es la postura conservadora.

### F-14: fuente oficial verificada

Manual de usuario para la carga de archivo del Anexo de Retenciones de Impuesto sobre la Renta a sujetos domiciliados y no domiciliados (F-14 v15), fuente oficial: https://www.transparenciafiscal.gob.sv/downloads/pdf/700-DGII-MN-2021-26032.pdf (enlazado desde https://www.mh.gob.sv/nuevo-manual-de-usuario-para-la-carga-de-archivo-de-anexos-f14/ ). Contenido verificado: campos del anexo (domiciliado, código de país de 4 caracteres, nombre en mayúsculas, NIT/NIF de 14, DUI de 9, código de ingreso de 2, monto devengado de 12, bonificaciones, impuesto retenido, aguinaldo exento/gravado, AFP/ISSS/INPEP/IPSFA/CEFAFA/Bienestar Magisterial/ISSS-IVM, columnas S/T/U/V desde 2024-02, período MMYYYY, apéndice de códigos de retención y de países). Impedimento exacto documentado: la extracción de texto del PDF oficial es fragmentaria en la tabla de orden de columnas (no asigna con certeza las letras A..X), por lo que NO se genera un archivo F-14 hasta contar con esa secuencia exacta; no se declara compatibilidad por conteo de columnas. La tabla `retencion` del esquema actual no almacena aún domicilio/país/código de retención/S-T-U-V: la vía auditada y la migración correspondiente quedan como siguiente paso con esa fuente ya verificada.

### Comprobación

- `npm run typecheck` (main + preload + renderer) → sin errores.
- `npx vitest run` → 211/211 (47 archivos).
- `npm run build` → OK; `dist/preload/index.js` autocontenido.

## Bloque auditoría 40 (contrato del submit, reglas conjuntas del Anexo 3, Anexo F-14 v16)

### Corregido (hallazgos de la auditoría 40)

- **P1 Payload sin responsable/motivo**: restituidos en el submit del formulario de metadatos (el spread por tipo los había desplazado). El mock del componente ahora valida el contrato real: rechaza 'Campo requerido: responsable/motivo' y los catálogos de compra, de modo que la suite detecta omisiones del contrato (las pruebas existentes rellenan ambos y pasan; una omisión fallaría).
- **P2 Reglas conjuntas del Anexo 3** (tabla página impresa 21 del manual F-07 v14): R2 (gasto) permite T 1-3 con cualquier S 1-4; R1 (costo) + S1 (industria) permite T 4-7; R1 + S2/S3/S4 permite T 4-5. Aplicadas en vía auditada, diagnóstico y exportación (revalidación) con mensaje corregible 'combinación R=/S=/T= no permitida'. Pruebas: R2/S4/T7 rechazada; Q1/R2/S4/T1, R1/S1/T7 y R1/S2/T4 aceptadas; R1/S2/T7 rechazada; mutación a combinación inválida bloquea diagnóstico y exportación. Combinación de aceptación actualizada según la corrección del auditor.

### Añadido: Anexo de Retenciones F-14 v16 (fuente y versión oficiales verificadas)

- **Fuente**: Manual de usuario F-14 v16 (Octubre 2025), https://www.transparenciafiscal.gob.sv/downloads/pdf/700-DGII-MN-2021-26032.pdf — la portada del archivo es v16, no v15; no se toma el aviso antiguo ni el nombre del fichero como versión.
- **Matriz exacta A-W (23 columnas)**: A domiciliado(1), B país(4), C nombre(100), D NIT/NIF(14), E DUI(9), F código ingreso(2), G devengado(12), H bonificaciones(12), I retenido(12), J aguinaldo exento(6), K aguinaldo gravado(12), L AFP(6), M ISSS(5), N INPEP(5), O IPSFA(5), P CEFAFA(5), Q Bienestar Magisterial(5), R ISSS/IVM(5), S tipo operación(1), T clasificación(1), U sector(1), V tipo costo/gasto(1), W período(6 MMYYYY). S/T/U/V = 0 antes de 2024-02.
- **Migración v17** (metadatos de retención: domiciliado, código país, NIT/NIF, DUI, código ingreso, S/T/U/V) y **vía auditada** `fiscal:retencionMetadatosCompletar` con bitácora; catálogos verificados del propio F-14: S {1 Gravada, 2 No Gravada, 9 nota 9}, T {1 Costo, 2 Gasto, 9 nota 9}; nota 9 (página 5) implementada para instituciones públicas/municipalidades/no inscritos IVA/no deducibles. Impedimento exacto documentado en el código y docs: los catálogos completos de U y V del F-14 no son extraíbles del PDF de imágenes; se valida dígito simple (más el 9 de nota 9) y queda pendiente la lista exacta. No se trasladan reglas del F-07 al F-14.
- **Diagnóstico y exportación**: `fiscal:anexoRetenciones` (bloqueo por faltantes o sin cobertura de vigencia por fecha de retención) y `exportarAnexoRetencionesF14Presentacion` con límites por columna, revalidación al exportar, nombre en mayúsculas (columna C), devengado/retenido de la retención real, período MMYYYY y bloqueo de activación formal. Canal nativo `arkon:guardarAnexoF14` + preload `guardarAnexoF14` + sección en Impuestos con diagnóstico, guardado y formulario auditable (selector de retenciones, país, NIT/DUI, código, S/T/U/V, responsable/motivo).
- **Pruebas** (`auditoria40F14.prueba.ts`): 23 columnas exactas con valores sintéticos (país 9300, código 42, devengado 1000.00, retenido 100.00, período 112026); persistencia tras reapertura; revalidación (sector 'X' bloquea la exportación); rechazos de país/NIT/código/S-T fuera de catálogo/responsable/motivo; nota 9 aceptada con DUI; período 2023-11 exporta S/T/U/V=0 sin exigirlos.

### F-11

Guía oficial localizada y descargada (58 páginas): https://www.transparenciafiscal.gob.sv/downloads/pdf/700-DGII-GA-2018-20288.pdf (entrada del catálogo normativo de Hacienda). Contiene pasos de renta en línea; NO es un esquema CSV ni confirma tasas/vigencias actuales: se usará para soporte interno anual y paquete del contador, sin generar archivo de presentación ni inventar tasas.

### Comprobación

- `npm run typecheck` (main + preload + renderer) → sin errores.
- `npx vitest run` → 215/215 (48 archivos).
- `npm run build` → OK; `dist/preload/index.js` autocontenido.

## Bloque auditoría 41 (F-14 completo: separador, reglas propias, autorización separada del IVA y formulario sin contaminación)

### Corregido (hallazgos de la auditoría 41)

- **P1-1 CSV multi-retención**: el separador era la secuencia literal barra+n; corregido a LF real. Prueba con DOS retenciones de sujetos distintos: el CSV tiene DOS filas físicas de 23 campos, sin '\n' literal, devengados sumando 3000.00 y retenidos 300.00 conciliados; cancelación y error probados por el handler con diálogo.
- **P1-2 Validación semántica propia del F-14 v16** (páginas 5-6 del manual, sin trasladar reglas del F-07): domiciliado restringido a 1/2; NIT/NIF y DUI exclusivos ('no ambos'); S ampliado al catálogo real 1-4 (1 Gravada, 2 No Gravada, 3 Excluido/No Constituye Renta, 4 Mixta) más el 9; T 1-2 más 9; U 1-4 más 9; V 1-7 más 9; **nota 9 = los cuatro campos S/T/U/V en 9 juntos** (mezclas rechazadas); **matriz T/U/V** (página 6): T2 → V1-3 con cualquier U; T1+U1 → V4-7; T1+U2/3/4 → V4-5. Reglas compartidas en vía auditada, diagnóstico y exportación. Pruebas corregidas según tu corrección: S=3 y S=4 ahora válidos; 9/9/9/9 aceptado como nota 9 con DUI; 9 mezclado rechazado; matriz verificada en ambos sentidos. **Nómina**: declaración explícita obligatoria en la vía auditada; una retención que involucra nómina queda BLOQUEADA en diagnóstico y exportación ('sin captura de aguinaldos/deducciones J-R') en lugar de exportar 0.00 en importes desconocidos.
- **P2-3 Autorización F-14 separada del IVA**: migración v18 con `obligacion_f14` en vigencia_fiscal; el diagnóstico/exportación del F-14 exige cobertura de esa autorización (ya no inscrito_iva), coherente con la nota 9 que contempla sujetos no inscritos en IVA. `vigencia:crear` acepta `obligacionF14`. Casos probados: administrativo sin autorización → bloqueado con mensaje explícito; hipotético autorizado sin IVA → exportable. La presentación real de ARKON sigue bloqueada hasta configuración profesional explícita (no se activa nada).
- **P2-4 Formulario sin contaminación**: `fiscal:retencionMetadatosLeer` + carga al seleccionar con token contra respuestas tardías; al alternar retención los campos se recargan del sujeto correspondiente (el NIT de A no persiste en B); sin clasificaciones preseleccionadas (selectores vacíos con '— Seleccione —'); submit deshabilitado durante la carga; recarga de retención y diagnóstico F-14 tras guardar. Pruebas de componente: alternancia 31→32 con NITS distintos, guardado con contrato real (responsable/motivo/involucraNomina), y `guardarAnexoF14('2026-11')` por diálogo nativo.

### Comprobación

- `npm run typecheck` (main + preload + renderer) → sin errores.
- `npx vitest run` → 217/217 (49 archivos).
- `npm run build` → OK; `dist/preload/index.js` autocontenido.

### Pendiente (límites reales)

- Apéndice de códigos de ingreso del F-14 (página 17-18 del PDF de imágenes): se valida formato de 2 dígitos; la lista oficial de códigos queda como verificación pendiente antes de cualquier uso real.
- Soporte interno anual F-11/paquete del contador, manual de usuario e instalación/actualización Windows.

## Bloque auditoría 42 (booleano estricto, catálogo de ingresos, identidad por fecha y obligación F-14 en el recorrido)

### Corregido (hallazgos de la auditoría 42)

- **P1-1 Booleano estricto por comando**: `exigirBooleano` en comandos.ts valida `typeof === 'boolean'` ANTES de convertir; `involucraNomina`/`personaNatural` ausentes, null o cadena fallan con 'Campo requerido (booleano)' sin mutar la retención. Prueba por despachar real: las tres omisiones rechazan y la fila queda con `involucra_nomina`/`persona_natural` NULL (sin persistir un false deducido).
- **P1-2 Catálogo de ingresos versionado** (apéndice p17-18 del F-14 v16): `CODIGOS_INGRESO_F14_V1` con los códigos verificados — 42 ordinario admitido; 01 (servicios permanentes con subordinación, nota p7) y 47 (nota especial art. 123 inciso tercero, p18) bloqueados explícitamente por alcance; cualquier otro (99) rechazado como 'no verificado en el apéndice oficial'. Reglas compartidas guardar/diagnosticar/exportar. Impedimento documentado en el código: el apéndice es tabla de imagen no extraíble como texto; el catálogo se amplía solo con verificación documentada. Pruebas: 99/01/47 rechazados, 42 admitido; mutación a 47 bloquea diagnóstico y exportación.
- **P1-3 Identidad por fecha/domicilio/naturaleza** (páginas 3-4): nueva declaración explícita `personaNatural` (migración v19, vía auditada, nunca inferida del nombre). Reglas: DUI solo para persona natural DOMICILIADA desde 2022-01 (no domiciliado con DUI → rechazado, tu reproducción); antes de 2022-01 el NIT/NIF es obligatorio y el DUI va vacío (domiciliado con DUI en 2021 → rechazado); persona natural domiciliada: DUI o NIT exclusivos; jurídica domiciliada: NIT 14 dígitos; no domiciliado: NIF extranjero de MÁXIMO 14 caracteres (alfanumérico, sin guiones — no se imponen 14 dígitos nacionales). Pruebas de los tres casos rechazados y del NIF extranjero 'AB12345678' admitido.
- **P2-4 Obligación F-14 en el recorrido real**: `vigencia:listar` devuelve `obligacionF14`; el formulario de vigencia de Impuestos captura el checkbox 'Obligación F-14 desde esa fecha' (sin preselección) y lo envía en `vigencia:crear`; la tabla muestra la columna con su estado. Prueba de componente: vigencia hipotética autorizada sin IVA visible (No/Sí) y creación con el flag en el payload. El caso administrativo sin autorización bloqueado ya está probado a nivel servicio (auditoría 41) y se mantiene.

### Comprobación

- `npm run typecheck` (main + preload + renderer) → sin errores.
- `npx vitest run` → 221/221 (49 archivos).
- `npm run build` → OK; `dist/preload/index.js` autocontenido.

### Pendiente (siguiente bloque, no cerrado en esta entrega)

- Soporte interno anual F-11 (conciliación anual trazable, datos faltantes explícitos, exportación local para el contador) — sin CSV oficial ni tasas inventadas.
- Manual de usuario e instalación/actualización Windows; QA gráfico/NSIS/offline real.
- Ampliación del catálogo de códigos de ingreso del F-14 con la verificación visual del apéndice que posee el auditor.

## Bloque auditoría 43 (catálogo F-14 ampliado, soporte anual interno F-11, manual y preparación de actualización Windows)

### Añadido

- **Catálogo F-14 ampliado** con la lectura visual verificada del apéndice (p17-18 del manual v16), registrada por grupo/versión/página: acreditables {01,05,06,07,08,09,11,19-27,48,80-85}, no acreditables {28-47,49}, sin retención {60,70,71,72}. 01 (laboral) y 47 (especial art. 123) permanecen BLOQUEADOS con motivo; el resto se admite solo con captura suficiente. Documentado: la aplicación NUNCA elige código/tasa/política automáticamente y esto no certifica el catálogo íntegro ni activa obligaciones.
- **Soporte interno del ejercicio anual (F-11)**: `src/main/servicios/ejercicioAnual.ts` con `consultarEjercicio` — movimientos del ejercicio vs saldos acumulados al corte, resultado ordinario (excluyendo el asiento de cierre para no duplicar ni sumarlo como ingreso/gasto) y resultado con cierre, ajustes/anulaciones/reversos por efecto neto, retenciones registradas (efectuadas/recibidas, sin efecto contable automático), y **conciliación con una consulta INDEPENDIENTE del mayor** (tercera consulta directa, no la misma suma). Comando `ejercicio:consultar`, canal nativo `arkon:guardarEjercicioAnual` (carpeta con LEEME/cuentas/asientos/retenciones), preload `guardarEjercicioAnual`, y sección en Reportes con año seleccionable, informe con conciliación visible, token contra respuestas tardías y advertencia permanente de soporte INTERNO (NO declaración F-11, sin deducibilidad ni impuesto, sin convertir desconocidos en 0 ni inventar tasas). Prueba de aceptación: operaciones antes/dentro/después del año, ajuste, anulación con reverso, retención, cierre y reapertura — resultado ordinario 80.00 con cierre 0.00, conciliación OK contra consulta independiente, saldos acumulados incluyen 2025, reapertura mantiene 80.00, archivos con cifras visibles. Bug propio encontrado y corregido durante la prueba: `NOT (origen_tipo = 'cierre')` es NULL para reversos (origen NULL) y los excluía por error — corregido con `IS NULL OR !=`.
- **Manual de usuario** (`docs/MANUAL-USUARIO.md`): funciones realmente disponibles (inicio administrativo, captura/corrección por anulación, ajustes/apertura, cierre, adjuntos, respaldo/restauración, reportes/paquete/ejercicio anual, impuestos con bloqueos, bitácora), rutas Windows fuera de OneDrive, instalación/actualización conservando datos, y límites sin capacidades inventadas.
- **Preparación de actualización Windows** (`scripts/actualizar-windows.ps1`): perfil QA sintético externo, npm ci/typecheck/suite/build/NSIS/rebuild ABI por etapa, arranque verificado tras la actualización con el MISMO perfil, plan de aceptación manual (respaldo previo, instalar NSIS de paquete\, datos previos visibles, operación sintética persistente), restauración de variables y aviso de rebuild:node. NO ejecutado en Windows desde este entorno Linux (límite declarado).

### Comprobación

- `npm run typecheck` (main + preload + renderer) → sin errores.
- `npx vitest run` → 223/223 (50 archivos).
- `npm run build` → OK; `dist/preload/index.js` autocontenido.

### Inventario por capa

- **Probado en servicio y componente**: anexos F-07 1/2/3 y F-14 (matriz, catálogos, reglas conjuntas, identidad, autorización separada, nómina bloqueada), ejercicio anual (conciliación independiente), paquete del contador v2, cierre de ejercicio, respaldo/restauración, adjuntos, carrera de selecciones con token.
- **Parcial**: catálogo F-14 con la transcripción del auditor (no certificación; 01/47 bloqueados), QA Windows por scripts preparados pero no ejecutados aquí.
- **Pendiente Windows real**: instalación/actualización NSIS, recorrido gráfico offline integral, confirmación del arranque del preload empaquetado en Electron real.

## Bloque auditoría 44 (familia de cierre, subconjunto F-14 soportado, UI anual vigente, script honesto y paquete con soporte anual)

### Corregido (hallazgos de la auditoría 44)

- **P1-1 Duplicación tras anular cierre**: el ejercicio anual excluye ahora la FAMILIA de cierre por relaciones persistidas — el asiento con origen 'cierre' Y sus reversos (reverso_de_id → cierre) — sin excluir reversos ordinarios (original anulado + reverso se cancelan en el neto). La consulta de conciliación independiente aplica la misma exclusión. Prueba de aceptación completa: venta 100 → cierre (ordinario 100 / con cierre 0) → reapertura → **anular cierre** (ordinario 100 / con cierre 100, conciliación OK) → ajuste +10 → segundo cierre (ordinario 110 / con cierre 0) → reapertura de SQLite (persistentes) y LEEME con 110.00. Los asientos del informe marcan `familiaCierre` para trazabilidad.
- **P1-2 Catálogo ≠ soportado**: separado el catálogo verificado del apéndice (transcripción del auditor) del SUBCONJUNTO SOPORTADO {09, 11, 21, 42} (otras retenciones y servicios sin dependencia laboral). Bloqueados con motivo explícito: 01 y 80 (laborales → nómina sin soporte), 60 (gravados sin retención: la captura actual registra retenciones, no devengados sin retención), 70/71/72 (no gravados sin reglas), 47 (especial art. 123), y el resto verificado como 'sin captura/reglas suficientes'. Prueba: 60 y 80 se rechazan al guardar, y un registro existente mutado a 60 bloquea diagnóstico y exportación. Sin cambiar importes ni deducir ceros.
- **P2-3 Informe anual vigente**: al cambiar de año el informe viejo se limpia inmediatamente, se muestra 'Consultando ejercicio…', el informe identifica el año confirmado y el botón de exportar queda bloqueado hasta que el resultado corresponde al año visible (payload concordante). Prueba de componente: cambio pendiente (80→limpio), respuesta tardía de 2026 ignorada con 2027 visible, error limpia e inhabilita, cancelación no invoca guardado, y `guardarEjercicioAnual(2027)` solo con pantalla 2027.
- **P2-4 Script sin aprobación falsa**: `actualizar-windows.ps1` ya NO arranca Electron de desarrollo ni imprime 'Actualización verificada'. Prepara artefactos (NSIS en paquete\) e imprime el plan de aceptación MANUAL marcado PENDIENTE (sembrar perfil con versión actual, respaldar, instalar NSIS en perfil QA, abrir BINARIO INSTALADO, operación sintética persistente, comparar respaldo). Rechaza perfiles bajo OneDrive o iguales a la base operativa; guarda y restaura el valor previo de ARKON_RUTA_DATOS.

### Integración anual/paquete

- `generarPaqueteContador` incluye ahora `ejercicio-anual.csv` (resultado ordinario del año del corte, familia de cierre excluida) con NOTA explícita que lo diferencia del `estado-resultados.csv` (rango desde–hasta) y reconcilia ambos contra el mayor; LEEME del paquete lo documenta. La UI anual muestra además el detalle trazable por asiento (folio/fecha/concepto/estado/origen/total/marca familia-cierre) y las limitaciones por registro, no solo totales.

### Comprobación

- `npm run typecheck` (main + preload + renderer) → sin errores.
- `npx vitest run` → 227/227 (51 archivos).
- `npm run build` → OK; `dist/preload/index.js` autocontenido.

### Inventario corregido

- **Servicio**: ejercicio anual (familia de cierre, conciliación independiente, reapertura), códigos F-14 soportados/bloqueados, paquete con ejercicio-anual.csv.
- **Componente**: UI anual vigente (limpieza/carga/año confirmado/bloqueo de exportación/payload concordante) — pruebas de componente específicas de este bloque.
- **Pendiente Windows real**: instalación/actualización NSIS según el plan manual del script, recorrido gráfico offline, arranque del preload empaquetado en Electron real.

## Bloque auditoría 45 (herramientas reproducibles de aceptación de dos versiones y manual final)

### Añadido

- **Herramienta CLI de semilla/verificación** (`scripts/semilla-qa.ts`, compilada a `dist/scripts/semilla-qa.js`): tres modos por comandos públicos — `sembrar` (perfil sintético con contraparte, venta 100.00 sintética, adjunto con hash SHA-256, bitácora; manifiesto esperado con folio/total/hash/eventos), `respaldar` (respaldo con manifiesto SHA-256 antes de actualizar, hash y nombre persistidos en el manifiesto) y `verificar` (comprobación independiente: venta existe/total, contraparte, adjunto registrado/archivo/hash recalculado, bitácora conservada, respaldo previo presente; estados PASA/FALLA por comprobación, exit 2 si falla). Validación de rutas: ABSOLUTAS normalizadas, rechaza OneDrive y la base operativa. **Probada en este entorno Linux con perfiles sintéticos**: sembrar→respaldar→verificar PASA completo; verificación contra perfil vacío FALLA con exit 2; ruta relativa rechazada con exit 1. Etiquetada como prueba CLI separada del recorrido GUI real.
- **Script de aceptación de dos versiones** (`scripts/aceptacion-dos-versiones.ps1`): parametriza instalador anterior/nuevo, destino de instalación QA y perfil contable+Chromium exclusivos (rutas absolutas validadas, fuera de OneDrive, distintas del operativo); pasos claros: 1) sembrar con la versión ANTERIOR (GUI manual o alternativa CLI), 2) respaldo CLI, 3) instalar NSIS NUEVO sobre el mismo destino (manual), 4) verificación CLI independiente con PASA/FALLA, 5) recorrido gráfico offline con el binario instalado; rollback documentado desde el respaldo del paso 2. NO ejecuta electron.cmd para certificar; nada se aprueba solo por proceso activo; restaura el valor previo de ARKON_RUTA_DATOS; argumentos con espacios manejados por parámetros nombrados.
- **qa-windows.ps1 endurecido**: rutas absolutas normalizadas, rechazo de OneDrive y base operativa, marcador QA (`QA-MARCADOR.txt`) para reabrir el perfil existente, restauración del valor previo de ARKON_RUTA_DATOS, y nota explícita de que el proceso de desarrollo activo NO certifica el binario instalado.
- **Opción local Unsigned QA documentada**: el comando de build sin firma (`--publish never --config.win.signAndEditExecutable=false`) queda registrado en el manual como artefacto LOCAL SIN FIRMA válido solo para QA (limitación del winCodeSign por permisos de enlaces simbólicos, resuelta por el auditor sin elevar permisos); la publicación sigue prohibida.
- **Manual final ampliado** (`docs/MANUAL-USUARIO.md`): pasos reales de instalación, actualización conservando datos (respaldo previo, NSIS sobre la instalación, verificación CLI), respaldos/restauración/rollback, y **matriz de aceptación gráfica offline de 10 puntos** (apertura, captura+doble envío, anulación, adjuntos, CSV/PDF, reportes anuales, respaldo/restauración, cierre/reapertura, impuestos bloqueados, actualización) con criterios de aprobación. Sin tasas/identidades/políticas inventadas.

### Comprobación

- `npm run typecheck` (main + preload + renderer, incluye scripts) → sin errores.
- `npx vitest run` → 227/227 (51 archivos).
- `npm run build` → OK; `dist/preload/index.js` autocontenido.
- CLI ejecutado REAL en este entorno: sembrar/respaldar/verificar PASA; perfil vacío FALLA exit 2; ruta relativa rechazada exit 1.

### Límites exactos

- Este entorno es Linux: NO ejecuté el instalador NSIS, ni la instalación/actualización real, ni el recorrido gráfico. La instalación y el recorrido GUI quedan para el auditor en Windows con `scripts/aceptacion-dos-versiones.ps1` y la matriz del manual. El NSIS local sin firma del auditor (sha256 5ECE…9a08, 85,876,374 bytes) sigue siendo artefacto de QA no publicado.

## Bloque P1 arranque Windows ABI (auditoría 45, hallazgo del ejecutable REAL instalado)

### Causa y correcciones

- **Causa confirmada por el auditor**: el NSIS instalado contenía `better_sqlite3.node` compilado con ABI de Node (NODE_MODULE_VERSION 137) en lugar del ABI de Electron 33.4.11 (130); la promesa rechazada de `app.whenReady` dejaba el proceso sin ventana ni mensaje. Corregido en DOS frentes:

**1. Captura de error fatal de arranque (producto)** — `src/main/index.ts`:
- La cadena de `app.whenReady()` ahora tiene `.catch()`: error fatal → **diálogo visible** con detalle (mención explícita de NODE_MODULE_VERSION y la acción a seguir: regenerar instalador con el ABI correcto) → `app.exit(1)` de forma controlada (sin bloqueo de instancia silencioso); si el diálogo no está disponible (arranque temprano), se registra en stderr antes de salir.
- `process.on('uncaughtException')`: registra en stderr + `dialog.showErrorBox` + salida controlada.
- El error de recuperación pendiente reutiliza el mismo diálogo (sin require dinámico).

**2. Pipeline reproducible de ABI (guardas reales)**:
- `scripts/rebuild-electron.mjs`: reconstrucción EXPLÍCITA para el runtime de Electron (por defecto 33.4.11/x64/win32, parametrizable) con `prebuild-install` y fallback a `npm rebuild --runtime=electron`; registra el hash SHA-256 del binario en `abi-electron.json`.
- `scripts/probe-electron-abi.mjs`: **PROBE con Electron REAL antes de empaquetar** — carga better-sqlite3 dentro de Electron, abre SQLite `:memory:`, INSERT/SELECT; si el ABI no corresponde, el pipeline FALLA (exit 2) y no se empaqueta; registra resultado en `probe-electron.json`.
- `scripts/verificar-abi-artefacto.mjs`: tras el NSIS, localiza `better_sqlite3.node` **dentro del artefacto desempaquetado** (win-unpacked) y compara su SHA-256 contra el registrado por el probe — detecta cualquier mezcla de ABI Node/Electron dentro del paquete.
- `npm run dist:win:qa`: pipeline completo en orden obligatorio **rebuild:electron → probe → build → NSIS → verificación de artefacto**; falla en cualquier paso sin generar instalador.
- `electron-builder.yml`: **`npmRebuild: false`** documentado — electron-builder NO debe reconstruir contra el ABI de Node y sobrescribir el binario ya probado con Electron.
- Manual actualizado con el pipeline, la advertencia de no mezclar ABI (no ejecutar `rebuild:node` entre el probe y el empaquetado) y el diagnóstico del diálogo de arranque.

### Pruebas

- `pruebas/probeElectron.prueba.ts` (3 pruebas en la suite oficial): orden obligatorio del pipeline dist:win:qa; `npmRebuild: false` presente; y ejecución real del binario de Electron con el script del probe — en este sandbox Linux Electron no carga por bibliotecas gráficas ausentes (libglib), limitación detectada y documentada en la propia prueba; si el entorno puede ejecutar Electron, el probe es concluyente (PASA o falla controlada con NODE_MODULE_VERSION).

### Comprobación

- `npm run typecheck` → sin errores.
- `npx vitest run` → 230/230 (52 archivos).
- `npm run build` → OK; `dist/preload/index.js` autocontenido.

### Límites exactos

- Este sandbox es Linux sin bibliotecas gráficas de Electron: NO ejecuté el probe con Electron real ni el NSIS. El pipeline queda listo para tu verificación en Windows: `npm run dist:win:qa` (rebuild→probe→NSIS→verificación de artefacto con hashes) y arranque del instalado en perfil QA — el fallo de arranque ahora será un diálogo visible con NODE_MODULE_VERSION en lugar de un proceso silencioso. Tu mitigación local (prebuild-install electron 33.4.11, native SHA 359CBD…B17, probe PASA) coincide con el pipeline automatizado.

## Bloque auditoría 46 (rutas de build, pipeline ABI funcional, guardas QA y verificación real del respaldo)

### Corregido (hallazgos de la auditoría 46)

- **P1-1 Rutas de build**: `tsconfig.node.json` vuelve a `rootDir: src` (solo main+shared) y los scripts CLI tienen su propio `tsconfig.scripts.json` (rootDir '.', incluye src para los imports). `npm run build` ahora termina con `build:cli` (tsc de scripts a dist) de modo que **desde salida vacía** se producen `dist/main/index.js` (entrypoint real, alineado con `package.json.main`), `dist/preload/index.js` (bundle empaquetado) y `dist/scripts/semilla-qa.js` — sin depender del dist previo. Prueba oficial de alineación de rutas incluida.
- **P1-2 Pipeline ABI funcional**: `rebuild-electron.mjs` ejecuta prebuild-install **desde el directorio de la dependencia** (node_modules/better-sqlite3 — el CLI lee el package.json del cwd, como tu mitigación probada); `probe-electron-abi.mjs` usa el **binario real** (`node_modules/electron/dist/electron.exe` en Windows, no el .cmd que daba spawn EINVAL) con harness de perfil QA exclusivo, timeout de 60 s, y registra versión/ABI/hash realmente cargados en `probe-electron.json`; `verificar-abi-artefacto.mjs` exige `probe-electron.json` con resultado PASA además del hash — un `abi-electron.json` declarado solo ya NO basta (tu fixture con binario NODE137 y registro declarado ahora termina exit 2). `dist:win` estándar redirige a `distwin-guard.mjs`: rechaza empaquetar sin probe exitoso o con probe de más de 30 minutos (evita reinstalar Node137 tras la suite) y NO empaqueta por sí solo; el empaquetado real es `dist:win:qa` (rebuild→probe→build→NSIS→verificación de artefacto).
- **P1-3 Guardas QA**: normalización de rutas **case-insensitive** (minúsculas + barras normalizadas: 'arkon contabilidad' === 'ARKON Contabilidad' en Windows), exclusión de la base operativa **y sus subrutas** y de OneDrive, aplicada también al manifiesto; marcador QA (`QA-MARCADOR-ARKON.txt`) se crea SOLO en un perfil nuevo vacío — un perfil existente con contenido y sin marcador se rechaza antes de abrir SQLite; respaldar/verificar exigen marcador válido (contenido falso → rechazo). Todo probado con fixtures ejecutables.
- **P2-4 Verificación real del respaldo**: `verificar` recalcula el SHA-256 del archivo de respaldo contra el registrado (corrupción → FALLA exit 2, comprobado), valida el manifiesto del respaldo y su hash, y abre la base **en modo readonly sin aplicar migraciones** (rutas calculadas sin crear directorios) — una base ausente da FALLA sin recrear nada (lectura pura, no recomposición). Bitácora, adjuntos y hash de adjunto verificados contra el manifiesto.

### Pruebas ejecutables (no contains sobre texto)

- `pruebas/guardasPipeline.prueba.ts` (8 pruebas en suite oficial): perfil existente sin marcador rechazado sin abrir SQLite; marcador válido requerido para respaldar/verificar; marcador falso rechazado; **respaldo corrompido → FALLA exit 2 con hash verificado**; verificación readonly que no recrea la base; ruta relativa, base operativa case-insensitive y subrutas rechazadas; guarda dist:win sin probe y con probe caducado (exit 2); verificador de artefacto rechazado sin probe-electron.json aunque abi-electron.json declare el hash; alineación de entrypoint/tsconfig.
- `pruebas/probeElectron.prueba.ts` actualizada al binario real (`electron/dist/electron.exe` en Windows) — en este sandbox Linux el binario existe pero no carga (libglib); la prueba detecta esa limitación del entorno y pasa solo si el probe es concluyente o la limitación está documentada.

### Comprobación

- `npm run typecheck` (4 proyectos: node/preload/renderer/scripts) → sin errores.
- `npm run build` desde dist vacío → `dist/main/index.js` + `dist/preload/index.js` (bundle) + `dist/scripts/semilla-qa.js`.
- `npx vitest run` → 238/238 (53 archivos).
- CLI ejecutado real: sembrar/respaldar/verificar PASA; respaldo corrompido → FALLA exit 2; perfil existente sin marcador → rechazo exit 1; base operativa case-insensitive y subrutas → rechazo.

### Límites exactos

- Sandbox Linux sin bibliotecas gráficas de Electron: NO ejecuté el probe con Electron real ni el NSIS. El pipeline queda para tu verificación en Windows: `npm run dist:win:qa` y arranque del instalado. La instalación corregida 45 (Electron130) que ya abre NO debe reinstalarse con artefactos sin verificar.

## Bloque auditoría 47 (harness funcional del probe, vínculo probe↔binario, guardas PowerShell y hash de bitácora)

### Corregido (hallazgos de la auditoría 47)

- **P1-1 Harness funcional del probe**: eliminado `node scripts/build:cli` inexistente de dist:win:qa (npm run build ya lo incluye). El probe reescrito con la estrategia comprobada en Windows: genera un **archivo .cjs** con `require('electron')`, `app.setPath('userData', perfil)` a un **directorio temporal exclusivo bajo os.tmpdir()** (nunca process.cwd()/OneDrive), `app.whenReady().then(...)` que hace `require(rutaAbsoluta del módulo)`, SQLite `:memory:` con INSERT/SELECT, y escribe el **resultado en JSON** (ok, versionElectron, abi, hashNative cargado) que el wrapper espera/valida con timeout de 90 s — sin depender de console.log del exe GUI ni de ELECTRON_NO_ATTACH_CONSOLE. El wrapper verifica además que el hash del native cargado coincida con el del disco (detecta cambios durante el probe) y registra todo en probe-electron.json.
- **P1-2 Vínculo probe↔binario actual↔artefacto**: probe-electron.json ahora guarda `hashNative` (hash del módulo realmente cargado); el verificador de artefacto Y la guarda dist:win comparan ese hash contra el **binario actual del disco** — un probe PASA/ABI130 previo con un binario Node137 nuevo en disco termina exit 2 ('native del disco cambió tras el probe'), sin importar la ventana de 30 min. La cadena es probe.hashNative == disco.hash == abi-electron.json.sha256 == artefacto.hash. dist:win nunca afirma distribución: redirige con instrucción clara y no empaqueta.
- **P1-3 Guardas PowerShell alineadas**: `ValidarRuta` de aceptacion-dos-versiones.ps1 ahora excluye la base operativa **y sus descendientes** con comparación case-insensitive (ToLowerInvariant); qa-windows.ps1 usa el **marcador único QA-MARCADOR-ARKON.txt** alineado con el CLI, solo crea el marcador en un perfil nuevo vacío y rechaza perfiles existentes sin marcador válido (no marca perfiles de origen desconocido); misma exclusión case-insensitive de operativo/subrutas.
- **P2-4 Hash de bitácora**: el manifiesto captura `eventosHash` (SHA-256 de id|tipo|entidad|entidadId|detalle de los eventos sembrados en orden ascendente); `verificar` recalcula ese hash sobre los N eventos de menor id — **bitácora alterada con la MISMA cantidad → FALLA exit 2** (comprobado ejecutando UPDATE del detalle), eventos adicionales legítimos posteriores no afectan. La verificación sigue siendo readonly sin migraciones y sin crear directorios (rutas calculadas a mano). Cierre del respaldo corrupto conservado.

### Pruebas ejecutables

- `pruebas/guardasPipeline.prueba.ts` (11 pruebas): las 8 previas más — bitácora alterada con misma cantidad → FALLA exit 2 con hash de contenido verificado; probe PASA previo con hash de OTRO binario → guarda y verificador fallan (vínculo probe↔disco); dist:win:qa sin referencias a scripts inexistentes. Todas ejecutan el CLI/guardas reales contra fixtures sintéticos con exit codes verificados.

### Comprobación

- `npm run typecheck` (4 proyectos) → sin errores.
- `npx vitest run` → 241/241 (53 archivos).
- `npm run build` → OK; CLI compilado incluido.
- CLI ejecutado real: bitácora intacta PASA / alterada FALLA exit 2; respaldo corrupto FALLA exit 2 (conservado).

### Límites exactos

- Sandbox Linux sin bibliotecas gráficas de Electron: NO ejecuté el probe con Electron real ni el NSIS. El harness .cjs+JSON está listo para tu verificación en Windows con `npm run dist:win:qa`. La instalación 45 (Electron130, ya abre) no debe reinstalarse con artefactos sin verificar.

## Bloque auditoría 48 (harness de prueba CJS/JSON, cero escritura en verificar, scripts PowerShell conectados al pipeline real y typecheck ejecutable)

### Corregido (hallazgos de la auditoría 48)

1. **prueba del probe reescrita con harness CJS/JSON**: el test antiguo (`electron -e` sin timeout, aceptando PROBE_ABI_FALLA como aprobado) fue SUSTITUIDO. El nuevo harness genera un archivo .cjs en directorio temporal externo (os.tmpdir), detecta runtime (Electron en Windows con `app.setPath`/`whenReady`; Node en Linux por bibliotecas gráficas ausentes), carga el módulo por ruta absoluta, SQLite :memory: con INSERT/SELECT, escribe resultado en JSON y cierra con timeout garantizado. Pruebas separadas: **POSITIVO** (módulo real → ok:true con ABI y versión reportados) y **NEGATIVO** (binario .node sintético → ok:false con error, salida controlada). Sin atribuir avisos del propietario sin evidencia.
2. **Cero escritura en verificar**: eliminada la última llamada a `prepararRutasDatos` (que hace mkdir de raiz/datos/adjuntos/respaldos/registros); las rutas se calculan a mano. Prueba ejecutable del repro del auditor: retirar registros/respaldos vacíos de un perfil sembrado → verificar PASA exit 0 y **el árbol no se modifica** (carpetas NO recreadas, listado idéntico antes/después).
3. **Scripts PowerShell conectados al pipeline real**: `qa-windows.ps1 -ConInstalador` y `actualizar-windows.ps1` ahora ejecutan `npm run dist:win:qa` (rebuild→probe→build→NSIS→verificación de artefacto) y **exigen el artefacto NSIS con hash SHA-256** antes de anunciar éxito — si dist:win:qa termina sin instalador en paquete\, terminan con error inequívoco. El camino de desarrollo usa `rebuild-electron.mjs` + `probe-electron-abi.mjs` verificados (no install-app-deps suelto; eliminado el paso redundante de actualizar-windows). `actualizar-windows.ps1` audita guardas/marcador igual que qa-windows (case-insensitive, operativo+descendientes, marcador único solo en perfil nuevo vacío).
4. **Typecheck ejecutable**: la propiedad raíz `typecheck` (no ejecutable) fue eliminada; `scripts.typecheck` ahora incluye los 4 proyectos (node/preload/renderer/scripts). Prueba de suite verifica `pkg.typecheck === undefined` y `scripts.typecheck` contiene tsconfig.scripts.json.

### Comprobación

- `npm run typecheck` (4 proyectos, entrada ejecutable) → sin errores.
- `npx vitest run` → 242/242 (53 archivos).
- `npm run build` → OK; CLI compilado incluido.
- CLI ejecutado real: verificar con registros/respaldos retirados → PASA exit 0 sin recrear carpetas.

### Límites exactos

- Sandbox Linux: el harness de prueba valida el mecanismo CJS/JSON con Node (ABI 127); el POSITIVO con Electron real se ejecuta en Windows (donde el producto probe ya pasó según tu verificación). Instalación/actualización/recorrido offline Windows siguen pendientes de tu QA real de dos versiones.

## Bloque auditoría 49 (aislamiento Node/Electron en la suite, normalización de rutas, compilación previa y documentación alineada)

### Corregido (hallazgos de la auditoría 49)

1. **Aislamiento Node/Electron en la suite**: el POSITIVO de `probeElectron.prueba.ts` es ahora una **prueba de mecanismo en Node en todos los SO** — valida que el harness CJS/JSON carga el módulo del ABI *actual* (el de Node tras `npm test`, ABI 137) con `abi === process.versions.modules` y `versionRuntime === process.versions.node`, sin intentar cargar en Electron un binario de Node (el fallo en Windows). La **integración con Electron real** queda en el producto (`scripts/probe-electron-abi.mjs`) que se ejecuta DESPUÉS del rebuild explícito — nunca reconstruyendo para Electron antes de la suite. El NEGATIVO (binario sintético) sigue siendo real. Todo el userdata del test vive dentro del directorio temporal propio del test (eliminado el hermano con PID del worker); timeout y cierre garantizados.
2. **Normalización en actualizar-windows.ps1**: `IsPathRooted` + `GetFullPath` del Perfil ANTES de las exclusiones — `base/../ARKON Contabilidad` (desvío) ahora coincide con el operativo tras normalizar y se rechaza, igual que subrutas y OneDrive; la normalización ocurre antes de mkdir/marcador. Misma validación que aceptacion-dos-versiones.
3. **Compilación previa a la suite**: `qa-windows.ps1` y `actualizar-windows.ps1` compilan `build:main` y `build:cli` ANTES de `npm test` (las pruebas dependientes de dist fallaban en checkout limpio); `aceptacion-dos-versiones.ps1` usa `npm run build:cli` (tsconfig.scripts) en lugar del obsoleto `tsc -p tsconfig.node.json --outDir dist` que ya no incluye scripts.
4. **Documentación alineada**: PENDIENTES y QA-WINDOWS ya no referencian `dist:win` sin pipeline (solo `dist:win:qa` con guardas o `distwin-guard`); eliminado el carácter de control del manual; instrucciones de preparación/empaquetado/instalación/aceptación alineadas con el pipeline verificado.

### Pruebas

- `guardasPipeline.prueba.ts` (16 pruebas): las 12 previas más 4 nuevas — orden IsPathRooted→GetFullPath→exclusiones en actualizar-windows; build:main/build:cli antes de npm test en ambos scripts; aceptación usa build:cli y no tsconfig.node; documentación sin dist:win sin pipeline y sin caracteres de control. `probeElectron.prueba.ts` (3): mecanismo POSITIVO en Node (ABI actual verificado), NEGATIVO real, orden del pipeline.

### Comprobación

- `npm run typecheck` (4 proyectos) → sin errores.
- `npx vitest run` → 246/246 (53 archivos).
- `npm run build` → OK; CLI compilado.

### Límites exactos

- Sandbox Linux: la prueba de mecanismo corre con Node; la integración con Electron real (positivo ABI130) es el producto probe verificado por ti en Windows (48). Instalación/actualización/recorrido offline Windows siguen pendientes de tu QA real de dos versiones. No se tocó la app abierta ni la base del propietario.

## Bloque auditoría 50 (corrección exacta del ejecutable del harness de mecanismo)

### Corregido

- **P1 POSITIVO en Windows**: la bifurcación real del ejecutable en `ejecutarHarness` (`usarElectron = process.platform === win32 && existsSync(electronExe)` → `comando = usarElectron ? electronExe : process.execPath`) fue ELIMINADA: el harness de mecanismo lanza **`process.execPath` (Node) en TODOS los SO**, sin condición de plataforma. En Windows ya no intenta cargar el native Node137 (ABI de la suite) dentro de Electron130 — la causa exacta de las dos caídas 49/50. La integración con Electron real permanece ÚNICAMENTE en el producto (`scripts/probe-electron-abi.mjs`) después del rebuild explícito (ya verificado por el auditor: Electron 33.4.11/ABI130, probe PASA).
- **Guarda de regresión añadida** (4ª prueba del archivo): verifica que el archivo de prueba contiene `const comando = process.execPath;` y que NO existen las asignaciones `const usarElectron =` ni `comando = usarElectron` — impide que una futura edición reintroduzca la bifurcación sin que la suite lo detecte. El POSITIVO exige ok:true con ABI de Node y versión de Node; el NEGATIVO (binario sintético) sigue rechazado como error.

### Comprobación

- `npm run typecheck` (4 proyectos) → sin errores.
- `npx vitest run` → 247/247 (53 archivos), incluido el POSITIVO del mecanismo que ahora lanza Node sin bifurcación.
- `npm run build` → OK.

### Límites exactos

- Sandbox Linux: la prueba de mecanismo corre con Node (ABI 127 aquí); en Windows correrá con Node (ABI 137 de la suite) — en ambos casos con el runtime que coincide con el native reconstruido por `npm test`. La integración Electron130 es el producto probe (verificado por el auditor en 48/50). QA real de dos versiones del auditor en curso (instalación/actualización con datos sintéticos conservados: 93 filas/24 tablas/1 adjunto con hash, CLI verificar PASA); recorrido offline integral sigue pendiente.

## Bloque auditoría 51 (diálogo de anulación en Ventas y Compras)

### Corregido (P1 de la auditoría 51)

- **Diálogo de anulación en Ventas** (`src/renderer/vistas/Ventas.tsx`): el botón Anular ya NO invoca el comando directamente — abre un diálogo que identifica folio, importe ($totalMinor), saldo y efecto (reverso contable con motivo/responsable en bitácora), con campos **Motivo de la anulación** (obligatorio, sin texto automático) y **Responsable** (pre-cargado del campo general, editable). Confirmar una sola vez con estado ocupado ('Anulando…' deshabilita el botón); **Cancelar cierra el diálogo sin invocar el comando ni cambiar datos, saldos o bitácora**. Tras éxito: aviso «Venta {folio} anulada con reverso contable; motivo registrado en bitácora», recarga de documentos (estado actualizado a 'anulada') y reemplazo del mensaje anterior «Venta reconocida». Rechazo del motor visible como error, sin aviso de anulación. Motor sin relajar: `documento:anular` conserva las validaciones de documentos/aplicaciones/pagos.
- **Diálogo de anulación en Compras** (`src/renderer/vistas/Compras.tsx`): mismo recorrido completo con folio/importe/saldo/efecto, motivo y responsable obligatorios, cancelar sin efectos, ocupado, aviso de anulación y recarga.

### Pruebas de componente/contrato (`pruebas/anulacionComponente.prueba.tsx`, 4 pruebas)

1. **Abrir/cancelar sin invocación**: clic en Anular muestra el diálogo con folio/importe/efecto; `documento:anular` NO invocado; Cancelar cierra sin invocación.
2. **Faltan motivo/responsable**: submit sin motivo → «La anulación exige un motivo significativo» sin invocar; con motivo y sin responsable → «La anulación exige responsable» sin invocar.
3. **Confirmación y doble envío**: submit con motivo/responsable → UNA sola llamada a `documento:anular` con payload completo (tipo/documentoId/motivo/responsable capturados); doble submit → idempotencia por estado ocupado; aviso de anulación visible y estado actualizado.
4. **Rechazo del motor**: error del motor visible («cobros aplicados»), sin aviso de anulación.

### Comprobación

- `npm run typecheck` (4 proyectos) → sin errores.
- `npx vitest run` → 251/251 (54 archivos).
- `npm run build` → OK; preload autocontenido.

### Manual y matriz actualizados

- MANUAL-USUARIO.md: la corrección se describe como anulación con diálogo (folio/importe/efecto, motivo y responsable obligatorios, cancelar sin cambios).
- Matriz de aceptación fila 3: criterio actualizado con diálogo, aviso visible y motivo capturado.

### Inventario GUI pendiente (concreto)

- PDF de cotización, paquete del contador, adjuntos y negativo de hash, respaldo periódico/restauración/reapertura, cierre/reapertura — recorridos reales que el auditor ejecuta con datos sintéticos externos. Linux no sustituye la GUI Windows.

## Bloque auditoría 52 (diálogo en CajaBancos, mensajes visibles, motivo mínimo 10 caracteres, cobertura integrada)

### Corregido (hallazgos de la auditoría 52)

- **P1-1 CajaBancos**: el botón Anular ya NO invoca `tesoreria:anular` directamente — abre un **diálogo** con folio, tipo (cobro/pago/transferencia), monto ($montoMinor), contraparte y efecto (reverso contable que cancela el movimiento y libera las aplicaciones). Campos **Motivo de la anulación** (obligatorio, sin texto automático) y **Responsable** (pre-cargado, editable). Cancelar sin efectos; confirmación única con estado ocupado; rechazo del motor visible; aviso tras éxito con scrollIntoView.
- **P2-2 Mensajes visibles**: en Ventas, Compras y CajaBancos, el error de validación y el rechazo del motor se muestran **dentro del diálogo** con `role="alert"`; tras éxito, el aviso se lleva a la vista con `scrollIntoView({block:'center'})` vía `avisoRef`. El prefijo técnico `Error invoking remote method 'arkon': Error:` se elimina con `limpiarMensajeError()` antes de mostrar.
- **P2-3 Motivo mínimo 10 caracteres**: validado en la vista (`motivoAnular.trim().length < 10`) y en el motor (`documento:anular` y `tesoreria:anular` en comandos.ts) con mensaje «La anulación exige un motivo significativo (mínimo 10 caracteres).». No se tocan `asiento:anular` ni `cotizacion:anular`.
- **P2-4 Cobertura y documentación**: `pruebas/anulacionIntegracion.prueba.tsx` (6 pruebas) con **despachar real sobre SQLite temporal** para Ventas, Compras y CajaBancos — el mock de `api().invocar` delega al `despachar` real, verificando estado, reverso y bitácora en cada caso: venta anulada con reverso y motivo capturado; motivo corto rechazado por el motor sin cambiar estado; compra anulada con reverso; cobro aplicado a venta 113.00 → anulado → saldo vuelve a 113.00 y bitácora con motivo; cancelar cobro sin efectos; pago anulado. docs/PENDIENTES: eliminada la línea desfasada sobre pruebas de interfaz. Manual y matriz actualizados con Caja y bancos.

### Comprobación

- `npm run typecheck` (4 proyectos) → sin errores.
- `npx vitest run` → 257/257 (55 archivos).
- `npm run build` → OK.

### Límites

- Sandbox Linux: jsdom no sustituye el recorrido GUI Windows. El auditor mantiene su inventario GUI (PDF, paquete, adjuntos, respaldo periódico, cierre/reapertura) y el artefacto nuevo con diálogos está pendiente de su verificación.

## Bloque auditoría 53 (exit 0 sin errores no capturados, aviso único, cobertura completa del diálogo de anulación)

### Corregido (hallazgos de la auditoría 53)

- **P1-1 Suite exit 0**: `scrollIntoView` ahora se guarda con `typeof === 'function'` antes de llamarlo (jsdom no lo implementa) — los 5 errores no capturados (`TypeError: scrollIntoView is not a function`) eliminados. `npx vitest run` termina con **exit 0, 260/260, 0 Errors**.
- **P2-2 Aviso duplicado en CajaBancos**: el párrafo adicional al final fue eliminado; `avisoRef` se movió al párrafo original del mensaje — **un solo aviso en el DOM** para anulación y para cualquier mensaje de la vista. Prueba que cuenta exactamente 1 aviso tras anular COB-000001.
- **P2-3 Cobertura completa**: `anulacionIntegracion.prueba.tsx` ahora con **9 pruebas**: venta anulada con scrollIntoView verificado con espía real (`Element.prototype.scrollIntoView = vi.fn()` + `toHaveBeenCalledWith({block:'center'})`); **rechazo del motor por cobro aplicado con error dentro del diálogo** (`within(screen.getByRole('dialog')).getByRole('alert')` con texto sin prefijo técnico); compra anulada; cobro aplicado a venta 113.00 → anulado → saldo 113.00 con **exactamente 1 aviso**; cancelar cobro sin efectos; **transferencia anulada** con despachar real (estado, reverso, bitácora con motivo); **motivo corto por comando directo** en `documento:anular` y `tesoreria:anular` (renombrado para decir lo que comprueba). `anulacionComponente.prueba.tsx` actualizada con espía scrollIntoView, errores con `within(dialog).getByRole('alert')`, y rechazo del motor dentro del diálogo sin prefijo.
- **P2-4 Manual y matriz**: MANUAL-USUARIO.md describe la anulación con diálogo en Ventas/Compras/Caja y bancos, motivo mínimo 10 caracteres, errores dentro del diálogo; matriz con fila 3 (documentos) y fila 3b (movimientos: cobro/pago/transferencia).

### Comprobación

- `npm run typecheck` (4 proyectos) → sin errores.
- `npx vitest run` → **exit 0, 260/260, 0 Errors** (55 archivos).
- `npm run build` → OK.

### Límites

- jsdom no sustituye el recorrido GUI Windows. El auditor mantiene su inventario GUI (PDF, paquete, recierre, artefacto nuevo con diálogos).

## Bloque auditoría 54 (cobertura de pruebas en Compras/CajaBancos y errata)

### Corregido (hallazgos de la auditoría 54)

- **P2-1 Cobertura extendida** (`anulacionIntegracion.prueba.tsx`, ahora 12 pruebas):
  - **Compras**: scrollIntoView con espía tras anular; **rechazo del motor por pago aplicado** con error dentro del diálogo (`within(getByRole('dialog')).getByRole('alert')`) sin prefijo técnico.
  - **CajaBancos**: **rechazo real con diálogo abierto** — anulación por detrás con despachar mientras el diálogo está abierto → confirmar → «ya está anulado» dentro del diálogo sin prefijo; scrollIntoView verificado tras anular cobro, pago y transferencia; **exactamente 1 aviso** tras anular transferencia y tras registrar transferencia por la vista (con selección real de cuentas por label).
- **P2-2 Errata**: «contrapente» → «contraparte» en MANUAL-USUARIO.md fila 3b.

### Comprobación

- `npm run typecheck` (4 proyectos) → sin errores.
- `npx vitest run` → **exit 0, 263/263, 0 Errors** (55 archivos).
- `npm run build` → OK.
