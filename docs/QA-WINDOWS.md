# QA de ARKON Contabilidad en Windows (offline)

Ejecutar `scripts\qa-windows.ps1` desde la raíz del repositorio en una máquina Windows con Node LTS y Python
disponibles. El script usa `npm ci` (instalación reproducible), `npm test` (que reconstruye better-sqlite3
para Node), `npm run build` (main + preload empaquetado con esbuild + renderer) y, con `-ConInstalador`,
`npm run dist:win:qa` (rebuild→probe→NSIS→verificación; la salida se genera en `paquete\`). La app arranca con `ARKON_RUTA_DATOS` apuntando a un perfil temporal exclusivo
bajo `%LOCALAPPDATA%` (fuera de OneDrive) y `--user-data-dir` aislado para Chromium; sin esa variable, la ruta operativa sigue siendo
`%LOCALAPPDATA%\ARKON Contabilidad`.

## Criterios de aceptación del recorrido manual

1. **Apertura**: la ventana abre sin `preload-error`; `window.arkon` disponible; los datos se crean en el
   perfil indicado y NO en OneDrive.
2. **Captura**: registrar venta, compra, cobro y pago; repetir el envío con la misma operación y verificar
   idempotencia (sin duplicados); anular documento con diálogo de confirmación y bitácora.
3. **Documentos**: adjuntar archivo con selector de documento real; Verificar (hash) y Abrir; un archivo
   alterado debe reportar hash incorrecto y no abrir.
4. **Exportaciones**: libros CSV, paquete del contador (carpeta por diálogo nativo) y Anexos 1/2/3: sin
   activación formal el guardado de presentación se bloquea con mensaje visible.
5. **Respaldo/restauración**: respaldo manual con manifiesto, respaldo periódico configurado, restauración
   con copia previa del estado anterior y reapertura sin conexión.
6. **Instalador (con `-ConInstalador`)**: instalar el NSIS generado, abrir la app instalada, verificar que
   una actualización conserva los datos del perfil y que la desinstalación no borra los datos del usuario.

## Límites declarados

- El sandbox de desarrollo es Linux: la suite Node/jsdom y el arranque del preload empaquetado no sustituyen
  este recorrido; el instalador NSIS solo puede verificarse en Windows.
- ABI nativo: `npm test` reconstruye better-sqlite3 para Node; el script reconstruye para Electron con
  `node scripts/rebuild-electron.mjs` + `node scripts/probe-electron-abi.mjs` antes de abrir la app de desarrollo. Tras el QA,
  ejecutar `npm run rebuild:node` antes de volver a correr la suite.
- El script bloquea la apertura si ya hay una instancia de este repositorio en ejecución y permite reabrir
  el mismo perfil con `-Perfil <ruta>`.
- Los datos de prueba son siempre sintéticos; nunca usar la base operativa real para QA.

## Aislamiento del paquete QA (auditoría 58)

El paquete QA (`npm run dist:win:qa:aislada`, configuración `electron-builder.qa.yml`, appId
`sv.arkon.contabilidad.qa.aceptacion`, canal `arkonCanal: "qa"`) lleva una **barrera en el proceso
principal**: con canal `qa` la app SOLO abre si `ARKON_RUTA_DATOS` es absoluta, está fuera de OneDrive,
no es la base operativa ni subruta suya (comparación case-insensitive + realpath contra junctions) y
existe `QA-MARCADOR-ARKON.txt` con el texto «Perfil QA de ARKON Contabilidad» en la ruta o en su padre
directo. Si no se cumple: mensaje «Esta versión de prueba solo abre con su lanzador y un perfil QA
válido. No se abrió ningún dato.» y salida 78, sin crear ni tocar nada. `userData` de Chromium se
redirige al subdirectorio `chromium` del perfil antes del bloqueo de instancia. El paquete de
producción NO lleva `arkonCanal` y conserva el comportamiento histórico.

Reglas obligatorias de instalación QA:

- El instalador QA se genera con `runAfterFinish: false`: NUNCA ejecutar la app QA desde la página
  final del NSIS ni abrir el .exe instalado sin el lanzador (`ARKON_RUTA_DATOS` + marcador).
- NUNCA instalar en modo interactivo con una configuración distinta a `electron-builder.qa.yml`;
  la app QA sin lanzador sale con 78 en lugar de abrir la base operativa.
- NUNCA pasar `/D=` con rutas sin entrecomillar que contengan espacios; usar comillas dobles
  alrededor de la ruta completa.
- El verificador `scripts/verificar-canal-artefacto.mjs` comprueba el canal dentro del artefacto:
  el paquete QA debe llevar `arkonCanal "qa"` y el de producción no debe llevarlo.
