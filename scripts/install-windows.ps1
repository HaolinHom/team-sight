#requires -Version 7.0
param(
  [ValidateSet('Install','Start','Status','Stop','Uninstall','Run')][string]$Action = 'Status',
  [string]$PackagePath,
  [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'TeamSight MCP'),
  [string]$CodexHome = $(if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $env:USERPROFILE '.codex' }),
  [ValidateRange(1024,65535)][int]$Port = 43127
)
$ErrorActionPreference = 'Stop'
$InstallRoot = [IO.Path]::GetFullPath($InstallRoot)
$CodexHome = [IO.Path]::GetFullPath($CodexHome)
$statePath = Join-Path $InstallRoot 'installer-state.json'
$dataPath = Join-Path $InstallRoot 'data-mcp'
$configPath = Join-Path $CodexHome 'config.toml'
$manager = Join-Path $InstallRoot 'install-windows.ps1'
$helper = Join-Path $InstallRoot 'windows-config.cjs'
$shellPath = (Get-Process -Id $PID).Path
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$state = $null
function Protect-Path([string]$Path) {
  $isDirectory = Test-Path -LiteralPath $Path -PathType Container
  # Create only a DACL: copying Get-Acl's descriptor can try to write SACLs and
  # require SeSecurityPrivilege on a second install by a non-admin user.
  $acl = if ($isDirectory) { New-Object Security.AccessControl.DirectorySecurity } else { New-Object Security.AccessControl.FileSecurity }
  $acl.SetAccessRuleProtection($true, $false)
  $inherit = if ($isDirectory) { [Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit' } else { [Security.AccessControl.InheritanceFlags]::None }
  foreach ($identity in @($sid,'S-1-5-18','S-1-5-32-544')) {
    $rule = New-Object Security.AccessControl.FileSystemAccessRule([Security.Principal.SecurityIdentifier]$identity,'FullControl',$inherit,[Security.AccessControl.PropagationFlags]::None,'Allow')
    $acl.AddAccessRule($rule)
  }
  if ($isDirectory) { [IO.FileSystemAclExtensions]::SetAccessControl([IO.DirectoryInfo]::new($Path),$acl) }
  else { [IO.FileSystemAclExtensions]::SetAccessControl([IO.FileInfo]::new($Path),$acl) }
}
function Assert-LocalPath([string]$Path) {
  for ($p = [IO.Path]::GetFullPath($Path); $p; $p = Split-Path -Parent $p) {
    if ((Test-Path -LiteralPath $p) -and ((Get-Item -LiteralPath $p -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'LINK_PATH_REFUSED' }
    if ($p -eq [IO.Path]::GetPathRoot($p)) { break }
  }
}
function Invoke-Entry([string[]]$EntryArgs) {
  $output = & $shellPath -NoProfile -NonInteractive -File (Join-Path $state.packageDir 'launch.ps1') @EntryArgs
  if ($LASTEXITCODE -ne 0) { throw 'SERVICE_COMMAND_FAILED' }
  return ($output | Out-String).Trim()
}
function Invoke-Helper([string[]]$HelperArgs) {
  $output = & (Join-Path $state.packageDir 'runtime\node.exe') $helper @HelperArgs
  if ($LASTEXITCODE -ne 0) { throw 'CONFIG_OR_PAYLOAD_FAILED' }
  return ($output | Out-String).Trim()
}
function Get-ManagedTask {
  $task = Get-ScheduledTask -TaskName $state.taskName -ErrorAction SilentlyContinue
  if ($task) {
    $taskSid = if ($task.Principal.UserId -like 'S-1-*') { $task.Principal.UserId } else { ([Security.Principal.NTAccount]$task.Principal.UserId).Translate([Security.Principal.SecurityIdentifier]).Value }
    if ($task.Actions.Execute -ne $shellPath -or $task.Actions.Arguments -ne $state.taskArguments -or $taskSid -ne $sid) { throw 'MANAGED_TASK_CHANGED' }
  }
  return $task
}
function Read-Health {
  $info = Get-Content -Raw -LiteralPath (Join-Path $dataPath 'instance.json') | ConvertFrom-Json
  if ($info.url -ne "http://127.0.0.1:$($state.port)/mcp" -or $info.dataDir -ne $dataPath) { throw 'INSTANCE_IDENTITY_MISMATCH' }
  $value = Invoke-Entry @('status','--data-dir',$dataPath) | ConvertFrom-Json
  if ($value.instanceId -ne $info.instanceId -or $value.pid -ne $info.pid) { throw 'INSTANCE_IDENTITY_MISMATCH' }
  $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($info.pid)"
  if ($process.ExecutablePath -ne (Join-Path $state.packageDir 'runtime\node.exe') -or -not $process.CommandLine.Contains($dataPath)) { throw 'INSTANCE_PROCESS_MISMATCH' }
  return $value
}
function Wait-Ready {
  for ($i=0; $i -lt 60; $i++) { try { return Read-Health } catch { Start-Sleep -Milliseconds 500 } }
  throw 'SERVICE_START_TIMEOUT'
}
function Stop-Managed {
  $task = Get-ManagedTask
  if ($task) { Disable-ScheduledTask -TaskName $state.taskName | Out-Null }
  if (Test-Path -LiteralPath (Join-Path $dataPath 'instance.lock')) {
    Read-Health | Out-Null
    Invoke-Entry @('stop','--data-dir',$dataPath) | Out-Null
    for ($i=0; $i -lt 60 -and (Test-Path -LiteralPath (Join-Path $dataPath 'instance.lock')); $i++) { Start-Sleep -Milliseconds 500 }
    if (Test-Path -LiteralPath (Join-Path $dataPath 'instance.lock')) { throw 'SERVICE_STOP_TIMEOUT' }
  }
  for ($i=0; $i -lt 30 -and (Get-ManagedTask).State -eq 'Running'; $i++) { Start-Sleep -Milliseconds 500 }
}
Assert-LocalPath $InstallRoot
if (Test-Path -LiteralPath $statePath) {
  $state = Get-Content -Raw -LiteralPath $statePath | ConvertFrom-Json
  if ($state.schema -ne 1 -or $state.sid -ne $sid -or $state.base -ne $InstallRoot -or $state.packageDir -ne (Join-Path $InstallRoot 'versions\0.3.4-bundled')) { throw 'INSTALLER_STATE_MISMATCH' }
  $CodexHome = $state.codexHome; $configPath = Join-Path $CodexHome 'config.toml'
  if ((Get-FileHash -LiteralPath $manager -Algorithm SHA256).Hash -ne $state.managerHash -or (Get-FileHash -LiteralPath $helper -Algorithm SHA256).Hash -ne $state.helperHash) { throw 'MANAGED_FILES_CHANGED' }
  Invoke-Helper @('verify',$state.packageDir) | Out-Null
}
if ($Action -eq 'Run') {
  if (-not $state) { throw 'NO_MANAGED_INSTALLATION' }
  Remove-Item Env:NODE_OPTIONS -ErrorAction SilentlyContinue
  Remove-Item Env:NODE_PATH -ErrorAction SilentlyContinue
  & (Join-Path $state.packageDir 'launch.ps1') serve --data-dir $dataPath --port $state.port 1>> (Join-Path $InstallRoot 'logs\stdout.log') 2>> (Join-Path $InstallRoot 'logs\stderr.log')
  exit $LASTEXITCODE
}
if ($Action -ne 'Install' -and -not $state) { throw 'NO_MANAGED_INSTALLATION' }
if ($Action -eq 'Status') {
  $task = Get-ManagedTask
  $health = if (Test-Path -LiteralPath (Join-Path $dataPath 'instance.lock')) { Read-Health } else { $null }
  @{ok=$true; task=$(if ($task) { [string]$task.State } else { 'missing' }); service=$health; dataDir=$dataPath} | ConvertTo-Json -Depth 5
  exit 0
}
if ($Action -eq 'Start') {
  if (-not (Get-ManagedTask)) { throw 'MANAGED_TASK_MISSING' }
  if (Test-Path -LiteralPath (Join-Path $dataPath 'instance.lock')) { Read-Health | ConvertTo-Json; exit 0 }
  Enable-ScheduledTask -TaskName $state.taskName | Out-Null
  Start-ScheduledTask -TaskName $state.taskName
  Wait-Ready | ConvertTo-Json
  exit 0
}
if ($Action -eq 'Stop') { Stop-Managed; @{ok=$true;stopped=$true} | ConvertTo-Json; exit 0 }
if ($Action -eq 'Uninstall') {
  Stop-Managed
  $backup = Join-Path $InstallRoot ('backups\uninstall-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
  New-Item -ItemType Directory -Path $backup -Force | Out-Null; Protect-Path $backup
  if (Test-Path -LiteralPath $configPath) {
    Copy-Item -LiteralPath $configPath -Destination (Join-Path $backup 'config.toml')
    Invoke-Helper @('remove',$configPath,$dataPath,"http://127.0.0.1:$($state.port)/mcp") | Out-Null
    Protect-Path ($configPath + '.teamsight-stage'); Move-Item -LiteralPath ($configPath + '.teamsight-stage') -Destination $configPath -Force
  }
  Unregister-ScheduledTask -TaskName $state.taskName -Confirm:$false
  # The fixed package path above was checked against the absolute installation root.
  Remove-Item -LiteralPath $state.packageDir -Recurse -Force
  Remove-Item -LiteralPath $statePath -Force
  @{ok=$true;uninstalled=$true;dataPreserved=$dataPath} | ConvertTo-Json
  exit 0
}
if ($state) {
  if (-not (Get-ManagedTask)) { throw 'MANAGED_TASK_MISSING' }
  if (Test-Path -LiteralPath (Join-Path $dataPath 'instance.lock')) { Read-Health | ConvertTo-Json }
  else { Enable-ScheduledTask -TaskName $state.taskName | Out-Null; Start-ScheduledTask -TaskName $state.taskName; Wait-Ready | ConvertTo-Json }
  exit 0
}
if (-not $PackagePath) { throw 'PACKAGE_PATH_REQUIRED' }
$PackagePath = [IO.Path]::GetFullPath($PackagePath); Assert-LocalPath $PackagePath; Assert-LocalPath $configPath
if (Test-Path -LiteralPath (Join-Path $dataPath 'instance.lock')) { throw 'UNMANAGED_INSTANCE' }
if (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue) { throw 'PORT_IN_USE' }
if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'windows-config.cjs'))) { throw 'BUILD_MANAGER_FIRST: node scripts/build-windows-manager.mjs' }
New-Item -ItemType Directory -Path $InstallRoot -Force | Out-Null; Protect-Path $InstallRoot
$lock = Join-Path $InstallRoot '.installer-lock'
New-Item -ItemType Directory -Path $lock -ErrorAction Stop | Out-Null
$created = $false; $registered = $false; $configWritten = $false; $originalConfig = $null
$target = Join-Path $InstallRoot 'versions\0.3.4-bundled'
try {
  if (Test-Path -LiteralPath $target) { throw 'INSTALL_TARGET_EXISTS' }
  foreach ($folder in @('versions','data-mcp','logs','backups')) { New-Item -ItemType Directory -Path (Join-Path $InstallRoot $folder) -Force | Out-Null }
  if ($PSCommandPath -ne $manager) {
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'windows-config.cjs') -Destination $helper -Force
    Copy-Item -LiteralPath $PSCommandPath -Destination $manager -Force
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'THIRD-PARTY-LICENSES.txt') -Destination (Join-Path $InstallRoot 'THIRD-PARTY-LICENSES.txt') -Force
  }
  $state = [pscustomobject]@{schema=1;sid=$sid;base=$InstallRoot;codexHome=$CodexHome;port=$Port;packageDir=$PackagePath}
  $verified = Invoke-Helper @('verify',$PackagePath) | ConvertFrom-Json
  Copy-Item -LiteralPath $PackagePath -Destination $target -Recurse; $created=$true; $state.packageDir=$target
  Invoke-Helper @('verify',$target) | Out-Null
  Invoke-Entry @('doctor') | Out-Null
  $sha = [Security.Cryptography.SHA256]::Create()
  $suffix = [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($InstallRoot))).Replace('-','').Substring(0,12)
  $taskName = 'TeamSight MCP-' + $suffix
  if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) { throw 'UNMANAGED_TASK' }
  $taskArguments = '-NoProfile -NonInteractive -WindowStyle Hidden -File "' + $manager + '" -Action Run -InstallRoot "' + $InstallRoot + '"'
  $state = [pscustomobject]@{schema=1;sid=$sid;base=$InstallRoot;codexHome=$CodexHome;port=$Port;packageDir=$target;taskName=$taskName;taskArguments=$taskArguments;managerHash=(Get-FileHash $manager -Algorithm SHA256).Hash;helperHash=(Get-FileHash $helper -Algorithm SHA256).Hash;manifestSha256=$verified.manifestSha256}
  $state | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding UTF8
  $taskAction = New-ScheduledTaskAction -Execute $shellPath -Argument $taskArguments -WorkingDirectory $InstallRoot
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $sid
  $principal = New-ScheduledTaskPrincipal -UserId $sid -LogonType Interactive -RunLevel Limited
  $settings = New-ScheduledTaskSettingsSet -Hidden -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
  Register-ScheduledTask -TaskName $taskName -Action $taskAction -Trigger $trigger -Principal $principal -Settings $settings | Out-Null; $registered=$true
  Start-ScheduledTask -TaskName $taskName
  $health = Wait-Ready
  New-Item -ItemType Directory -Path $CodexHome -Force | Out-Null
  $backup = Join-Path $InstallRoot ('backups\install-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
  New-Item -ItemType Directory -Path $backup -Force | Out-Null
  if (Test-Path -LiteralPath $configPath) { $originalConfig = [IO.File]::ReadAllBytes($configPath); Copy-Item -LiteralPath $configPath -Destination (Join-Path $backup 'config.toml') }
  Invoke-Helper @('configure',$configPath,$dataPath,"http://127.0.0.1:$Port/mcp") | Out-Null
  Protect-Path ($configPath + '.teamsight-stage')
  Move-Item -LiteralPath ($configPath + '.teamsight-stage') -Destination $configPath -Force; $configWritten=$true
  @{ok=$true;version=$health.version;node=$health.node;task=$taskName;dataDir=$dataPath;codexConnection='reconnect-required'} | ConvertTo-Json
} catch {
  $failure = $_
  if ($registered) { Stop-Managed; Unregister-ScheduledTask -TaskName $state.taskName -Confirm:$false }
  if ($configWritten) { if ($null -eq $originalConfig) { Remove-Item -LiteralPath $configPath -Force } else { [IO.File]::WriteAllBytes($configPath,$originalConfig); Protect-Path $configPath } }
  if ($created -and -not (Test-Path -LiteralPath (Join-Path $dataPath 'instance.lock'))) { Remove-Item -LiteralPath $target -Recurse -Force }
  Remove-Item -LiteralPath $statePath -Force -ErrorAction SilentlyContinue
  throw $failure
} finally { Remove-Item -LiteralPath $lock -Force }
