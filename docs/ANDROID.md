# Android y SQLite WASM

## Resultado de la prueba técnica AND1

`src/plataforma/sqliteWasm.ts` adapta, de forma síncrona una vez inicializado el módulo, la interfaz que usan los servicios de `better-sqlite3` en el camino probado: `prepare().run/get/all`, `safeIntegers`, `pragma`, `exec`, `transaction` (con savepoints al anidar), `close`, `open`, y `lastInsertRowid`/`changes` tanto en el resultado de `run` como en la base.

`pruebas/sqliteWasm.prueba.ts` (Node, base en memoria, `SUITE_EXIT=0`, 2 pruebas) ejecuta el mismo escenario sobre SQLite WASM (`@sqlite.org/sqlite-wasm`, ya presente en `node_modules`) y sobre `better-sqlite3`, sin cambios en `src/main/servicios/`: migraciones (`aplicarMigraciones`), siembra de catálogo (`sembrarCatalogoBase`, ámbito administrativo), contabilización y anulación de un asiento, venta, alta de activo fijo, depreciación del mes, estados financieros y balance. En ambos motores el resultado es idéntico, y además se fijan cifras calculadas a mano: aporte 100.00 anulado, venta 200.00 a crédito, activo 1200.00, cuota 1200.00/12 = 100.00; balance activo 100.00 = resultado 100.00, `cuadra: true`, 5 asientos. La segunda prueba verifica enteros grandes con `safeIntegers` (`9007199254740993n`) y que `UNIQUE` y `CHECK` lanzan error en ambos motores.

La inicialización del módulo WASM (`sqlite3InitModule`) es asíncrona; todas las operaciones del adaptador ya inicializado son síncronas, como exige el código de servicios.

## Servicios que no corren sin cambios

El resto de servicios solo usa tipos de `better-sqlite3` (`import type`), por lo que no cargan el módulo nativo. Hay dos excepciones, que en Android no pueden importarse tal cual:

- `src/main/servicios/respaldo.ts`: `require('better-sqlite3')` en `verificarIntegridad` y en `crearRespaldo`/`restaurarRespaldo`, y `db.backup(ruta)` (archivo temporal en disco).
- `src/main/servicios/restauracion.ts`: `import Database from 'better-sqlite3'` y `new Database(ruta, ...)` en `baseLegible`, `conjuntoCoherente` y `respaldoPeriodicoSiCorresponde`, además de `db.backup(ruta)`.

Aislamiento propuesto (no implementado aquí): extraer apertura de archivos de respaldo y `backup` tras una fábrica inyectada (igual que `db` por parámetro), de modo que en Android esa fábrica use la exportación/importación WASM y nunca cargue el módulo nativo; los servicios de cálculo no necesitan cambiar.

## Incompatibilidades conocidas

- No implementado en el adaptador: `backup`, `serialize`, `iterate`, `function`/`aggregate`, `loadExtension`, `table`, `unsafeMode`, `defaultSafeIntegers`, ni variantes `transaction.deferred/immediate/exclusive`. Solo `backup` se usa hoy, y solo en respaldo/restauración (ver arriba).
- Expedientes de archivo: `better-sqlite3` abre rutas; SQLite WASM en navegador no abre rutas de sistema de archivos, solo bases en memoria o OPFS.
- `pragma('journal_mode = WAL')` y demás pragmas de `conexion.ts` no aplican a OPFS/memoria del mismo modo; `foreign_keys = ON` sí debe fijarse al abrir.
- Nombres de error distintos: p. ej. `SQLITE_CONSTRAINT_UNIQUE`/`CHECK` llegan serializados por WASM, sin clase `SqliteError` de `better-sqlite3` ni códigos idénticos en todos los casos.

## Persistencia prevista con OPFS en un Worker

SQLite WASM se inicializará una sola vez dentro de un Worker dedicado, que será el único dueño de la conexión. Al abrir, usará `sqlite3.oo1.OpfsDb` con un único archivo (una sola base activa); el hilo de interfaz enviará comandos serializados y recibirá resultados, nunca tocará OPFS directamente. Sin OPFS/co-aislamiento (`COOP`/`COEP`) la base queda en memoria y no persiste.

El traspaso entre dispositivos es por respaldo: exportar la base SQLite completa como archivo único, validar integridad, versión de esquema e inventario de adjuntos, y sustituir la única base activa solo tras esa validación, con la base anterior preservada hasta confirmar la nueva.

## Riesgos

- Ciclo de vida: si la WebView o el Worker mueren, una escritura no confirmada puede perderse; se requiere confirmar cada transacción y probar el cierre limpio.
- Almacenamiento OPFS: cuotas, desalojo por el sistema y versiones de WebView/SO pueden variar; el respaldo debe ser periódico y verificable fuera del dispositivo.
- Respaldo/restauración actuales dependen de archivos y `backup`; sin el aislamiento descrito no funcionan en Android.
- Los importes deben seguir dentro del rango entero de 64 bits de SQLite y consultarse con `safeIntegers`; en WASM los enteros grandes llegan como `bigint`.
- Rendimiento y tamaño del módulo WASM en dispositivos de gama baja: no medido en esta prueba (solo Node, base en memoria).
