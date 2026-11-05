# Actualización de ARKON Contabilidad en Windows conservando datos, con perfil sintético para QA.
# Uso: powershell -ExecutionPolicy Bypass -File scripts\actualizar-windows.ps1 [-Perfil <ruta-QA>]
# ADVERTENCIA: para la máquina REAL del propietario, crear antes un respaldo manual desde la app.
param(
  [string]$Perfil
)

$ErrorActionPreference = 'Stop'
$raizRepo = Split-Path -Parent $PSScriptRoot
Set-Location $raizRepo

$envAnteriorRuta = $env:ARKON_RUTA_DATOS
if (-not $Perfil) {
  $Perfil = Join-Path $env:LOCALAPPDATA ("ARKON-QA-UPD-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
}
if ($Perfil -like "*OneDrive*") {
  throw "El perfil QA no puede estar bajo OneDrive: $Perfil"
}
if ($Perfil -eq (Join-Path $env:LOCALAPPDATA 'ARKON Contabilidad')) {
  throw "El perfil QA no puede ser la base operativa: $Perfil"
}
New-Item -ItemType Directory -Path $Perfil -Force | Out-Null
Write-Host "Perfil QA de actualización: $Perfil (la base operativa real NO se toca)"

function Requiere([string]$paso, [scriptblock]$bloque) {
  Write-Host "`n== $paso =="
  & $bloque
  if ($LASTEXITCODE -ne 0) { throw "Fallo en: $paso (código $LASTEXITCODE)" }
}

try {
  Requiere 'Instalar dependencias reproducibles' { npm ci }
  Requiere 'Typecheck de las tres capas' { npm run typecheck }
  Requiere 'Suite con ABI de Node' { npm test }
  Requiere 'Build main + preload + renderer' { npm run build }
  Requiere 'Instalador NSIS (salida en paquete\)' { npm run dist:win }
  Requiere 'Reconstruir dependencias nativas para Electron' { npx electron-builder install-app-deps }

  # Este script PREPARA los artefactos. NO ejecuta la actualización real ni la verifica:
  # la instalación del NSIS y la comparación de datos son PASOS MANUALES PENDIENTES que deben
  # ejecutarse en Windows con dos versiones y un perfil sintético (ver plan siguiente).
  Write-Host @"

ARTESFACTOS LISTOS (PREPARACIÓN COMPLETA; INSTALACIÓN/ACTUALIZACIÓN REAL = PASO MANUAL PENDIENTE):
 - Instalador NSIS en paquete\ (no ejecutado aquí).
 - Perfil QA sintético disponible: $Perfil (sembrar datos de prueba sintéticos antes de instalar).

PLAN DE ACEPTACIÓN DE ACTUALIZACIÓN (manual, PENDIENTE de ejecución en Windows):
 1) Sembrar el perfil QA con datos sintéticos (contrapartes, venta, adjunto, bitácora) usando la versión ACTUAL.
 2) Respaldar desde la app (botón Crear respaldo ahora) y cerrar.
 3) Instalar el NSIS de paquete\ en el perfil QA destino (NO el operativo; rechazar rutas bajo OneDrive).
 4) Abrir el BINARIO INSTALADO (no electron de desarrollo): datos previos visibles.
 5) Registrar una operación sintética nueva, verificar bitácora y adjuntos.
 6) Cerrar y reabrir: la operación persiste; comparar respaldo previo.
 IMPORTANTE tras el QA: ejecutar 'npm run rebuild:node' antes de volver a correr la suite.
"@
}
finally {
  if ($envAnteriorRuta) {
    $env:ARKON_RUTA_DATOS = $envAnteriorRuta
  } else {
    Remove-Item Env:\ARKON_RUTA_DATOS -ErrorAction SilentlyContinue
  }
  Write-Host "Variable ARKON_RUTA_DATOS restaurada a su valor previo. El perfil QA $Perfil NO se elimina automáticamente."
}
