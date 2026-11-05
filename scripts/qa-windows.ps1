# QA de ARKON Contabilidad en Windows con perfil temporal exclusivo FUERA de OneDrive.
# Uso: powershell -ExecutionPolicy Bypass -File scripts\qa-windows.ps1 [-ConInstalador] [-Perfil <ruta>] [-SaltarSuite]
param(
  [switch]$ConInstalador,
  [string]$Perfil,
  [switch]$SaltarSuite
)

$ErrorActionPreference = 'Stop'
$raizRepo = Split-Path -Parent $PSScriptRoot
Set-Location $raizRepo
$envAnteriorRuta = $env:ARKON_RUTA_DATOS

# Perfil temporal exclusivo fuera de OneDrive (LOCALAPPDATA nunca está en OneDrive).
# Con -Perfil se reabre el mismo perfil QA de una ejecución anterior.
if (-not $Perfil) {
  $Perfil = Join-Path $env:LOCALAPPDATA ("ARKON-QA-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
}
New-Item -ItemType Directory -Path $Perfil -Force | Out-Null
$chromium = Join-Path $Perfil 'chromium'
New-Item -ItemType Directory -Path $chromium -Force | Out-Null
Write-Host "Perfil QA aislado: $Perfil"

function Requiere([string]$paso, [scriptblock]$bloque) {
  Write-Host "`n== $paso =="
  & $bloque
  if ($LASTEXITCODE -ne 0) { throw "Fallo en: $paso (código $LASTEXITCODE)" }
}

# Bloqueo de instancia: no abrir si ya hay un ARKON/electron de este repositorio corriendo.
$existente = Get-CimInstance Win32_Process -Filter "Name like 'electron%'" |
  Where-Object { $_.CommandLine -like "*$raizRepo*" }
if ($existente) {
  throw "Ya hay una instancia de ARKON/electron con este repositorio en ejecución. Ciérrala antes del QA."
}

try {
  Requiere 'Instalar dependencias reproducibles' { npm ci }
  Requiere 'Typecheck de las tres capas' { npm run typecheck }
  if (-not $SaltarSuite) {
    # npm test reconstruye better-sqlite3 para Node (ABI de Node) y ejecuta la suite.
    Requiere 'Suite con ABI de Node (rebuild incluido en npm test)' { npm test }
  }
  Requiere 'Build main + preload empaquetado + renderer' { npm run build }
  if ($ConInstalador) {
    # electron-builder reconstruye las dependencias nativas para Electron y genera el NSIS en paquete\.
    Requiere 'Instalador NSIS (salida en paquete\)' { npm run dist:win }
    Write-Host "Instalador generado en paquete\ (ver paquete\*.exe)"
  } else {
    # Reconstruir better-sqlite3 contra el ABI de Electron antes de abrir la app de desarrollo.
    Requiere 'Reconstruir dependencias nativas para Electron (ABI 130)' { npx electron-builder install-app-deps }
  }
  Requiere 'Arrancar la app con el perfil aislado (datos contables y Chromium separados)' {
    $env:ARKON_RUTA_DATOS = $Perfil
    $proceso = Start-Process -FilePath "node_modules\.bin\electron.cmd" `
      -ArgumentList ".", "--user-data-dir=$chromium" -PassThru
    Start-Sleep -Seconds 8
    if ($proceso.HasExited) {
      throw "La app se cerró durante el arranque (código $($proceso.ExitCode)); revisa el perfil $Perfil"
    }
    Write-Host "Proceso Electron activo (PID $($proceso.Id))."
    return 0
  }
  Write-Host @"

PERFIL: $Perfil
Recorrido manual sugerido (ver docs\QA-WINDOWS.md):
 1) Apertura sin ventana de error y creación de datos en el perfil (no en OneDrive).
 2) Captura de venta/compra con doble envío (idempotencia) y anulación con diálogo.
 3) Documentos: adjuntar con selector, verificar hash, abrir archivo.
 4) CSV/PDF por diálogos nativos; paquete del contador; Anexos 1/2/3 bloqueados sin activación.
 5) Respaldo manual y periódico; restauración con copia previa; reapertura offline.
IMPORTANTE: al terminar, ejecuta `npm run rebuild:node` para devolver better-sqlite3 al ABI de Node antes de `npm test`.
"@
}
finally {
  Remove-Item Env:\ARKON_RUTA_DATOS -ErrorAction SilentlyContinue
  if ($envAnteriorRuta) { $env:ARKON_RUTA_DATOS = $envAnteriorRuta }
  Write-Host "`nVariables de entorno restauradas. El perfil QA NO se elimina: revísalo y borre $Perfil solo si es de este QA."
}
