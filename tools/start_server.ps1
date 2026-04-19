param(
  [int]$Port = 5500,
  [string]$PagePath = "index2.html",
  [string]$Dataset = "",
  [switch]$Foreground,
  [switch]$NoOpen
)

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $repoRoot

$pythonLauncher = $null
$pythonPrefix = @()

$pythonCmd = Get-Command python -ErrorAction SilentlyContinue
if ($pythonCmd) {
  $pythonLauncher = $pythonCmd.Source
}
else {
  $pyCmd = Get-Command py -ErrorAction SilentlyContinue
  if ($pyCmd) {
    $pythonLauncher = $pyCmd.Source
    $pythonPrefix = @("-3")
  }
}

if (-not $pythonLauncher) {
  throw "Python was not found in PATH. Install Python or update PATH, then retry."
}

$normalizedPagePath = $PagePath.TrimStart('/')
$baseUrl = "http://localhost:{0}/{1}" -f $Port, $normalizedPagePath

if ([string]::IsNullOrWhiteSpace($Dataset)) {
  $targetUrl = $baseUrl
}
else {
  $targetUrl = "{0}?dataset={1}" -f $baseUrl, [uri]::EscapeDataString($Dataset)
}

if ($Foreground) {
  if (-not $NoOpen) {
    Start-Process $targetUrl
  }
  & $pythonLauncher @pythonPrefix -m http.server $Port
  exit $LASTEXITCODE
}

$serverArgs = @()
$serverArgs += $pythonPrefix
$serverArgs += @("-m", "http.server", $Port)

$serverProcess = Start-Process -FilePath $pythonLauncher -ArgumentList $serverArgs -WorkingDirectory $repoRoot -PassThru
Start-Sleep -Seconds 1

if ($serverProcess.HasExited) {
  throw "Server failed to start."
}

if (-not $NoOpen) {
  Start-Process $targetUrl
}

Write-Host "Server started at http://localhost:$Port"
if ($NoOpen) {
  Write-Host "Landing page URL: $targetUrl"
}
else {
  Write-Host "Landing page opened: $targetUrl"
}
Write-Host "Server PID: $($serverProcess.Id)"
Write-Host "Stop with: Stop-Process -Id $($serverProcess.Id)"
