param(
  [string]$ConfigPath = "private-values.json"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -Path $ConfigPath)) {
  Write-Error "Missing $ConfigPath. Copy private-values.example.json to private-values.json and fill your real values."
}

$config = Get-Content -Path $ConfigPath -Raw | ConvertFrom-Json
if (-not $config.replacements) {
  Write-Error "Invalid config: expected a 'replacements' object."
}

$targetFiles = @(
  "README.md",
  "Contactform_endpoint.ts",
  "contactform_endpoint.js",
  "Webflow Script.yaml",
  "Lovable Script.yaml",
  "SITE_CONFIG.json",
  "docs/index.html",
  "docs/CNAME",
  "CNAME",
  "docs/admin/app.js",
  "docs/admin/index.html"
)

foreach ($relativePath in $targetFiles) {
  if (-not (Test-Path -Path $relativePath)) {
    Write-Warning "Skipped missing file: $relativePath"
    continue
  }

  $content = Get-Content -Path $relativePath -Raw
  $updated = $content

  foreach ($pair in $config.replacements.PSObject.Properties) {
    $from = [string]$pair.Name
    $to = [string]$pair.Value
    $updated = $updated.Replace($from, $to)
  }

  if ($updated -ne $content) {
    Set-Content -Path $relativePath -Value $updated -NoNewline
    Write-Host "Updated $relativePath"
  } else {
    Write-Host "No changes in $relativePath"
  }
}

Write-Host ""
Write-Host "Private values applied."
Write-Host "Tip: before pushing public, restore anonymized files with:"
Write-Host "  git restore README.md Contactform_endpoint.ts contactform_endpoint.js 'Webflow Script.yaml' 'Lovable Script.yaml' SITE_CONFIG.json docs/index.html docs/CNAME CNAME docs/admin/app.js docs/admin/index.html"
