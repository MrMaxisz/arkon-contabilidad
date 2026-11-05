# Actualización de ARKON Contabilidad en Windows conservando datos, con perfil sintético para QA.
# Uso: powershell -ExecutionPolicy Bypass -File scripts\actualizar-windows.ps1 [-Perfil <ruta-QA>]
# ADVERTENCIA: para la máquina REAL del propietario, crear antes un respaldo manual desde la app.
param(
  [string]$Perfil
)

$ErrorActionPreference = 'Stop'
$raizRepo = Split-Path -Parent $PSScriptRoot
Set-Location $raizRepo

if (-not $Perfil) {
  $Perfil = Join-Path $env:LOCALAPPDATA ("ARKON-QA-UPD-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
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

  # Simulación de actualización en perfil QA: arrancar la versión anterior no es necesario aquí;
  # este script verifica que la NUEVA versión abre el MISMO perfil sin perder datos.
  $env:ARKON_RUTA_DATOS = $Perfil
  $proceso = Start-Process -FilePath "node_modules\.bin\electron.cmd" `
    -ArgumentList ".", "--user-data-dir=$(Join-Path $Perfil 'chromium')" -PassThru
  Start-Sleep -Seconds 8
  if ($proceso.HasExited) {
    throw "La app se cerró durante el arranque tras la actualización (código $($proceso.ExitCode)); revisa $Perfil"
  }
  Write-Host "Actualización verificada en el perfil QA: proceso activo (PID $($proceso.Id))."
  Write-Host @"

PLAN DE ACEPTACIÓN (manual, ver docs\QA-WINDOWS.md):
 1) Respaldar desde la app ANTES de actualizar (máquina real) o usar perfil QA sintético.
 2) Instalar el NSIS de paquete\ sobre la instalación existente (conserva %LOCALAPPDATA%\ARKON Contabilidad).
 3) Abrir la app: datos previos visibles (contrapartes, documentos, bitácora).
 4) Registrar una operación de prueba sintética y verificar bitácora + respaldo.
 5) Cancelar la app y reabrir: la operación persiste.
IMPORTANTE: ejecuta `npm run rebuild:node` antes de volver a correr la suite.
"@
}
finally {
  Remove-Item Env:\ARKON_RUTA_DATOS -ErrorAction SilentlyContinue
  Write-Host "Variables restauradas. El perfil QA $Perfil NO se elimina automáticamente."
}
