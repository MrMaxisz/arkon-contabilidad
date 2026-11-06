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
if (-not [System.IO.Path]::IsPathRooted($Perfil)) { throw "El perfil debe ser ABSOLUTO: $Perfil" }
$Perfil = [System.IO.Path]::GetFullPath($Perfil)
if ($Perfil -like "*OneDrive*") { throw "El perfil no puede estar bajo OneDrive: $Perfil" }
$operativo = Join-Path $env:LOCALAPPDATA 'ARKON Contabilidad'
$perfilLower = $Perfil.ToLowerInvariant().TrimEnd('\') + '\'
$operativoLower = [System.IO.Path]::GetFullPath($operativo).ToLowerInvariant().TrimEnd('\') + '\'
if ($perfilLower -eq $operativoLower) { throw "El perfil no puede ser la base operativa: $Perfil" }
if ($perfilLower.StartsWith($operativoLower)) { throw "El perfil no puede ser subruta de la base operativa: $Perfil" }
New-Item -ItemType Directory -Path $Perfil -Force | Out-Null
# Marcador QA ÚNICO alineado con el CLI (QA-MARCADOR-ARKON.txt): solo en perfil nuevo vacío;
# un perfil existente sin marcador se rechaza (no se marcan perfiles de origen desconocido).
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
  Requiere 'Typecheck de las cuatro capas' { npm run typecheck }
  # Compilar main y CLI ANTES de la suite: las pruebas dependientes de dist fallan en checkout limpio.
  Requiere 'Compilar main (requisito de pruebas que importan dist)' { npm run build:main }
  Requiere 'Compilar CLI de semilla (requisito de pruebas del pipeline)' { npm run build:cli }
  if (-not $SaltarSuite) {
    # npm test reconstruye better-sqlite3 para Node (ABI de Node) y ejecuta la suite.
    Requiere 'Suite con ABI de Node (rebuild incluido en npm test)' { npm test }
  }
  Requiere 'Build main + preload empaquetado + renderer' { npm run build }
  if ($ConInstalador) {
    # Pipeline REAL completo: rebuild explícito → probe con Electron → build → NSIS → verificación de artefacto.
    # Exige artefacto y hash verificados antes de anunciar éxito; falla con error inequívoco en caso contrario.
    Requiere 'Pipeline ABI completo (rebuild→probe→build→NSIS→verificación)' { npm run dist:win:qa }
    $nsis = Get-ChildItem -Path (Join-Path $raizRepo 'paquete') -Filter '*.exe' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $nsis) {
      throw 'FALLO: dist:win:qa terminó pero no se encontró el instalador NSIS en paquete\. Sin artefacto no hay éxito.'
    }
    $hash = (Get-FileHash $nsis.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    Write-Host "Instalador generado y verificado: $($nsis.FullName)"
    Write-Host "SHA256: $hash"
  } else {
    # Camino de DESARROLLO: rebuild explícito + probe verificado (NO install-app-deps suelto).
    Requiere 'Reconstruir better-sqlite3 para Electron (ABI explícito)' { node scripts/rebuild-electron.mjs }
    Requiere 'Probe de ABI con Electron real' { node scripts/probe-electron-abi.mjs }
  }
  Requiere 'Arrancar la app con el perfil aislado (datos contables y Chromium separados)' {
    $env:ARKON_RUTA_DATOS = $Perfil
    $proceso = Start-Process -FilePath "node_modules\.bin\electron.cmd" `
      -ArgumentList ".", "--user-data-dir=$chromium" -PassThru
    Start-Sleep -Seconds 8
    if ($proceso.HasExited) {
      throw "La app se cerró durante el arranque (código $($proceso.ExitCode)); revisa el perfil $Perfil"
    }
    Write-Host "Proceso de DESARROLLO activo (PID $($proceso.Id)). NOTA: esto NO certifica el binario instalado; la aceptación real requiere el NSIS instalado (ver scripts\aceptacion-dos-versiones.ps1)."
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
  if ($envAnteriorRuta) { $env:ARKON_RUTA_DATOS = $envAnteriorRuta }
  else { Remove-Item Env:\ARKON_RUTA_DATOS -ErrorAction SilentlyContinue }
  Write-Host "`nVariables de entorno restauradas. El perfil QA NO se elimina: revísalo y borre $Perfil solo si es de este QA."
}
