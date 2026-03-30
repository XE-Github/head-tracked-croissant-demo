[CmdletBinding()]
param(
  [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $scriptDir '..'))
$launcherScript = Join-Path $projectRoot 'scripts\start-demo.mjs'

function Write-Title([string]$Text) {
  Write-Host ''
  Write-Host $Text -ForegroundColor Cyan
}

function Write-Info([string]$Text) {
  Write-Host $Text -ForegroundColor Gray
}

function Write-WarnLine([string]$Text) {
  Write-Host $Text -ForegroundColor Yellow
}

function Write-ErrorLine([string]$Text) {
  Write-Host $Text -ForegroundColor Red
}

function Get-NodeDirectoryCandidates() {
  $candidates = @()

  if ($env:ProgramFiles) {
    $candidates += (Join-Path $env:ProgramFiles 'nodejs')
  }

  if (${env:ProgramFiles(x86)}) {
    $candidates += (Join-Path ${env:ProgramFiles(x86)} 'nodejs')
  }

  if ($env:LOCALAPPDATA) {
    $candidates += (Join-Path $env:LOCALAPPDATA 'Programs\nodejs')
  }

  return $candidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -Unique
}

function Refresh-NodePath() {
  $currentPathEntries = @($env:Path -split ';' | Where-Object { $_ })

  foreach ($candidate in (Get-NodeDirectoryCandidates)) {
    if ($currentPathEntries -notcontains $candidate) {
      $env:Path = "$candidate;$env:Path"
      $currentPathEntries = @($env:Path -split ';' | Where-Object { $_ })
    }
  }
}

function Get-NodeCommand() {
  $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
  if ($nodeCommand) {
    return $nodeCommand.Source
  }

  Refresh-NodePath
  $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
  if ($nodeCommand) {
    return $nodeCommand.Source
  }

  foreach ($candidateDir in (Get-NodeDirectoryCandidates)) {
    $candidate = Join-Path $candidateDir 'node.exe'
    if (Test-Path $candidate) {
      return $candidate
    }
  }

  return $null
}

function Get-NodeVersion([string]$NodeCommand) {
  if (-not $NodeCommand) {
    return $null
  }

  $versionText = & $NodeCommand --version 2>$null
  if (-not $versionText) {
    return $null
  }

  return $versionText.Trim().TrimStart('v')
}

function Test-NodeVersionSupported([string]$VersionText) {
  if (-not $VersionText) {
    return $false
  }

  try {
    $parts = $VersionText.Split('.')
    $major = [int]$parts[0]
    $minor = [int]$parts[1]
    return ($major -gt 20) -or ($major -eq 20 -and $minor -ge 19)
  } catch {
    return $false
  }
}

function Install-NodeWithWinget([bool]$UpgradeExistingNode) {
  $winget = Get-Command winget -ErrorAction SilentlyContinue
  if (-not $winget) {
    return $false
  }

  $verb = if ($UpgradeExistingNode) { 'upgrade' } else { 'install' }

  Write-Title 'Node.js setup'
  Write-Info 'Node.js was not found or is too old. Trying to install the official LTS release with winget.'
  Write-Info 'If Windows asks for confirmation, please allow it. The first install can take a little while.'

  $arguments = @(
    $verb,
    '--id', 'OpenJS.NodeJS.LTS',
    '-e',
    '--accept-package-agreements',
    '--accept-source-agreements',
    '--disable-interactivity'
  )

  if (-not $UpgradeExistingNode) {
    $arguments += '--silent'
  }

  $process = Start-Process -FilePath $winget.Source -ArgumentList $arguments -Wait -PassThru -NoNewWindow
  Refresh-NodePath

  return $process.ExitCode -eq 0
}

function Get-NodeMsiArchitecture() {
  $architecture = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString().ToUpperInvariant()
  switch ($architecture) {
    'ARM64' { return 'arm64' }
    default { return 'x64' }
  }
}

function Install-NodeWithMsi() {
  Write-Title 'Node.js setup'
  Write-Info 'winget is unavailable or did not complete successfully. Trying the official Node.js installer next.'

  $nodeIndex = Invoke-RestMethod -Uri 'https://nodejs.org/dist/index.json'
  $ltsV20 = $nodeIndex |
    Where-Object { $_.version -like 'v20.*' -and $_.lts } |
    Sort-Object { [version]$_.version.TrimStart('v') } -Descending |
    Select-Object -First 1

  if (-not $ltsV20) {
    throw 'Unable to retrieve Node.js 20 LTS installer information.'
  }

  $arch = Get-NodeMsiArchitecture
  $installerFileName = "node-$($ltsV20.version)-$arch.msi"
  $installerUrl = "https://nodejs.org/dist/$($ltsV20.version)/$installerFileName"
  $downloadDir = Join-Path $env:TEMP 'head-tracked-demo-bootstrap'
  $installerPath = Join-Path $downloadDir $installerFileName

  New-Item -ItemType Directory -Force -Path $downloadDir | Out-Null
  Invoke-WebRequest -Uri $installerUrl -OutFile $installerPath

  Write-Info "Downloaded $installerFileName and starting the installer now."
  Write-Info 'If Windows asks for administrator permission, please allow it.'

  $process = Start-Process -FilePath 'msiexec.exe' -ArgumentList @('/i', $installerPath, '/passive', '/norestart') -Wait -PassThru
  Refresh-NodePath

  if ($process.ExitCode -ne 0) {
    throw "The Node.js installer exited with code $($process.ExitCode)."
  }

  return $true
}

function Ensure-NodeAvailable() {
  $nodeCommand = Get-NodeCommand
  $nodeVersion = Get-NodeVersion $nodeCommand

  if ($nodeCommand -and (Test-NodeVersionSupported $nodeVersion)) {
    Write-Title 'Environment check'
    Write-Info "Detected Node.js $nodeVersion"
    return $nodeCommand
  }

  if ($nodeCommand -and $nodeVersion) {
    Write-WarnLine "Detected Node.js $nodeVersion, but this project requires 20.19.0 or newer."
  } else {
    Write-WarnLine 'No supported Node.js installation was found on this PC.'
  }

  $installSucceeded = $false

  try {
    $installSucceeded = Install-NodeWithWinget -UpgradeExistingNode ([bool]$nodeCommand)
  } catch {
    Write-WarnLine "winget did not complete successfully: $($_.Exception.Message)"
  }

  $nodeCommand = Get-NodeCommand
  $nodeVersion = Get-NodeVersion $nodeCommand
  if ($installSucceeded -and $nodeCommand -and (Test-NodeVersionSupported $nodeVersion)) {
    Write-Info "Node.js is ready. Current version: $nodeVersion"
    return $nodeCommand
  }

  try {
    Install-NodeWithMsi | Out-Null
  } catch {
    Write-ErrorLine "Automatic Node.js setup failed: $($_.Exception.Message)"
  }

  $nodeCommand = Get-NodeCommand
  $nodeVersion = Get-NodeVersion $nodeCommand
  if ($nodeCommand -and (Test-NodeVersionSupported $nodeVersion)) {
    Write-Info "Node.js is ready. Current version: $nodeVersion"
    return $nodeCommand
  }

  Write-ErrorLine 'A supported Node.js installation is still not available.'
  Write-Info 'Opening the official Node.js download page now. Install Node.js and run start-demo.bat again.'
  Start-Process 'https://nodejs.org/en/download'
  exit 1
}

function Show-StartupGuide() {
  Write-Title 'Usage guide'
  Write-Info '1. On the first run, missing dependencies will be installed automatically. This can take 1 to 3 minutes.'
  Write-Info '2. The browser will open http://127.0.0.1:5173 automatically.'
  Write-Info '3. When the browser asks for camera access, click Allow.'
  Write-Info '4. Move your head left, right, up, and down to inspect the fixed cube and room box from different viewpoints.'
  Write-Info '5. Single-hand pinch rotates the cube. Dual-hand pinch scales and twists the cube.'
  Write-Info '6. If the camera is unavailable, the app will automatically fall back to mouse preview mode.'
  Write-Info '7. Close this terminal window or press Ctrl+C when you want to stop the demo.'
}

function Run-Launcher([string]$NodeCommand, [string[]]$ExtraArgs) {
  Push-Location $projectRoot
  try {
    & $NodeCommand $launcherScript @ExtraArgs
    exit $LASTEXITCODE
  } finally {
    Pop-Location
  }
}

Write-Title 'Head Tracked Fixed Object Demo'
Write-Info 'This Windows launcher checks the environment automatically and installs Node.js when it is missing.'

$nodeCommand = Ensure-NodeAvailable

if ($DryRun) {
  Write-Title 'Startup dry run'
  Write-Info 'Checking Node.js and dependency readiness without launching the browser.'
  Run-Launcher -NodeCommand $nodeCommand -ExtraArgs @('--dry-run')
}

Show-StartupGuide
Run-Launcher -NodeCommand $nodeCommand -ExtraArgs @()
