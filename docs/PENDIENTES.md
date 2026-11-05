# PENDIENTES

## Decisiones del propietario (no bloquean el desarrollo)

- Forma jurídica futura, razón social y responsable legal.
- Titularidad de las operaciones administrativas actuales.
- Fechas de constitución, inscripción IVA y otras vigencias.
- Identificaciones y autorizaciones aplicables (NRC, NIT).
- Catálogo, manual y políticas aprobados por el contador responsable.
- Fecha de inicio del sistema y saldos de apertura documentados.
- Cuentas de caja y bancos reales; participantes; reglas de aportes y distribuciones.
- Tratamiento de anticipos, materiales del cliente, contratos, retenciones, activos y personal.
- Obligaciones municipales, laborales y tributarias efectivamente aplicables.
- Destino de respaldo externo y responsable de comprobar la recuperación.

## Verificaciones técnicas pendientes

- Generar y probar el instalador NSIS en Windows (el sandbox de desarrollo es Linux): instalación, apertura, recorrido de flujos y desinstalación/actualización sin internet.
- Recorrido de los flujos principales en el ejecutable empaquetado (aquí solo se verificó empaquetado `--dir` y pruebas del motor): captura con idempotencia, anulación con diálogo, respaldo y restauración desde la interfaz.
- Pruebas automatizadas de los recorridos de interfaz (requieren entorno de UI; hoy la lógica está probada a nivel de servicios).
- Confirmar la ruta efectiva de datos en Windows (`%LOCALAPPDATA%\ARKON Contabilidad`) fuera de OneDrive.
- Nota de flujo: `dist:win` reconstruye better-sqlite3 contra Electron; ejecutar `npm run rebuild:node` antes de `npm test` (ya incluido en el script `test`).

## Inventario de pendientes (actualizado contra el codigo)

### Terminado y probado (evidencia en ESTADO_IMPLEMENTACION.md)

- Partida doble, importes exactos, periodos, idempotencia, proteccion persistente, bitacora, respaldo/restauracion con manifiesto y descubrimiento desde disco.
- Contrapartes (crear, editar, desactivar/activar sin borrar identidad), catalogo de servicios/materiales (crear, editar, desactivar, sin precios inventados), cotizaciones versionadas con congelamiento y documento imprimible, proyectos, ventas, compras, cobros/pagos con aplicaciones y anticipos aplicables, transferencias internas.
- Vigencias del perfil tributario, IVA incluido/separado, clasificacion documental con completado auditado, libros mensuales, conciliacion por tratamiento, retenciones como control, exportacion interna CSV (pantalla y archivo), estado de resultados mensual, rentabilidad por proyecto coherente con el mayor.

### Pendiente (por bloque, sin dependencias externas salvo las indicadas)

- **Recuperacion y documentos de respaldo**: COMPLETADO a nivel de servicios, contrato IPC e interfaz (adjuntos con dialogo nativo, respaldos automaticos previos a migraciones y periodicos con politica configurable, restauracion coordinada con deteccion de interrupciones, verificacion de hashes e inventario registro por registro, arranque bloqueado ante conjuntos no verificables). Pendiente: recorrido grafico de restauracion en el ejecutable Windows.
- **Reportes, auxiliares y cierre**: auxiliares con conciliacion al mayor, detalle por documento con corte temporal y exportacion CSV por dialogo nativo con corte/seleccion transportados (resumen identificado como actual) — COMPLETADO (auditorias 31-32). Vista de ajustes con soporte obligatorio, cuadre e idempotencia, selector Ajuste/Apertura — COMPLETADA. Apertura documentada y cierre de ejercicio con prevalidacion, asiento de resultados hacia 3201, bloqueo de diciembre, reapertura auditada y continuidad por el mayor — COMPLETADO (auditoria 32, ver ESTADO_IMPLEMENTACION). Pendiente: activacion formal de politicas por el contador; recorrido grafico en ejecutable Windows.
- **Adaptacion fiscal**: exportadores oficiales verificados contra especificacion vigente (F-07/F-14, libros, F-11); hecho generador fiscal de anticipos (requiere politica del contador; hoy 'pendiente' sin efecto automatico); clasificacion tributaria documental completa.
- **Instalacion y recorrido Windows**: instalador NSIS, actualizacion, recorrido grafico sin internet (captura, doble envio, anulaciones, varias copias de respaldo, seleccion, restauracion, guardado de CSV y PDF via dialogos nativos). El entorno de desarrollo es Linux: lo que no requiera Windows se completa desde aqui y se entregan scripts y pasos exactos.
