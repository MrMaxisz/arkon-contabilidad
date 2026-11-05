# QA de ARKON Contabilidad en Windows (offline)

Ejecutar `scripts\qa-windows.ps1` desde la raíz del repositorio en una máquina Windows con Node LTS y Python
disponibles. El script usa `npm ci` (instalación reproducible), `npm test` (que reconstruye better-sqlite3
para Node), `npm run build` (main + preload empaquetado con esbuild + renderer) y, con `-ConInstalador`,
`npm run dist:win` (NSIS). La app arranca con `ARKON_RUTA_DATOS` apuntando a un perfil temporal exclusivo
bajo `%LOCALAPPDATA%` (fuera de OneDrive); sin esa variable, la ruta operativa sigue siendo
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
- Los datos de prueba son siempre sintéticos; nunca usar la base operativa real para QA.
