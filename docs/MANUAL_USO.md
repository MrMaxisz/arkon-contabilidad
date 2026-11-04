# MANUAL BREVE DE USO (hito 1)

## Instalación (pendiente de verificar en Windows)

1. Ejecutar el instalador NSIS generado con `npm run dist:win` y elegir el directorio.
2. Al abrirse, la aplicación crea sus datos en `%LOCALAPPDATA%\ARKON Contabilidad\` (base, adjuntos, respaldos, registros). No requiere internet, Node ni descargas.
3. Para actualizar: instalar la nueva versión sobre la anterior; los datos no se tocan. Ante cambios de esquema la aplicación respalda antes de migrar (pendiente: respaldo automático previo a migración, ver `ESTADO_IMPLEMENTACION.md`).

## Operación diaria

- **Inicio**: resumen del balance (activo, pasivo, patrimonio, resultado) derivado del mayor, con indicador de cuadre de partida doble. Muestra la advertencia de ámbito administrativo previo a la constitución.
- **Contabilidad**:
  - *Nuevo asiento manual*: fecha de operación, concepto, responsable y líneas (cuenta de movimiento, importe en Debe **o** Haber). El motor rechaza asientos descuadrados, cuentas de agrupación, cuentas inexistentes o inactivas y períodos cerrados antes de escribir nada.
  - *Asientos recientes*: lista con folio, estado y total. «Anular» pide motivo y crea un asiento reverso trazable; el original queda conservado como `anulado`.
  - *Mayor de cuenta*: movimientos y saldo corrido de la cuenta seleccionada.
- **Respaldo**: «Crear respaldo ahora» genera una copia consistente (API de respaldo de SQLite), verifica integridad, calcula hash SHA-256 y escribe un manifiesto `.manifest.json`. La restauración verifica hash e integridad, preserva copia del estado anterior y bloquea esquemas futuros incompatibles.
- **Bitácora**: últimos eventos (contabilizaciones, anulaciones, cierres, respaldos, migraciones).

## Corregir errores

- Nunca se edita un asiento contabilizado: se anula con motivo (crea reverso) o se registra un ajuste trazable.
- Un doble clic o reintento con la misma clave de idempotencia devuelve el mismo asiento sin duplicar.

## Respaldar y restaurar

- Respaldar con regularidad desde la vista Respaldo; las copias quedan en `respaldos\`.
- Restaurar: usar el comando `respaldo:restaurar` indicando la ruta del archivo de respaldo (interfaz de selección de archivo: hito siguiente). Siempre se conserva una copia `.antes-restauracion` del estado anterior.

## Qué NO es esta aplicación todavía

- No emite documentos tributarios electrónicos ni cotizaciones/PDF (hitos 3+).
- No calcula declaraciones; los libros y exportaciones fiscales llegan en el hito 4+.
- El catálogo sembrado es una propuesta editable pendiente de revisión del contador responsable.
