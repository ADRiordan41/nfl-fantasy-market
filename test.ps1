Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = $PSScriptRoot
$venvPython = Join-Path $repoRoot ".venv\Scripts\python.exe"
$requirements = Join-Path $repoRoot "backend\requirements.txt"

if (Test-Path $venvPython) {
  if (Test-Path $requirements) {
    & $venvPython -m pip install -r $requirements
    if ($LASTEXITCODE -ne 0) {
      exit $LASTEXITCODE
    }
  }
  & $venvPython -m pytest @args
  exit $LASTEXITCODE
}

Write-Host "Repo venv not found; falling back to the first python on PATH."
if (Test-Path $requirements) {
  python -m pip install -r $requirements
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }
}
python -m pytest @args
exit $LASTEXITCODE
