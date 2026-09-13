param(
  [string]$OutputRoot = "backups/d1",
  [string]$Environment = "production"
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$wrangler = Join-Path $projectRoot "node_modules/.bin/wrangler.cmd"

if (-not (Test-Path -LiteralPath $wrangler)) {
  throw "No se encontró Wrangler local. Ejecuta npm install en el proyecto."
}

$timestamp = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$backupDirectory = Join-Path $projectRoot (Join-Path $OutputRoot $timestamp)
New-Item -ItemType Directory -Path $backupDirectory | Out-Null

$databases = @(
  "whatsapp-webhook-meta-db",
  "gamarra_db"
)

foreach ($database in $databases) {
  $outputFile = Join-Path $backupDirectory "$database.sql"
  & $wrangler d1 export $database --remote --env $Environment --output $outputFile --skip-confirmation
  if ($LASTEXITCODE -ne 0) {
    throw "Falló la exportación de D1: $database"
  }
}

& node --no-warnings (Join-Path $PSScriptRoot "verify-d1-backup.mjs") `
  (Join-Path $backupDirectory "whatsapp-webhook-meta-db.sql") `
  (Join-Path $backupDirectory "gamarra_db.sql")

if ($LASTEXITCODE -ne 0) {
  throw "Los respaldos se descargaron, pero la verificación falló."
}

Write-Output "Respaldos D1 verificados en: $backupDirectory"
