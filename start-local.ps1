Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-Step {
  param([string]$Message)
  Write-Host "[local-start] $Message"
}

function Wait-HttpOk {
  param(
    [Parameter(Mandatory = $true)][string]$Url,
    [int]$Attempts = 30,
    [int]$DelaySeconds = 2
  )

  for ($i = 1; $i -le $Attempts; $i++) {
    try {
      $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
        return $response.StatusCode
      }
    } catch {
      # Retry until attempts exhausted.
    }
    Start-Sleep -Seconds $DelaySeconds
  }

  throw "Timed out waiting for $Url"
}

Write-Step "Checking Docker availability..."
docker version *> $null

Write-Step "Starting backend services (db, redis, api)..."
docker compose up -d db redis api

Write-Step "Waiting for API health endpoint..."
$apiStatus = Wait-HttpOk -Url "http://localhost:8000/healthz" -Attempts 40 -DelaySeconds 2
Write-Step "API is responding (HTTP $apiStatus)."

$frontendPath = Join-Path $PSScriptRoot "frontend"
$runningFrontend = Get-CimInstance Win32_Process |
  Where-Object {
    $_.Name -match "node|npm" -and
    $_.CommandLine -match "next dev" -and
    $_.CommandLine -match [Regex]::Escape($frontendPath)
  } |
  Select-Object -First 1

if ($null -eq $runningFrontend) {
  Write-Step "Starting frontend dev server..."
  Start-Process -FilePath "npm.cmd" -ArgumentList "run", "dev" -WorkingDirectory $frontendPath | Out-Null
} else {
  Write-Step "Frontend dev server already running (PID $($runningFrontend.ProcessId))."
}

Write-Step "Waiting for frontend endpoint..."
$frontendStatus = Wait-HttpOk -Url "http://localhost:3000" -Attempts 40 -DelaySeconds 2
Write-Step "Frontend is responding (HTTP $frontendStatus)."

Write-Host ""
Write-Host "Local stack is up:"
Write-Host "  Backend:  http://localhost:8000"
Write-Host "  Frontend: http://localhost:3000"
