# QA de ARKON Contabilidad en Windows con perfil temporal exclusivo FUERA de OneDrive.
# Uso: powershell -ExecutionPolicy Bypass -File scripts\qa-windows.ps1 [-ConInstalador]
param(
  [switch]$ConInstalador
)

$ErrorActionPreference = 'Stop'
$raizRepo = Split-Path -Parent $PSScriptRoot
Set-Location $raizRepo

# Perfil temporal exclusivo fuera de OneDrive (LOCALAPPDATA nunca está en OneDrive).
$perfil = Join-Path $env:LOCALAPPDATA ("ARKON-QA-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $perfil | Out-Null
Write-Host "Perfil QA aislado: $perfil"

function Requiere([string]$paso, [scriptblock]$bloque) {
  Write-Host "`n== $paso =="
  & $bloque
  if ($LASTEXITCODE -ne 0) { throw "Fallo en: $paso (código $LASTEXITCODE)" }
}

try {
  Requiere 'Instalar dependencias reproducibles' { npm ci }
  Requiere 'Typecheck de las tres capas' { npm run typecheck }
  Requiere 'Reconstruir better-sqlite3 para Node y ejecutar la suite' { npm test }
  Requiere 'Build main + preload empaquetado + renderer' { npm run build }
  if ($ConInstalador) {
    Requiere 'Instalador NSIS (electron-builder)' { npm run dist:win }
    Write-Host "Instalador generado en dist\win-uninstall y dist\*.exe (ver dist\)"
  }
  Requiere 'Arrancar la app con el perfil aislado' {
    $env:ARKON_RUTA_DATOS = $perfil
    Start-Process -FilePath "node_modules\.bin\electron.cmd" -ArgumentList "." -NoNewWindow
    # La app queda abierta para el recorrido manual; el perfil se limpia al final del script.
    return 0
  }
  Write-Host @"

PERFIL: $perfil
Recorrido manual sugerido (ver docs\QA-WINDOWS.md):
 1) Apertura sin ventana de error y creación de datos en el perfil (no en OneDrive).
 2) Captura de venta/compra con doble envío (idempotencia) y anulación con diálogo.
 3) Documentos: adjuntar con selector, verificar hash, abrir archivo.
 4) CSV/PDF por diálogos nativos; paquete del contador; Anexo 1/2/3 bloqueados sin activación.
 5) Respaldo manual y periódico; restauración con copia previa; reapertura offline.
"@ }
finally {
  Write-Host "`nEl perfil QA NO se elimina automáticamente: revíselo y borre $perfil al terminar."
}
