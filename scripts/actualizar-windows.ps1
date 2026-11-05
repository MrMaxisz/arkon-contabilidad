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
$operativo = Join-Path $env:LOCALAPPDATA 'ARKON Contabilidad'
$perfilLower = $Perfil.ToLowerInvariant().TrimEnd('\') + '\'
$operativoLower = [System.IO.Path]::GetFullPath($operativo).ToLowerInvariant().TrimEnd('\') + '\'
if ($perfilLower -eq $operativoLower) { throw "El perfil QA no puede ser la base operativa: $Perfil" }
if ($perfilLower.StartsWith($operativoLower)) { throw "El perfil QA no puede ser subruta de la base operativa: $Perfil" }
New-Item -ItemType Directory -Path $Perfil -Force | Out-Null
# Marcador QA único alineado con el CLI: solo en perfil nuevo vacío.
$marcador = Join-Path $Perfil 'QA-MARCADOR-ARKON.txt'
if (Test-Path $marcador) {
  $contenido = Get-Content $marcador -Raw -ErrorAction SilentlyContinue
  if (-not $contenido -or -not $contenido.Contains('Perfil QA de ARKON Contabilidad')) {
    throw "Marcador QA inválido en $marcador; el perfil existe pero no es un perfil QA válido."
  }
} else {
  $existentes = @(Get-ChildItem $Perfil -ErrorAction SilentlyContinue)
  if ($existentes.Count -gt 0) {
    throw "El perfil $Perfil ya existe con contenido y sin marcador QA; rechazado para no tocar datos desconocidos."
  }
  Set-Content -Path $marcador -Value "Perfil QA de ARKON Contabilidad; semilla sintética; $(Get-Date -Format o)" -Encoding UTF8
}
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
  Requiere 'Pipeline ABI completo (rebuild→probe→build→NSIS→verificación)' { npm run dist:win:qa }
  $nsis = Get-ChildItem -Path (Join-Path $raizRepo 'paquete') -Filter '*.exe' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $nsis) {
    throw 'FALLO: dist:win:qa terminó pero no se encontró el instalador NSIS en paquete\. Sin artefacto no hay éxito.'
  }
  $hash = (Get-FileHash $nsis.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
  Write-Host "Instalador generado y verificado: $($nsis.FullName) SHA256: $hash"

  # Este script PREPARA los artefactos con pipeline verificado. NO ejecuta la actualización real:
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
