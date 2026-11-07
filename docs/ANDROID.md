# Android y SQLite WASM

## Resultado de la prueba técnica AND1

`src/plataforma/sqliteWasm.ts` adapta, de forma síncrona una vez inicializado el módulo, la interfaz que usan los servicios de `better-sqlite3` en el camino probado: `prepare().run/get/all`, `safeIntegers`, `pragma`, `exec`, `transaction` (con savepoints al anidar), `close`, `open`, y `lastInsertRowid`/`changes` tanto en el resultado de `run` como en la base.

`pruebas/sqliteWasm.prueba.ts` (Node, base en memoria, `SUITE_EXIT=0`, 2 pruebas) ejecuta el mismo escenario sobre SQLite WASM (`@sqlite.org/sqlite-wasm`, ya presente en `node_modules`) y sobre `better-sqlite3`, sin cambios en `src/main/servicios/`: migraciones (`aplicarMigraciones`), siembra de catálogo (`sembrarCatalogoBase`, ámbito administrativo), contabilización y anulación de un asiento, venta, alta de activo fijo, depreciación del mes, estados financieros y balance. En ambos motores el resultado es idéntico, y además se fijan cifras calculadas a mano: aporte 100.00 anulado, venta 200.00 a crédito, activo 1200.00, cuota 1200.00/12 = 100.00; balance activo 100.00 = resultado 100.00, `cuadra: true`, 5 asientos. La segunda prueba verifica enteros grandes con `safeIntegers` (`9007199254740993n`) y que `UNIQUE` y `CHECK` lanzan error en ambos motores.

La inicialización del módulo WASM (`sqlite3InitModule`) es asíncrona; todas las operaciones del adaptador ya inicializado son síncronas, como exige el código de servicios.

## AND2: aislamiento de plataforma implementado

`src/plataforma/plataforma.ts` define `Plataforma`: apertura de base activa y copia, copia consistente, integridad, archivos, rutas de datos, SHA-256 y operaciones de adjuntos/retención. El tipo `BaseDatos` conserva el contrato de servicios de AND1; su referencia a `better-sqlite3` es solo de tipos.

- `respaldo.ts` recibe la plataforma como último parámetro; `restauracion.ts` la recibe en `crearContextoBase` y la conserva en el contexto. No importan `fs`, `path`, `crypto` ni el módulo nativo. También pasan por ella los respaldos periódicos, previos a migraciones existentes, recuperación interrumpida y adjuntos. No se añadió ni modificó ninguna migración.
- `src/plataforma/escritorio.ts` conserva apertura con pragmas, `db.backup`, archivos y SHA-256 nativos. Es el valor predeterminado para llamadas existentes; sus `require` nativos solo se ejecutan al solicitar escritorio. Las funciones de archivos de `adjuntos.ts` reciben igualmente la plataforma, para no introducir Node transitivamente en WASM.
- `src/plataforma/memoria.ts` implementa archivos/rutas virtuales y apertura, exportación e importación SQLite WASM (`sqlite3_js_db_export`/`sqlite3_deserialize`). Recibe el módulo ya inicializado y una función SHA-256 síncrona; las pruebas inyectan SHA-256 de Node. Cerrar una base activa serializa sus datos; abrir una copia no reescribe el archivo.
- La base exportada es **un único archivo SQLite estándar**, no un volcado SQL ni un conjunto WAL/SHM. Se mantiene el formato de escritorio: `.db` más manifiesto `.manifest.json` separado y, si hay adjuntos, su carpeta e inventario. No se creó un nuevo contenedor de intercambio.
- La inspección del inventario al restaurar usa una copia con `query_only`, sin activar WAL en el respaldo: activar WAL en una imagen WASM cambiaba su cabecera y rompía el hash. Al importar imágenes nativas autocontenidas en memoria se normalizan los bytes de modo de diario de la copia en memoria; el archivo original y su hash permanecen intactos.

`pruebas/plataformaRespaldo.prueba.ts` prueba WASM→WASM, WASM→better-sqlite3 y better-sqlite3→WASM con los servicios reales de respaldo/restauración: dos aportes sintéticos de 123.45 y 76.55, activo y patrimonio 200.00, resultado 0.00, dos asientos y entero `9007199254740993n`. Verifica manifiesto, SHA-256, versión de esquema, copia previa, reapertura y que un aporte posterior de 25.00 no altere el respaldo. También prueba rechazo de archivo alterado/esquema futuro y respaldo periódico WASM.

## Incompatibilidades conocidas

- No implementado en el adaptador: `backup`, `serialize`, `iterate`, `function`/`aggregate`, `loadExtension`, `table`, `unsafeMode`, `defaultSafeIntegers`, ni variantes `transaction.deferred/immediate/exclusive`. Respaldo/restauración ya no necesitan `backup` en la conexión WASM: usan `Plataforma.copiarBase`.
- Expedientes de archivo: `better-sqlite3` abre rutas; SQLite WASM en navegador no abre rutas de sistema de archivos, solo bases en memoria o OPFS.
- `pragma('journal_mode = WAL')` y demás pragmas de `conexion.ts` no aplican a OPFS/memoria del mismo modo; `foreign_keys = ON` sí debe fijarse al abrir.
- Nombres de error distintos: p. ej. `SQLITE_CONSTRAINT_UNIQUE`/`CHECK` llegan serializados por WASM, sin clase `SqliteError` de `better-sqlite3` ni códigos idénticos en todos los casos.

## AND3: primera entrada Android

Implementado (pendiente de validar en dispositivo):

- `android.worker.ts` es el único dueño de SQLite. `motorAndroid.ts` inicializa WASM, instala **`opfs-sahpool`** en `/arkon-administrativo` y abre `/arkon.db`. Reutiliza migraciones, catálogo y `src/main/comandos.ts`, sin alterar reglas contables. Usa `foreign_keys`, diario DELETE y sincronización FULL; no activa WAL. Los mensajes se ejecutan en serie, incluidos comandos asíncronos.
- SAH pool no requiere COOP/COEP ni `SharedArrayBuffer`; sí contexto seguro, Worker y OPFS con `createSyncAccessHandle` en la WebView. **No hay fallback a memoria**: si no se puede abrir la base persistente, la app muestra el fallo y no permite registrar datos. Un segundo dueño del mismo pool debe fallar, no crear otra base.
- La entrada `src/renderer/movil.html` instala `window.arkon` mediante mensajes correlacionados por id y monta el mismo renderer tras abrir la base. Los errores se devuelven como mensajes; los resultados conservan `bigint` mediante structured clone.
- Solo una base administrativa. Navegación fiscal y respaldos ocultos en Android; ámbitos distintos y comandos fiscales/archivos rechazados en el Worker. PDF, importación/exportación, adjuntos y diálogos nativos avisan que aún no están disponibles. Sin Google Drive.
- `vite.movil.config.ts` genera `movil/www/index.html`, Worker, recursos locales y `sqlite3.wasm` con las URL generadas por Vite. Sustituye el proveedor nativo por uno que falla explícitamente; no incluye Electron, better-sqlite3 ni módulos Node. `.arkon/apk.cmd` hace este build **antes** de `capacitor sync android` y `assembleDebug`, sin firma de distribución. `movil/www` y la copia generada en `movil/android/app/src/main/assets/public` y `app/src/main/assets/capacitor.config.json` no quedan versionados (`.gitignore`); el `capacitor.config.json` de `movil/` es la fuente.
- `movil.css` se importa solo desde la entrada móvil: menú plegable hasta 600 px con cabecera fija, tablas con scroll horizontal propio, formularios contenidos. Escritorio conserva sus estilos y navegación.
- **AND3C — privacidad del APK:** `AndroidManifest.xml` usa `android:allowBackup="false"` con `android:fullBackupContent="@xml/backup_rules"` y `android:dataExtractionRules="@xml/data_extraction_rules"`, ambas excluyen todo (`res/xml/`), para que la contabilidad nunca vaya a la copia automática de Google; sin permiso `android.permission.INTERNET` (la app es local; el traspaso futuro irá por el selector del sistema).
- **AND3C — teléfono (≤600 px):** barra fija superior con el fondo marino del lateral (botón de menú de 44×44 px con icono SVG de tres líneas y `aria-label` Abrir/Cerrar menú, logo blanco y nombre de la sección), velo oscuro que cierra al tocarlo y lateral que se desliza desde la izquierda con su ancho actual (232 px), respetando `prefers-reduced-motion`. El aviso Android va solo en Inicio; en teléfono se oculta la línea larga de `.barra-contexto`. Las líneas de asiento son un bloque: Cuenta a todo el ancho y Debe/Haber lado a lado con etiqueta visible (cabecera oculta, Totales alineados igual); Compras y Cotizaciones ya usan `.fila` con envoltura y no tenían ese problema. En `data-plataforma='android'` todos los `button`, `input` (salvo casillas) , `select` y `textarea` miden al menos 44 px de alto; los botones sin clase (p. ej. «Ver») usan el estilo de la marca.

### Cómo probar

1. `.arkon\prueba.cmd pruebas/android.prueba.ts`: compila el bundle y lo sirve en localhost sin COOP/COEP. Usa el Chromium de Electron ya instalado como navegador (página sin Node). No instala dependencias. Escribe un aporte sintético de **123.45** con servicios reales, termina el Worker y abre otro: activo y patrimonio deben seguir en **12345** menores, pasivo y resultado **0**, balance cuadrado.
2. La misma prueba abre una transacción, inserta contrapartes sintéticas y fuerza desalojo de páginas de caché, termina el Worker **sin COMMIT ni close**, reabre y exige cero contrapartes y el aporte intacto. Los comandos de SQL de la prueba solo existen en un Worker de fixture, nunca en el APK.
3. Recorre **todas** las secciones del menú a **360 y 800 px** y exige en cada una: sin desbordamiento de página, ningún elemento fuera de la pantalla salvo dentro de una tabla, y ningún control por debajo de 44 px. A 360 px exige logo visible, botón de menú con `aria-label`, velo que cierra y Debe/Haber de una línea de asiento en la misma fila; persiste el mensaje exacto de cada rechazo (`toEqual`) y lee `AndroidManifest.xml` para exigir `allowBackup="false"` y ausencia de `INTERNET`. También usa una tabla deliberadamente más ancha que la pantalla para verificar el scroll propio de tablas.
4. `.arkon\verificar.cmd` comprueba tipos (incluido `tsconfig.movil.json`), builds de escritorio/móvil y toda la suite. Ejecutarlo dos veces.
5. `.arkon\apk.cmd` produce únicamente `movil/android/app/build/outputs/apk/debug/app-debug.apk`. En teléfono con WebView actual: crear el aporte sintético, forzar cierre de la app, reabrir y comprobar 123.45; repetir navegación y tablas en ambas anchuras. No borrar almacenamiento ni desinstalar entre aperturas: eso elimina OPFS. No usar datos reales mientras falte exportación externa.

### Validación local y pendientes

Tipos y builds de escritorio/móvil completados. Dos ejecuciones completas consecutivas de `.arkon\verificar.cmd`: **514 pruebas pasan (82 archivos), SUITE_EXIT=0**. La prueba Android usa Electron como navegador sin Node en la página, persiste un aporte sintético de 123.45 y verifica el corte transaccional, los ámbitos, todas las secciones a 360/800 px (desbordamiento, elementos fuera de pantalla y controles ≥44 px), cabecera/velo/líneas a 360 px, mensajes exactos de rechazo y el manifiesto.
No se ha instalado el APK en un teléfono real. Sigue sin validarse en dispositivo: WebView/Capacitor real, cuotas y ciclo de vida de OPFS, permisos, exportación/importación física por el selector del sistema, SHA-256 de archivos y adjuntos, ni PDF/Google Drive (tarea siguiente).

El traspaso entre dispositivos es por respaldo: exportar la base SQLite completa como archivo único, validar integridad, versión de esquema e inventario de adjuntos, y sustituir la única base activa solo tras esa validación, con la base anterior preservada hasta confirmar la nueva.

## Riesgos

- Ciclo de vida: si la WebView o el Worker mueren, una escritura no confirmada puede perderse; se requiere confirmar cada transacción y probar el cierre limpio.
- Almacenamiento OPFS: cuotas, desalojo por el sistema y versiones de WebView/SO pueden variar; el respaldo debe ser periódico y verificable fuera del dispositivo.
- AND2 solo verifica una simulación en Node con archivos virtuales. AND3 añade implementación OPFS/Worker; su validación real sigue pendiente por el bloqueo de arranque descrito arriba. Faltan SHA-256 para archivos del navegador, exportación/importación física en teléfono, permisos y pruebas de WebView/dispositivo, incluidos fallos y adjuntos.
- Los importes deben seguir dentro del rango entero de 64 bits de SQLite y consultarse con `safeIntegers`; en WASM los enteros grandes llegan como `bigint`.
- Rendimiento y tamaño del módulo WASM en dispositivos de gama baja: no medido en esta prueba (solo Node, base en memoria).
- Capacitor 8.6 e interfaz compartida incorporados en AND3; quedan pendientes mediciones en teléfono y validación del APK de depuración.
