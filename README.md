# ARKON Contabilidad

Aplicación de escritorio para Windows que controla la operación y la contabilidad de ARKON Ingeniería Eléctrica (El Salvador). Funciona sin internet en una sola computadora.

- **Pila**: Electron + TypeScript + React + SQLite local (better-sqlite3).
- **Dinero exacto**: importes contabilizados como enteros en unidades mínimas (centavos de USD); sin aritmética binaria de punto flotante.
- **Partida doble**: asientos atómicos, cuadrados, con idempotencia, reversos trazables, períodos y bitácora.
- **Datos activos** fuera del repositorio: `%LOCALAPPDATA%\ARKON Contabilidad\` en Windows (`~/.arkon-contabilidad` en desarrollo).

## Estado

Hito 1 (base técnica) completado en este repositorio. Consulta `ESTADO_IMPLEMENTACION.md` para el avance por hitos, decisiones y siguiente paso.

## Comandos

```bash
npm install          # dependencias fijadas en package-lock.json
npm test             # pruebas del motor (dinero, IVA, partida doble, reversos, respaldo)
npm run typecheck    # verificación de tipos del proceso principal
npm run build        # compila main + renderer
npm start            # abre la app (requiere build previo)
npm run dist:win     # genera instalador NSIS para Windows (ejecutar en Windows)
```

## Estructura

```
src/shared     Dinero exacto y tipos compartidos
src/main      Proceso principal: DB, migraciones, motor contable, respaldo, IPC
src/preload   Puente seguro con lista de comandos permitidos
src/renderer  Interfaz React (aislada, sin Node ni SQL)
pruebas/      Pruebas automatizadas con datos sintéticos
docs/         Arquitectura, modelo de datos, políticas, pendientes, manual
```

## Advertencia de alcance

ARKON no está constituida ni inscrita como contribuyente de IVA. Esta aplicación registra el control administrativo previo a la formalización; no emite documentos tributarios electrónicos ni constituye legalización del sistema contable. La revisión del catálogo y de las políticas corresponde al contador responsable.
