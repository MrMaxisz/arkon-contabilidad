# ARKON Contabilidad — Manual de usuario (funciones realmente disponibles)

Sistema contable local de escritorio para control **administrativo** de ARKON Ingeniería Eléctrica.
ARKON **no está constituida** como entidad jurídica ni inscrita como contribuyente de IVA: toda la
información es de control interno y **ningún anexo fiscal se presenta** sin la activación formal
que decida el contador responsable.

## Instalación y datos

- Los datos se guardan en `%LOCALAPPDATA%\ARKON Contabilidad\` (fuera de OneDrive): `datos\` (base
  SQLite), `adjuntos\`, `respaldos\` y `registros\`. Para QA existe la variable `ARKON_RUTA_DATOS`
  que redirige SOLO el perfil de pruebas (ver `docs/QA-WINDOWS.md`).
- Instalación: ejecutar el instalador NSIS generado en `paquete\` (`npm run dist:win:qa`). La
  actualización instala sobre la versión anterior **conservando los datos** del perfil; se recomienda
  crear un respaldo manual antes (botón "Crear respaldo ahora" en la vista Respaldo).
- Sin internet: todas las funciones son locales; no hay telemetría ni servicios en línea.

## Funciones disponibles

1. **Inicio administrativo**: captura de contrapartes (clientes/proveedores), catálogo de
   servicios/materiales (sin precios inventados), cotizaciones versionadas con PDF, y proyectos.
2. **Captura y corrección**: ventas, compras con líneas por tratamiento (gravado/exento/no sujeto),
   cobros y pagos con aplicaciones e anticipos, transferencias internas. La corrección de un documento
   o movimiento registrado se hace por **anulación con diálogo** (Ventas, Compras y Caja y bancos):
   el botón Anular abre una confirmación que identifica folio, tipo, importe, contraparte y efecto
   (reverso contable), exige **motivo significativo de mínimo 10 caracteres** y responsable antes de
   invocar el comando; Cancelar o Escape no cambian datos ni bitácora. Los errores de validación y los
   rechazos del motor aparecen **dentro del diálogo**; tras confirmar se muestra el aviso de anulación
   en la vista y el estado/saldos se actualizan; no se editan importes contabilizados.
3. **Ajustes y apertura** (vista Ajustes): asientos manuales y de apertura con referencia de soporte
   obligatoria, cuadre e idempotencia.
4. **Cierre de ejercicio** (vista Cierre): estado del ejercicio, cierre con prevalidación y bloqueo
   central (las operaciones retroactivas se rechazan), reapertura auditada.
5. **Adjuntos** (vista Respaldo): registro con selector de documento real, verificación de hash y
   apertura con la aplicación del sistema.
6. **Respaldo y restauración**: respaldo manual con manifiesto SHA-256, respaldo periódico configurable
   y restauración que conserva copia del estado anterior.
7. **Reportes**: auxiliares de clientes/proveedores/caja con corte temporal, exportación CSV nativa,
   paquete del contador (carpeta con cuentas, auxiliares, resultados, asientos y conciliaciones al
   corte) y **soporte interno del ejercicio anual** (NO es declaración F-11).
8. **Impuestos**: libros, conciliaciones, retenciones como control interno, y anexos F-07/F-14 con
   **diagnóstico** y bloqueo de presentación hasta la activación formal (vigencias con IVA inscrito u
   obligación F-14). El sistema nunca elige códigos, tasas ni políticas automáticamente.
9. **Bitácora**: auditoría de todas las operaciones con actor y motivo.

## Límites actuales (sin inventar capacidades)

- Sin constitución legal ni inscripción de IVA: los anexos fiscales generan archivos SOLO con
  autorización explícita del contador (vigencias) y permanecen bloqueados en el uso administrativo.
- Sin captura de nómina: las retenciones sobre salarios (código 01) y el caso especial 47 del F-14
  están bloqueados con mensaje explícito.
- La verificación real del instalador NSIS y del recorrido gráfico offline en Windows está pendiente
  (ver `docs/QA-WINDOWS.md` y `scripts/qa-windows.ps1`).


## Instalación, actualización, respaldo y rollback (pasos reales)

### Instalación inicial (Windows, offline)
1. Generar el instalador con el pipeline verificado de ABI (recomendado):
   `npm run dist:win:qa` — ejecuta en orden: reconstrucción de better-sqlite3 para Electron
   (33.4.11, x64, win32) → **probe con Electron real** (SQLite :memory:, falla el pipeline si
   el ABI no corresponde) → build → NSIS → verificación de que el binario DENTRO del artefacto
   coincide con el del probe (registros `abi-electron.json` y `probe-electron.json` con hashes).
   Alternativa sin firma para QA local (winCodeSign no disponible por permisos de enlaces simbólicos):
   `node node_modules\electron-builder\out\cli\cli.js --win nsis --publish never --config.win.signAndEditExecutable=false .`
   — artefacto LOCAL SIN FIRMA con icono predeterminado, válido SOLO para QA; no es firma oficial.
   **Importante**: NO regenerar con `npm run rebuild:node` después del probe ni antes de terminar
   el empaquetado (mezclaría el ABI de Node con el de Electron y el instalado no arrancaría,
   mostrando NODE_MODULE_VERSION 137 vs 130). Si la app instalada muestra el diálogo de error de
   arranque con NODE_MODULE_VERSION, el instalador se generó con el ABI incorrecto: regenerarlo
   con `dist:win:qa`.
2. Elegir destino de instalación (por defecto `%LOCALAPPDATA%\Programs\ARKON Contabilidad`).
3. Al abrir, los datos se crean en `%LOCALAPPDATA%\ARKON Contabilidad\` (fuera de OneDrive).

### Actualización conservando datos
1. **Antes de actualizar**: botón "Crear respaldo ahora" (vista Respaldo) — genera copia con
   manifiesto SHA-256 en `respaldos\`.
2. Instalar el nuevo NSIS sobre la instalación existente (mismo destino). Los datos del perfil
   (`%LOCALAPPDATA%\ARKON Contabilidad`) NO se tocan.
3. Abrir la app: contrapartes, documentos, adjuntos y bitácora deben seguir visibles.
4. Verificación reproducible por CLI (opcional):
   `node dist\scripts\semilla-qa.js verificar --perfil <perfil-QA> --manifiesto <semilla-qa.json>`

### Respaldos y restauración
- Manual: "Crear respaldo ahora" (vista Respaldo) — copia SQLite + adjuntos + manifiesto con hash.
- Periódico: configurar intervalo y retención (0 = desactivado) en la misma vista.
- Restaurar: seleccionar respaldo → "Restaurar" → confirmar; se conserva copia del estado anterior
  y la restauración interrumpida se resuelve al siguiente arranque verificando hashes.
- **Rollback**: si una actualización pierde datos, restaurar el respaldo previo desde la vista
  Respaldo y reportar el hallazgo (el manifiesto del respaldo sirve de evidencia).

### QA de dos versiones (perfiles sintéticos, sin tocar la base operativa)
Ver `scriptsceptacion-dos-versiones.ps1`: siembra un perfil QA (contraparte, venta, adjunto con
hash, bitácora), crea respaldo con manifiesto esperado, guía la instalación del NSIS nuevo y
verifica el perfil tras actualizar con estados PASA/FALLA (exit 2 si falla). Nada se aprueba solo
por proceso activo. `scripts\qa-windows.ps1` añade marcador QA para reabrir el mismo perfil.

## Matriz de aceptación gráfica offline (recorrido manual en Windows)

| # | Comprobación | Pasos | Criterio de aprobación |
|---|---|---|---|
| 1 | Apertura offline | Instalar, desconectar red, abrir | Ventana sin preload-error; datos del perfil |
| 2 | Captura + doble envío | Registrar venta/compra; repetir envío con la misma operación | Sin duplicados (idempotencia visible) |
| 3 | Anulación de documentos | Anular venta/compra con diálogo (folio/importe/efecto, motivo ≥10 caracteres y responsable, cancelar sin cambios) | Reverso contabilizado, error dentro del diálogo, aviso visible, bitácora con motivo capturado |
| 3b | Anulación de movimientos | Anular cobro/pago/transferencia con diálogo (folio/tipo/monto/contrapente/efecto, motivo ≥10 caracteres y responsable, cancelar sin cambios) | Movimiento anulado, aplicaciones liberadas, saldo restaurado, error dentro del diálogo, aviso único visible, bitácora con motivo |
| 4 | Adjuntos | Adjuntar con selector, Verificar hash, Abrir | Hash correcto; archivo alterado no abre |
| 5 | CSV/PDF | Exportar libros, paquete del contador, ejercicio anual, cotización PDF | Archivos en disco con cifras de pantalla |
| 6 | Reportes anuales | Ejercicio anual: consultar año, exportar soporte | Conciliación OK; familia de cierre marcada |
| 7 | Respaldo/restauración | Respaldo manual, restaurar, reabrir | Datos previos restaurados; copia del anterior |
| 8 | Cierre/reapertura | Cerrar ejercicio, reabrir con motivo | Bloqueo central activo; bitácora auditada |
| 9 | Impuestos bloqueados | Diagnóstico F-07/F-14 sin activación | Guardado de presentación bloqueado con mensaje |
| 10 | Actualización | Instalar nueva versión sobre la anterior | Datos/adjuntos/bitácora conservados (PASO 4 CLI) |

Sin tasas, identidades ni políticas inventadas; ARKON administrativa sin constitución ni IVA.
