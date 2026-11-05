# ARKON Contabilidad — Manual de usuario (funciones realmente disponibles)

Sistema contable local de escritorio para control **administrativo** de ARKON Ingeniería Eléctrica.
ARKON **no está constituida** como entidad jurídica ni inscrita como contribuyente de IVA: toda la
información es de control interno y **ningún anexo fiscal se presenta** sin la activación formal
que decida el contador responsable.

## Instalación y datos

- Los datos se guardan en `%LOCALAPPDATA%\ARKON Contabilidad\` (fuera de OneDrive): `datos\` (base
  SQLite), `adjuntos\`, `respaldos\` y `registros\`. Para QA existe la variable `ARKON_RUTA_DATOS`
  que redirige SOLO el perfil de pruebas (ver `docs/QA-WINDOWS.md`).
- Instalación: ejecutar el instalador NSIS generado en `paquete\` (`npm run dist:win`). La
  actualización instala sobre la versión anterior **conservando los datos** del perfil; se recomienda
  crear un respaldo manual antes (botón "Crear respaldo ahora" en la vista Respaldo).
- Sin internet: todas las funciones son locales; no hay telemetría ni servicios en línea.

## Funciones disponibles

1. **Inicio administrativo**: captura de contrapartes (clientes/proveedores), catálogo de
   servicios/materiales (sin precios inventados), cotizaciones versionadas con PDF, y proyectos.
2. **Captura y corrección**: ventas, compras con líneas por tratamiento (gravado/exento/no sujeto),
   cobros y pagos con aplicaciones e anticipos, transferencias internas. La corrección de un documento
   registrado se hace por **anulación con motivo** (se genera reverso contable auditado); no se editan
   importes contabilizados.
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
