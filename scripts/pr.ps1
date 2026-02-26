param(
  [Parameter(Mandatory = $true)]
  [Alias("m")]
  [string]$Message,

  [Alias("t")]
  [string]$Title,

  [Alias("b")]
  [string]$Body,

  [Alias("base")]
  [string]$BaseBranch = "main",

  [string]$Branch,

  [switch]$Yes,

  [switch]$DryRun,

  [string[]]$Paths
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function ResolveGit {
  $cmd = Get-Command git.exe -ErrorAction SilentlyContinue
  if ($cmd -and $cmd.CommandType -eq "Application") { return $cmd.Source }
  $cmd = Get-Command git -ErrorAction SilentlyContinue
  if ($cmd -and $cmd.CommandType -eq "Application") { return $cmd.Source }
  throw "git executable not found. Install Git for Windows and ensure git.exe is on PATH."
}

function Exec {
  param([Parameter(Mandatory = $true)][string]$Command)
  Write-Host ">> $Command"
  & powershell -NoProfile -Command $Command
  if ($LASTEXITCODE -ne 0) { throw "Command failed ($LASTEXITCODE): $Command" }
}

$git = ResolveGit

function Git {
  param([Parameter(Mandatory = $true)][string[]]$Args)
  $cmd = "git " + ($Args -join " ")
  Write-Host ">> $cmd"
  & $git @Args
  if ($LASTEXITCODE -ne 0) { throw "git failed ($LASTEXITCODE): $cmd" }
}

function GitTry {
  param([Parameter(Mandatory = $true)][string[]]$Args)
  # Suppress native stderr -> error records even under StrictMode/ErrorActionPreference=Stop.
  $old = $ErrorActionPreference
  $ErrorActionPreference = "SilentlyContinue"
  try {
    & $git @Args 1>$null 2>$null
  } finally {
    $ErrorActionPreference = $old
  }
  return $LASTEXITCODE
}

function ResolveGh {
  $candidates = @("gh", "C:\Program Files\GitHub CLI\gh.exe")
  foreach ($c in $candidates) {
    try {
      & $c --version *> $null
      return $c
    } catch {
      continue
    }
  }
  throw "GitHub CLI not found. Install gh, or ensure it's on PATH."
}

function Slugify([string]$Value) {
  $s = $Value.ToLowerInvariant()
  $s = ($s -replace "[^a-z0-9]+", "-").Trim("-")
  if ($s.Length -gt 48) { $s = $s.Substring(0, 48).Trim("-") }
  if (-not $s) { $s = "change" }
  return $s
}

$gh = ResolveGh

$currentBranch = (& $git rev-parse --abbrev-ref HEAD).Trim()
if (-not $currentBranch) { throw "Unable to determine current git branch." }

if (-not $Branch) {
  if ($currentBranch -eq $BaseBranch -or $currentBranch -eq "master") {
    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $Branch = "$(Slugify $Message)-$stamp"
  } else {
    $Branch = $currentBranch
  }
}

$status = (& $git status --porcelain)
if (-not $status) {
  Write-Host "No changes to commit."
  exit 0
}

Write-Host "Working tree:"
Write-Host $status
Write-Host "Current branch: $currentBranch"
Write-Host "Target branch:  $Branch"

if ($DryRun) {
  Write-Host "Dry run only; no changes applied."
  exit 0
}

if ($currentBranch -ne $Branch) {
  # Create/switch branch from current HEAD (usually base branch).
  if ((GitTry @("rev-parse", "--verify", $Branch)) -eq 0) {
    Git @("switch", $Branch)
  } else {
    Git @("switch", "-c", $Branch)
  }
  $currentBranch = $Branch
}

if (-not $Yes) {
  $answer = Read-Host "Stage + commit these changes and open/update a PR? (y/N)"
  if ($answer.Trim().ToLowerInvariant() -ne "y") {
    Write-Host "Aborted."
    exit 1
  }
}

if ($Paths -and $Paths.Count -gt 0) {
  $gitArgs = @("add", "--") + $Paths
  Git $gitArgs
} else {
  Git @("add", "-A")
}

Git @("commit", "-m", $Message)

# Push (set upstream if missing)
if ((GitTry @("rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}")) -ne 0) {
  Git @("push", "-u", "origin", $currentBranch)
} else {
  Git @("push")
}

if (-not $Title) { $Title = $Message }
if (-not $Body) {
  $Body = @"
Automated PR created by scripts/pr.ps1.

Commit: $(( & $git rev-parse --short HEAD).Trim())
"@.Trim()
}

# Create PR if missing, else update title/body.
try {
  & $gh pr view --json number,url *> $null
  $prExists = $true
} catch {
  $prExists = $false
}

if (-not $prExists) {
  & $gh pr create --base $BaseBranch --head $currentBranch --title $Title --body $Body
} else {
  & $gh pr edit --title $Title --body $Body
}
