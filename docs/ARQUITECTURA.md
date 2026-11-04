# ARQUITECTURA

## Decisiones confirmadas

- **Electron + TypeScript + React + SQLite local** (propuesta del plan, adoptada).
- Versiones fijadas en `package-lock.json` (Electron 33.x, React 18.x, better-sqlite3 12.x, TypeScript 5.x, Vite 5.x, Vitest 2.x). El empaquetado verificó Electron 33.4.11.
- Moneda funcional: USD, 2 decimales. Fechas ISO `YYYY-MM-DD`.

## Capas

| Capa | Ubicación | Regla |
| --- | --- | --- |
| Interfaz | `src/renderer` | React aislado: sin Node, sin SQL, sin sistema de archivos. Solo llama comandos del puente. |
| Puente | `src/preload` | `contextBridge` expone `window.arkon.invocar(comando, datos)` con lista de comandos permitidos. |
| Comandos | `src/main/ipc.ts` | Un manejador `arkon` valida remitente y payload; cada comando es específico y validado. |
| Dominio | `src/main/servicios` | Motor contable, cuentas, estados financieros, respaldo, bitácora. Independiente de la interfaz. |
| Persistencia | `src/main/db` | better-sqlite3, WAL, `foreign_keys=ON`, `synchronous=FULL`, migraciones versionadas, transacciones explícitas. |
| Compartido | `src/shared` | Dinero exacto y tipos usados por main y renderer. |

## Seguridad Electron

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- CSP restrictiva en `index.html` (`default-src 'self'`), sin CDN ni descargas remotas.
- Tipografías (Barlow Condensed, IBM Plex Sans) empaquetadas localmente vía `@fontsource`.
- SQL siempre parametrizado; el renderer nunca construye SQL.
- Instancia única (`requestSingleInstanceLock`).

## Dinero exacto

- Todo importe contabilizado se almacena como **entero en unidades mínimas** (`INTEGER` de SQLite, `bigint` en TS).
- Cantidades, precios y tasas se serializan como texto decimal exacto; se parsean con `parseMontoMinor`/`parseTasa`.
- Redondeo determinista half-up en `redondearDivision`.
- IVA incluido: `base = total/(1+tasa)` redondeado half-up; `iva = total - base` (reconcilia exactamente con el total, nunca lo aumenta).
- IVA separado: `iva = round(base × tasa)` una sola vez.

## Rutas de datos

```
%LOCALAPPDATA%\ARKON Contabilidad\
  datos\      arkon.db (base activa)
  adjuntos\   documentos de respaldo
  respaldos\  respaldo-<fecha>.db + .manifest.json
  registros\  registros operativos
```

En desarrollo (Linux/macOS) se usa `~/.arkon-contabilidad`. La base activa nunca vive en OneDrive ni en el directorio de instalación.

## Empaquetado

- `electron-builder` con destino NSIS para Windows (`npm run dist:win`).
- `better-sqlite3` se marca en `asarUnpack` (módulo nativo).
- Verificado en este hito: empaquetado `--dir` con módulo nativo reconstruido. Pendiente: ejecutar el instalador NSIS en Windows y recorrer los flujos en el ejecutable.
