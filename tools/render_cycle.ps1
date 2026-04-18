param(
  [string]$ManifestPath = "asset/data/quizzes/manifest.json",
  [string]$PagePath = "index.html",
  [string]$BaseUrl = "",
  [ValidateSet("print", "open")]
  [string]$Mode = "print",
  [int]$DelaySeconds = 2,
  [int]$Limit = 0,
  [int]$StartIndex = 0
)

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $repoRoot

if (-not (Test-Path $ManifestPath)) {
  throw "Manifest not found: $ManifestPath"
}

$manifest = Get-Content $ManifestPath -Raw | ConvertFrom-Json
$datasets = @($manifest.datasets)
if ($datasets.Count -eq 0) {
  throw "No datasets found in manifest: $ManifestPath"
}

if ($StartIndex -lt 0) {
  $StartIndex = 0
}

if ($StartIndex -ge $datasets.Count) {
  throw "StartIndex $StartIndex is out of range for $($datasets.Count) datasets."
}

$selected = $datasets[$StartIndex..($datasets.Count - 1)]
if ($Limit -gt 0 -and $Limit -lt $selected.Count) {
  $selected = $selected[0..($Limit - 1)]
}

$urls = @()
foreach ($item in $selected) {
  $datasetPath = [string]$item.path
  if ([string]::IsNullOrWhiteSpace($datasetPath)) {
    continue
  }

  $queryUrl = "{0}?dataset={1}" -f $PagePath, [uri]::EscapeDataString($datasetPath)

  if ([string]::IsNullOrWhiteSpace($BaseUrl)) {
    $finalUrl = $queryUrl
  }
  else {
    $finalUrl = "{0}/{1}" -f $BaseUrl.TrimEnd('/'), $queryUrl.TrimStart('/')
  }

  $urls += $finalUrl
}

if ($urls.Count -eq 0) {
  throw "No valid dataset URLs were built from manifest."
}

Write-Host "Dataset count:" $urls.Count
for ($i = 0; $i -lt $urls.Count; $i++) {
  $label = "[{0:D2}]" -f ($i + 1)
  $url = $urls[$i]
  Write-Host "$label $url"

  if ($Mode -eq "open") {
    Start-Process $url
    if ($i -lt $urls.Count - 1 -and $DelaySeconds -gt 0) {
      Start-Sleep -Seconds $DelaySeconds
    }
  }
}

