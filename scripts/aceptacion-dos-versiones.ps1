# Aceptación de DOS VERSIONES de ARKON Contabilidad en Windows (QA con perfiles sintéticos).
# Uso:
#   powershell -ExecutionPolicy Bypass -File scripts\aceptacion-dos-versiones.ps1 `
#     -InstaladorAnterior "C:\QA\v1\ARKON Contabilidad Setup 0.1.0.exe" `
#     -InstaladorNuevo   "C:\QA\v2\ARKON Contabilidad Setup 0.2.0.exe" `
#     [-Perfil "C:\QA\perfil-arkon"] [-DestinoInstalacion "C:\QA\instal"]
# Requisitos: Node con ABI de Node (npm run rebuild:node antes de la suite). Este script:
#   1) Construye y compila la herramienta CLI de semilla (dist/scripts/semilla-qa.js).
#   2) Siembra el perfil sintético con la versión ANTERIOR instalada (arranque GUI manual).
#   3) Crea respaldo y manifiesto esperado.
#   4) El operador instala el NSIS NUEVO en el destino QA (PASO MANUAL: no se automatiza la
#      instalación para no certificar con proceso activo; NSIS requiere interacción).
#   5) Verifica el perfil contra el manifiesto con la herramienta CLI (independiente de la GUI).
# NO toca la base operativa ni OneDrive; NO publica nada; NO ejecuta electron.cmd para certificar.
param(
  [Parameter(Mandatory=$true)][string]$InstaladorAnterior,
  [Parameter(Mandatory=$true)][string]$InstaladorNuevo,
  [string]$Perfil,
  [string]$DestinoInstalacion,
  [string]$Manifiesto
)

$ErrorActionPreference = 'Stop'
$raizRepo = Split-Path -Parent $PSScriptRoot
Set-Location $raizRepo
$envAnteriorRuta = $env:ARKON_RUTA_DATOS

function Requiere([string]$paso, [scriptblock]$bloque) {
  Write-Host "`n== $paso =="
  & $bloque
  if ($LASTEXITCODE -ne 0) { throw "Fallo en: $paso (código $LASTEXITCODE)" }
}

function ValidarRuta([string]$ruta, [string]$que) {
  if (-not [System.IO.Path]::IsPathRooted($ruta)) { throw "$que debe ser ABSOLUTA: $ruta" }
  $norm = [System.IO.Path]::GetFullPath($ruta)
  if ($norm -like "*OneDrive*") { throw "$que no puede estar bajo OneDrive: $norm" }
  $operativo = Join-Path $env:LOCALAPPDATA 'ARKON Contabilidad'
  if ($norm -eq [System.IO.Path]::GetFullPath($operativo)) { throw "$que no puede ser la base operativa: $norm" }
  return $norm
}

try {
  ValidarRuta $InstaladorAnterior 'InstaladorAnterior' | Out-Null
  ValidarRuta $InstaladorNuevo 'InstaladorNuevo' | Out-Null
  if (-not $Perfil) { $Perfil = Join-Path $env:LOCALAPPDATA ("ARKON-QA-2V-" + [guid]::NewGuid().ToString('N').Substring(0,8)) }
  $Perfil = ValidarRuta $Perfil 'Perfil'
  if (-not $Manifiesto) { $Manifiesto = Join-Path $Perfil 'semilla-qa.json' }
  if (-not $DestinoInstalacion) { $DestinoInstalacion = Join-Path $env:LOCALAPPDATA ("ARKON-QA-DEST-" + [guid]::NewGuid().ToString('N').Substring(0,8)) }
  $DestinoInstalacion = ValidarRuta $DestinoInstalacion 'DestinoInstalacion'
  New-Item -ItemType Directory -Path $Perfil -Force | Out-Null
  New-Item -ItemType Directory -Path $DestinoInstalacion -Force | Out-Null
  Write-Host "Perfil contable QA: $Perfil"
  Write-Host "Destino instalación QA: $DestinoInstalacion"

  Requiere 'Reconstruir better-sqlite3 para Node' { npm run rebuild:node }
  Requiere 'Compilar herramienta CLI de semilla' { npx tsc -p tsconfig.node.json --outDir dist }

  Write-Host @"

PASO 1 (MANUAL, GUI): sembrar con la versión ANTERIOR
  a) Instalar '$InstaladorAnterior' en '$DestinoInstalacion' (NO en el perfil operativo).
  b) Abrir el BINARIO INSTALADO con el perfil QA:
     set ARKON_RUTA_DATOS=$Perfil
     & (Join-Path $DestinoInstalacion 'ARKON Contabilidad.exe') --user-data-dir="$(Join-Path $Perfil 'chromium')"
  c) Registrar datos sintéticos (contraparte, venta, adjunto) desde la GUI y cerrar.
  ALTERNATIVA CLI (sin GUI): node dist/scripts/semilla-qa.js sembrar --perfil "$Perfil" --manifiesto "$Manifiesto"

PASO 2 (CLI): respaldo previo a actualizar
  node dist/scripts/semilla-qa.js respaldar --perfil "$Perfil" --manifiesto "$Manifiesto"

PASO 3 (MANUAL, GUI): instalar la versión NUEVA
  Ejecutar '$InstaladorNuevo' sobre el MISMO destino '$DestinoInstalacion' (conserva datos del perfil).
  NO abrir la app todavía.

PASO 4 (CLI): verificación independiente tras actualizar
  node dist/scripts/semilla-qa.js verificar --perfil "$Perfil" --manifiesto "$Manifiesto"
  Estados: PASA/FALLA por comprobación; exit 2 si algo falla. NADA se aprueba solo por proceso activo.

PASO 5 (MANUAL, GUI): recorrido gráfico offline con el binario instalado nuevo
  Captura, doble envío (idempotencia), anulación, CSV/PDF, adjuntos, reportes anuales,
  respaldo/restauración, cierre y reapertura. Ver docs\MANUAL-USUARIO.md y docs\QA-WINDOWS.md.

REGRESIÓN/ROLLBACK: si el PASO 4 falla, restaurar desde el respaldo del PASO 2 (vista Respaldo
de la versión anterior) y reportar el hallazgo con el manifiesto como evidencia.
"@
}
finally {
  if ($envAnteriorRuta) { $env:ARKON_RUTA_DATOS = $envAnteriorRuta }
  else { Remove-Item Env:\ARKON_RUTA_DATOS -ErrorAction SilentlyContinue }
  Write-Host "`nVariable ARKON_RUTA_DATOS restaurada. Perfiles QA NO se eliminan automáticamente."
}
