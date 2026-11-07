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

## Persistencia prevista con OPFS en un Worker

SQLite WASM se inicializará una sola vez dentro de un Worker dedicado, que será el único dueño de la conexión. Al abrir, usará `sqlite3.oo1.OpfsDb` con un único archivo (una sola base activa); el hilo de interfaz enviará comandos serializados y recibirá resultados, nunca tocará OPFS directamente. Sin OPFS/co-aislamiento (`COOP`/`COEP`) la base queda en memoria y no persiste.

El traspaso entre dispositivos es por respaldo: exportar la base SQLite completa como archivo único, validar integridad, versión de esquema e inventario de adjuntos, y sustituir la única base activa solo tras esa validación, con la base anterior preservada hasta confirmar la nueva.

## Riesgos

- Ciclo de vida: si la WebView o el Worker mueren, una escritura no confirmada puede perderse; se requiere confirmar cada transacción y probar el cierre limpio.
- Almacenamiento OPFS: cuotas, desalojo por el sistema y versiones de WebView/SO pueden variar; el respaldo debe ser periódico y verificable fuera del dispositivo.
- AND2 solo verifica una simulación en Node con archivos virtuales. Faltan implementación persistente OPFS/Worker, proveedor de SHA-256 para navegador, exportación/importación física en teléfono, permisos y pruebas de WebView/dispositivo (incluidos fallos y adjuntos en el intercambio real). La simulación pierde todo al destruirse su plataforma; no es persistencia Android.
- Los importes deben seguir dentro del rango entero de 64 bits de SQLite y consultarse con `safeIntegers`; en WASM los enteros grandes llegan como `bigint`.
- Rendimiento y tamaño del módulo WASM en dispositivos de gama baja: no medido en esta prueba (solo Node, base en memoria).
- Sin interfaz Android ni Capacitor en AND2.
