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
- Recorrido de los flujos principales en el ejecutable empaquetado (aquí solo se verificó empaquetado `--dir` y pruebas del motor).
- Confirmar la ruta efectiva de datos en Windows (`%LOCALAPPDATA%\ARKON Contabilidad`) fuera de OneDrive.
- Nota de flujo: `dist:win` reconstruye better-sqlite3 contra Electron; ejecutar `npm run rebuild:node` antes de `npm test` (ya incluido en el script `test`).

## Desarrollo por hitos (siguientes)

- Hito 2 — Integridad y recuperación: ya cubierto en buena parte (importes, partida doble, períodos, idempotencia, bitácora, respaldo/restauración) con pruebas; falta respaldo de adjuntos coordinado cuando existan adjuntos.
- Hito 3 — Operación comercial: contrapartes CRUD, catálogo de servicios/materiales (vacío), cotizaciones versionadas, proyectos, compras, CxC/CxP, cobros y pagos con tabla de aplicaciones.
- Hito 4 — Adaptación salvadoreña: perfil por vigencia, motor fiscal por línea, anticipos, retenciones, libros de IVA y conciliaciones.
- Hito 5 — Reportes y cierre: estados financieros completos, auxiliares, rentabilidad por proyecto, ajustes y cierre mensual/anual.
- Hito 6 — Exportaciones e instalación: exportadores fiscales verificados por versión, paquete para el contador, manual, instalador comprobado.
