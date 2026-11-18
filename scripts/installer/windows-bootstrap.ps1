& {
  $ErrorActionPreference = 'Stop'
  $version = '@VERSION@'
  $variant = '@VARIANT@'
  $archiveUrl = '@URL@'
  $archiveSha = '@ZIP_SHA@'
  $archiveSize = @ZIP_SIZE@
  $manifestSha = '@MANIFEST_SHA@'
  $runtimeSha = '@NODE_SHA@'
  $agentSha = '@AGENT_SHA@'
  $fixture = @FIXTURE@
  $utf8 = [Text.UTF8Encoding]::new($false)
  $systemShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $sid = $identity.User.Value
  if ($PSVersionTable.PSVersion -lt [version]'5.1' -or -not [Environment]::Is64BitProcess -or
      ($env:PROCESSOR_ARCHITECTURE -ne 'AMD64') -or ($env:PROCESSOR_ARCHITEW6432 -and $env:PROCESSOR_ARCHITEW6432 -ne 'AMD64')) { throw 'WINDOWS_X64_POWERSHELL_REQUIRED' }
  if (([Security.Principal.WindowsPrincipal]$identity).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'RUN_AS_STANDARD_USER' }
  $root = Join-Path $env:LOCALAPPDATA 'TeamSight MCP'
  $port = 43127
  if ($fixture) {
    $root = [IO.Path]::GetFullPath($env:TEAMSIGHT_TEST_ROOT)
    $port = [int]$env:TEAMSIGHT_TEST_PORT
    if ((Split-Path -Leaf $root) -notlike 'teamsight-installer-test-*' -or $port -lt 1024 -or $port -gt 65535 -or $port -eq 43127) { throw 'INVALID_FIXTURE' }
  }
  $root = [IO.Path]::GetFullPath($root)
  $data = Join-Path $root 'data-mcp'
  $instanceLock = Join-Path $data 'instance.lock'
  $statePath = Join-Path $root 'installer-state.json'
  $taskPath = '\'
  $hashAlgorithm = [Security.Cryptography.SHA256]::Create()
  try { $taskName = 'TeamSight MCP-' + [BitConverter]::ToString($hashAlgorithm.ComputeHash($utf8.GetBytes($root))).Replace('-','').Substring(0,12) }
  finally { $hashAlgorithm.Dispose() }

  function File-Hash($path) { (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() }
  function Extended-Path($path) { '\\?\' + $path }
  function Read-Json($path) { [IO.File]::ReadAllText($path) | ConvertFrom-Json }
  function Write-Utf8($path, $text) { [IO.File]::WriteAllText($path, $text, $utf8) }
  function Assert-Local($path) {
    $at = [IO.Path]::GetFullPath($path)
    if ($at -notmatch '^[A-Za-z]:\\') { throw 'LOCAL_PATH_REQUIRED' }
    for (;;) {
      $item = Get-Item -LiteralPath $at -Force -ErrorAction SilentlyContinue
      if ($item -and ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'LINK_PATH_REFUSED' }
      if ($at -eq [IO.Path]::GetPathRoot($at)) { return }
      $at = [IO.Path]::GetDirectoryName($at)
    }
  }
  function Protect-Path($path, [bool]$directory) {
    Assert-Local $path
    $acl = if ($directory) { [Security.AccessControl.DirectorySecurity]::new() } else { [Security.AccessControl.FileSecurity]::new() }
    $acl.SetAccessRuleProtection($true, $false)
    $inherit = if ($directory) { [Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit' } else { [Security.AccessControl.InheritanceFlags]::None }
    foreach ($account in @($sid,'S-1-5-18','S-1-5-32-544')) {
      $rule = [Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]$account,'FullControl',$inherit,'None','Allow')
      $acl.AddAccessRule($rule)
    }
    $item = if ($directory) { [IO.DirectoryInfo]::new($path) } else { [IO.FileInfo]::new($path) }
    if ($PSVersionTable.PSEdition -eq 'Core') { [IO.FileSystemAclExtensions]::SetAccessControl($item, $acl) }
    else { $item.SetAccessControl($acl) }
  }
  function New-ProtectedDirectory($path) {
    Assert-Local $path
    if (-not (Test-Path -LiteralPath $path -PathType Container)) { [IO.Directory]::CreateDirectory($path) | Out-Null }
    Protect-Path $path $true
  }
  function Remove-OwnedTree($path) {
    Assert-Local $path
    $full = [IO.Path]::GetFullPath($path)
    if (-not $full.StartsWith($root + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'CLEANUP_PATH_REFUSED' }
    if ([IO.Directory]::Exists($full)) { [IO.Directory]::Delete((Extended-Path $full), $true) }
  }
  function Move-Stage($from, $to) {
    foreach ($path in @($from,$to)) {
      Assert-Local $path
      if (-not [IO.Path]::GetFullPath($path).StartsWith($root + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'STAGING_PATH_REFUSED' }
    }
    [IO.Directory]::Move($from, $to)
  }
  function Invoke-Node($node, [string[]]$arguments, $errorCode) {
    $options = $env:NODE_OPTIONS; $nodePath = $env:NODE_PATH
    try {
      $env:NODE_OPTIONS = $null; $env:NODE_PATH = $null
      $result = & $node @arguments 2>$null
      if ($LASTEXITCODE -ne 0) { throw $errorCode }
      return ($result | Out-String).Trim()
    } finally { $env:NODE_OPTIONS = $options; $env:NODE_PATH = $nodePath }
  }
  function Check-Node($node) {
    Assert-Local $node
    if (-not (Test-Path -LiteralPath $node -PathType Leaf)) { throw 'NODE_MISSING' }
    $expr = 'const v=process.versions.node.split(''.'').map(Number);process.exit(v[0]===22&&v[1]>=14&&Number(process.versions.napi)>=10&&process.arch===''x64''&&process.platform===''win32''?0:1)'
    Invoke-Node $node @('-e',$expr) 'NODE_UNSUPPORTED' | Out-Null
  }
  function Find-ExternalNode {
    $command = Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $command) { throw 'NODE_MISSING: install compatible x64 Node or use bundled' }
    $node = $command.Source
    for ($depth = 0; $depth -lt 24; $depth++) {
      $at = $node; $found = $false
      while ($at) {
        $item = Get-Item -LiteralPath $at -Force
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
          $target = @($item.Target)[0]
          if (-not $target) { throw 'NODE_LINK_UNSUPPORTED' }
          if ($target.StartsWith('\??\')) { $target = $target.Substring(4) }
          if ($target.StartsWith('\\?\')) { $target = $target.Substring(4) }
          if (-not [IO.Path]::IsPathRooted($target)) { $target = Join-Path ([IO.Path]::GetDirectoryName($at)) $target }
          $node = [IO.Path]::GetFullPath($target + $node.Substring($at.Length))
          $found = $true; break
        }
        $at = [IO.Path]::GetDirectoryName($at)
      }
      if (-not $found) { Check-Node $node; return $node }
    }
    throw 'NODE_LINK_UNSUPPORTED'
  }
  function Download-Archive($target) {
    $url = [Uri]$archiveUrl
    for ($redirect = 0; $redirect -le 5; $redirect++) {
      if ($url.Scheme -ne 'https' -or $url.UserInfo) { throw 'HTTPS_REQUIRED' }
      $request = [Net.HttpWebRequest]::Create($url)
      $request.AllowAutoRedirect = $false; $request.Timeout = 30000; $request.ReadWriteTimeout = 30000
      $request.UserAgent = 'TeamSight-Windows-Installer/1'
      $response = $request.GetResponse()
      try {
        $code = [int]$response.StatusCode
        if ($code -in @(301,302,303,307,308)) { $url = [Uri]::new($url, $response.Headers['Location']); continue }
        if ($code -ne 200 -or ($response.ContentLength -ge 0 -and $response.ContentLength -ne $archiveSize)) { throw 'ARCHIVE_LENGTH_MISMATCH' }
        $stream = $response.GetResponseStream()
        $file = [IO.File]::Open($target, 'CreateNew')
        try {
          $buffer = [byte[]]::new(65536); $total = 0L
          while (($count = $stream.Read($buffer, 0, $buffer.Length)) -gt 0) {
            $total += $count
            if ($total -gt $archiveSize) { throw 'ARCHIVE_LENGTH_MISMATCH' }
            $file.Write($buffer, 0, $count)
          }
          if ($total -ne $archiveSize) { throw 'ARCHIVE_LENGTH_MISMATCH' }
        } finally { $file.Dispose(); $stream.Dispose() }
        if ((File-Hash $target) -ne $archiveSha) { throw 'ARCHIVE_HASH_MISMATCH' }
        return
      } finally { $response.Dispose() }
    }
    throw 'ARCHIVE_REDIRECT_LIMIT'
  }
  function Expand-VerifiedZip($zip, $destination) {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [IO.Compression.ZipFile]::OpenRead($zip)
    $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    $expected = [Collections.Generic.Dictionary[string,string]]::new([StringComparer]::Ordinal)
    $hasher = [Security.Cryptography.SHA256]::Create()
    try {
      $checksumEntry = $archive.GetEntry('@DIRECTORY@/checksums.json')
      if (-not $checksumEntry -or $checksumEntry.Length -gt 2097152) { throw 'PAYLOAD_MANIFEST_MISMATCH' }
      $manifestStream = $checksumEntry.Open()
      $manifestBuffer = [IO.MemoryStream]::new()
      try {
        $manifestStream.CopyTo($manifestBuffer)
        $manifestBytes = $manifestBuffer.ToArray()
        if ([BitConverter]::ToString($hasher.ComputeHash($manifestBytes)).Replace('-','') -ne $manifestSha) { throw 'PAYLOAD_MANIFEST_MISMATCH' }
        $checksums = $utf8.GetString($manifestBytes) | ConvertFrom-Json
        foreach ($property in $checksums.PSObject.Properties) { $expected.Add($property.Name, $property.Value) }
      } finally { $manifestStream.Dispose(); $manifestBuffer.Dispose() }
      foreach ($entry in $archive.Entries) {
        $name = $entry.FullName
        $isDirectory = $name.EndsWith('/')
        $parts = $name.TrimEnd('/').Split('/')
        if ($parts[0] -cne '@DIRECTORY@' -or ($parts.Length -eq 1 -and -not $isDirectory) -or
            (($entry.ExternalAttributes -shr 16) -band 0xF000) -notin @(0,0x4000,0x8000) -or
            ($entry.ExternalAttributes -band [int][IO.FileAttributes]::ReparsePoint)) { throw 'UNSAFE_ZIP_ENTRY' }
        foreach ($part in $parts) {
          if (-not $part -or $part -match '[\x00-\x1f\\:*?"<>|]|[. ]$|^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)') { throw 'UNSAFE_ZIP_ENTRY' }
        }
        $target = [IO.Path]::GetFullPath((Join-Path $destination ($parts -join '\')))
        if (-not $target.StartsWith($destination + '\', [StringComparison]::OrdinalIgnoreCase) -or -not $seen.Add($target)) { throw 'UNSAFE_ZIP_ENTRY' }
        if ($isDirectory) { [IO.Directory]::CreateDirectory((Extended-Path $target)) | Out-Null }
        else {
          [IO.Directory]::CreateDirectory((Extended-Path ([IO.Path]::GetDirectoryName($target)))) | Out-Null
          $inputStream = $entry.Open()
          try {
            $outputStream = [IO.File]::Open((Extended-Path $target), 'CreateNew')
            try { $inputStream.CopyTo($outputStream) } finally { $outputStream.Dispose() }
          } finally { $inputStream.Dispose() }
          $key = $name.Substring($parts[0].Length + 1)
          if ($key -cne 'checksums.json') {
            if (-not $expected.ContainsKey($key)) { throw 'PAYLOAD_FILE_SET_MISMATCH' }
            $stagedFile = [IO.File]::OpenRead((Extended-Path $target))
            try { $sha = [BitConverter]::ToString($hasher.ComputeHash($stagedFile)).Replace('-','') }
            finally { $stagedFile.Dispose() }
            if ($sha -ne $expected[$key]) { throw 'PAYLOAD_HASH_MISMATCH' }
            $expected.Remove($key) | Out-Null
          }
        }
      }
      if ($expected.Count) { throw 'PAYLOAD_FILE_SET_MISMATCH' }
    } finally { $hasher.Dispose(); $archive.Dispose() }
  }
  function Read-Task {
    try { Get-ScheduledTask -TaskPath $taskPath -TaskName $taskName -ErrorAction Stop }
    catch { if ($_.CategoryInfo.Category -ne 'ObjectNotFound') { throw }; return $null }
  }
  function Account-Sid($name) {
    if ($name -like 'S-1-*') { return $name }
    ([Security.Principal.NTAccount]$name).Translate([Security.Principal.SecurityIdentifier]).Value
  }
  function Assert-Task($task, $state) {
    if (-not $task) { throw 'MANAGED_TASK_MISSING' }
    $actions = @($task.Actions); $triggers = @($task.Triggers)
    if ($actions.Count -ne 1 -or $triggers.Count -ne 1 -or (Account-Sid $task.Principal.UserId) -ne $sid -or
        [string]$task.Principal.RunLevel -ne 'Limited' -or [string]$task.Principal.LogonType -ne 'Interactive' -or
        $triggers[0].CimClass.CimClassName -ne 'MSFT_TaskLogonTrigger' -or -not $triggers[0].Enabled -or
        (Account-Sid $triggers[0].UserId) -ne $sid -or $actions[0].Execute -ne $state.taskExecutable -or
        $actions[0].Arguments -cne $state.taskArguments -or $actions[0].WorkingDirectory -ne $root) { throw 'MANAGED_TASK_CHANGED' }
  }
  function Shell-Literal([string]$value) { "'" + $value.Replace("'", "''") + "'" }
  function Encoded-Node($node, [string[]]$arguments, $nodeHash, $file, $fileHash, $logs) {
    $text = '$ErrorActionPreference = ''Stop''; Remove-Item Env:NODE_OPTIONS,Env:NODE_PATH -ErrorAction SilentlyContinue; '
    foreach ($check in @(@($node,$nodeHash),@($file,$fileHash))) {
      if ($check[1]) { $text += 'if ((Get-FileHash -Algorithm SHA256 -LiteralPath ' + (Shell-Literal $check[0]) + ').Hash -ne ' + (Shell-Literal $check[1]) + ') { throw ''MANAGED_FILE_HASH_MISMATCH'' }; ' }
    }
    $text += '& ' + (Shell-Literal $node)
    foreach ($argument in $arguments) { $text += ' ' + (Shell-Literal $argument) }
    if ($logs) { $text += ' 1>> ' + (Shell-Literal (Join-Path $logs 'stdout.log')) + ' 2>> ' + (Shell-Literal (Join-Path $logs 'stderr.log')) }
    $text += '; exit $LASTEXITCODE'
    '-NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand ' + [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($text))
  }
  function Get-Health($state) {
    $health = Invoke-Node $state.node @($agent,'health',$state.packageDir,$data,$state.version,[string]$port) 'SERVICE_HEALTH_FAILED' | ConvertFrom-Json
    $serviceProcess = Get-CimInstance Win32_Process -Filter ('ProcessId=' + [int]$health.pid)
    $cli = Join-Path $state.packageDir 'dist\cli.js'
    if (-not $serviceProcess -or $serviceProcess.ExecutablePath -ne $state.node -or -not $serviceProcess.CommandLine -or
        $serviceProcess.CommandLine.IndexOf($cli, [StringComparison]::OrdinalIgnoreCase) -lt 0 -or
        $serviceProcess.CommandLine.IndexOf($data, [StringComparison]::OrdinalIgnoreCase) -lt 0) { throw 'INSTANCE_PROCESS_MISMATCH' }
    $owner = Invoke-CimMethod -InputObject $serviceProcess -MethodName GetOwnerSid
    if ($owner.ReturnValue -ne 0 -or $owner.Sid -ne $sid) { throw 'INSTANCE_PROCESS_MISMATCH' }
    return $health
  }
  function Verify-Service($state, [bool]$wait) {
    $until = [DateTime]::UtcNow.AddSeconds(30)
    do {
      try { $active = Get-Health $state; break }
      catch { if (-not $wait -or [DateTime]::UtcNow -gt $until) { throw }; Start-Sleep -Milliseconds 350 }
    } while ($true)
    Protect-Path (Join-Path $data 'access-token') $false
    $mcp = Invoke-Node $state.node @($agent,'mcp',$state.packageDir,$data,$state.version,[string]$port) 'MCP_VERIFICATION_FAILED' | ConvertFrom-Json
    if ($mcp.instanceId -ne $active.instanceId) { throw 'INSTANCE_IDENTITY_MISMATCH' }
    return $mcp
  }
  function Stop-Owned($state) {
    Assert-Task (Read-Task) $state
    if (Test-Path -LiteralPath $instanceLock) { Get-Health $state | Out-Null }
    Disable-ScheduledTask -TaskPath $taskPath -TaskName $taskName | Out-Null
    $until = [DateTime]::UtcNow.AddSeconds(30); $requested = $false
    do {
      $task = Read-Task; Assert-Task $task $state
      if (Test-Path -LiteralPath $instanceLock) {
        if (-not $requested) {
          $active = Get-Health $state
          Invoke-Node $state.node @($agent,'stop',$state.packageDir,$data,$state.version,[string]$port,$active.instanceId) 'SERVICE_STOP_FAILED' | Out-Null
          $requested = $true
        }
      } elseif ([string]$task.State -ne 'Running') { return }
      Start-Sleep -Milliseconds 350
    } while ([DateTime]::UtcNow -lt $until)
    throw 'SERVICE_STOP_TIMEOUT'
  }
  function Assert-FreePort {
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $port)
    try { $listener.ExclusiveAddressUse = $true; $listener.Start() }
    catch { throw 'PORT_IN_USE' }
    finally { $listener.Stop() }
  }
  function Backup-Directory($from, $to) {
    New-ProtectedDirectory $to
    foreach ($item in Get-ChildItem -LiteralPath $from -Force) {
      if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'DATA_BACKUP_LINK_REFUSED' }
      $target = Join-Path $to $item.Name
      if ($item.PSIsContainer) { Backup-Directory $item.FullName $target }
      else {
        [IO.File]::Copy($item.FullName, $target)
        if ((File-Hash $item.FullName) -ne (File-Hash $target)) { throw 'DATA_BACKUP_HASH_MISMATCH' }
      }
    }
  }
  function Receipt($state, $active, $action) {
    [ordered]@{ ok=$true; schema=1; action=$action; service='verified'; version=$active.version; variant=$state.variant;
      instanceId=$active.instanceId; tools=$active.tools; name='teamsight'; transport='streamable-http'; auth='bearer';
      url="http://127.0.0.1:$port/mcp"; credentialFile=(Join-Path $data 'access-token'); codexHelper=$state.codexHelper } | ConvertTo-Json -Compress
  }

  foreach ($path in @($root,$statePath,$data,$instanceLock,(Join-Path $root 'versions'),(Join-Path $root 'management'),
      (Join-Path $root 'logs'),(Join-Path $root 'backups'),(Join-Path $data 'access-token'))) { Assert-Local $path }
  if (-not (Test-Path -LiteralPath $root)) { New-ProtectedDirectory $root }
  $lock = Join-Path $root '.installer-lock'
  Assert-Local $lock
  try { New-Item -ItemType Directory -Path $lock -ErrorAction Stop | Out-Null } catch { throw 'INSTALLER_LOCKED' }
  $stage = Join-Path $root ('.stage-' + [guid]::NewGuid())
  try {
    $old = $null; $oldTask = Read-Task; $oldBytes = $null; $oldHealth = $null; $order = -1
    if (Test-Path -LiteralPath $statePath) {
      $oldBytes = [IO.File]::ReadAllBytes($statePath)
      $old = Read-Json $statePath
      if ($old.schema -notin @(1,2) -or $old.sid -ne $sid -or $old.base -ne $root -or $old.taskName -ne $taskName -or
          $old.port -notmatch '^\d{4,5}$' -or $old.port -lt 1024 -or $old.port -gt 65535 -or ($fixture -and $old.port -ne $port)) { throw 'INSTALLER_STATE_INVALID' }
      $port = [int]$old.port
      if ($old.schema -eq 1) {
        if ($old.packageDir -notin @((Join-Path $root 'versions\0.3.3-bundled'),(Join-Path $root 'versions\0.3.4-bundled'))) { throw 'INSTALLER_STATE_INVALID' }
        $manager = Join-Path $root 'install-windows.ps1'; $legacyHelper = Join-Path $root 'windows-config.cjs'
        Assert-Local $manager; Assert-Local $legacyHelper
        if ((File-Hash $manager) -ne $old.managerHash -or (File-Hash $legacyHelper) -ne $old.helperHash -or
            $old.taskArguments -cne ('-NoProfile -NonInteractive -WindowStyle Hidden -File "' + $manager + '" -Action Run -InstallRoot "' + $root + '"')) { throw 'MANAGED_FILES_CHANGED' }
        $legacyShell = @($oldTask.Actions)[0].Execute
        Assert-Local $legacyShell
        if ((Split-Path -Leaf $legacyShell) -ne 'pwsh.exe') { throw 'MANAGED_TASK_CHANGED' }
        $old | Add-Member -NotePropertyMembers @{ version=((Split-Path -Leaf $old.packageDir) -replace '-bundled$',''); variant='bundled';
          node=(Join-Path $old.packageDir 'runtime\node.exe'); taskExecutable=$legacyShell }
      }
      if ($old.version -cnotmatch '^(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})$' -or $old.variant -notin @('bundled','external') -or
          $old.packageDir -ne (Join-Path $root ('versions\' + $old.version + '-' + $old.variant)) -or $old.manifestSha256 -notmatch '^[a-f0-9]{64}$') { throw 'INSTALLER_STATE_INVALID' }
      Assert-Task $oldTask $old
      Assert-Local $old.packageDir
      $oldChecksums = Join-Path $old.packageDir 'checksums.json'; Assert-Local $oldChecksums
      if ((File-Hash $oldChecksums) -ne $old.manifestSha256) { throw 'PAYLOAD_MANIFEST_MISMATCH' }
      if ($old.variant -eq 'bundled') {
        Assert-Local $old.node
        if ($old.node -ne (Join-Path $old.packageDir 'runtime\node.exe') -or (File-Hash $old.node) -ne (Read-Json $oldChecksums).'runtime/node.exe') { throw 'BUNDLED_NODE_HASH_MISMATCH' }
      }
      Check-Node $old.node
      if ($old.schema -eq 2) {
        $oldManagement = Join-Path $root ('management\' + $old.version + '-' + $old.variant)
        if ($old.taskExecutable -ne $systemShell -or $old.agent -ne (Join-Path $oldManagement 'windows-agent.cjs') -or $old.codexHelper -ne (Join-Path $oldManagement 'configure-codex.cmd')) { throw 'INSTALLER_STATE_INVALID' }
        Assert-Local $old.agent; Assert-Local $old.codexHelper
        if ((File-Hash $old.agent) -ne $old.agentSha -or (File-Hash $old.codexHelper) -ne $old.helperSha) { throw 'MANAGED_FILES_CHANGED' }
      }
      $order = ([version]$old.version).CompareTo([version]$version)
    } elseif ($oldTask -or (Test-Path -LiteralPath $instanceLock)) { throw 'UNMANAGED_SERVICE' }

    New-ProtectedDirectory $root
    New-ProtectedDirectory $stage
    $agent = Join-Path $stage 'windows-agent.cjs'
    [IO.File]::WriteAllBytes($agent, [Convert]::FromBase64String('@AGENT@'))
    if ((File-Hash $agent) -ne $agentSha) { throw 'AGENT_HASH_MISMATCH' }
    if ($old) {
      Invoke-Node $old.node @($agent,'verify',$old.packageDir,$old.version,$old.variant,$old.manifestSha256) 'INSTALLED_PAYLOAD_INVALID' | Out-Null
      if (Test-Path -LiteralPath $instanceLock) {
        if ([string]$oldTask.State -ne 'Running') { throw 'UNMANAGED_SERVICE' }
        $oldHealth = Get-Health $old
      } elseif ([string]$oldTask.State -eq 'Running') {
        $oldHealth = Verify-Service $old $true
      }
      if ($order -gt 0 -or ($order -eq 0 -and $old.variant -eq $variant)) {
        if ($old.schema -ne 2) { throw 'INSTALLER_STATE_INVALID' }
        if ($order -eq 0 -and $old.manifestSha256 -ne $manifestSha) { throw 'EXISTING_PACKAGE_MISMATCH' }
        try {
          if (-not $oldHealth) {
            Assert-FreePort
            Enable-ScheduledTask -TaskPath $taskPath -TaskName $taskName | Out-Null
            Start-ScheduledTask -TaskPath $taskPath -TaskName $taskName
          }
          $active = Verify-Service $old (-not $oldHealth)
        } catch {
          if (-not $oldHealth -and -not $oldTask.Settings.Enabled) { Disable-ScheduledTask -TaskPath $taskPath -TaskName $taskName | Out-Null }
          throw
        }
        Receipt $old $active $(if ($order -gt 0) { 'newer-local' } else { 'already-current' })
        return
      }
    }
    if (-not $oldHealth) { Assert-FreePort }

    $node = if ($variant -eq 'external') { Find-ExternalNode } else { $null }
    $zip = Join-Path $stage 'payload.zip'; Download-Archive $zip; Expand-VerifiedZip $zip $stage
    $payload = Join-Path $stage '@DIRECTORY@'
    if ($variant -eq 'bundled') {
      $node = Join-Path $payload 'runtime\node.exe'
      if ((File-Hash $node) -ne $runtimeSha) { throw 'BUNDLED_NODE_HASH_MISMATCH' }
      Check-Node $node
    }
    Invoke-Node $node @($agent,'verify',$payload,$version,$variant,$manifestSha) 'PAYLOAD_VERIFICATION_FAILED' | Out-Null
    if (Test-Path -LiteralPath $data) { Invoke-Node $node @($agent,'inspect',$payload,$data) 'DATA_UNSUPPORTED_OR_BUSY' | Out-Null }
    $doctor = Invoke-Node $node @((Join-Path $payload 'dist\cli.js'),'doctor') 'NATIVE_DIAGNOSTIC_FAILED' | ConvertFrom-Json
    if (-not $doctor.ok -or -not $doctor.keyringMatches -or -not $doctor.pngBytes) { throw 'NATIVE_DIAGNOSTIC_FAILED' }
    foreach ($folder in @('versions','management','data-mcp','logs','backups')) { New-ProtectedDirectory (Join-Path $root $folder) }

    $releaseKey = $version + '-' + $variant
    $target = Join-Path $root ('versions\' + $releaseKey)
    $management = Join-Path $root ('management\' + $releaseKey)
    $installedNode = if ($variant -eq 'bundled') { Join-Path $target 'runtime\node.exe' } else { $node }
    $installedAgent = Join-Path $management 'windows-agent.cjs'
    $installedHelper = Join-Path $management 'configure-codex.cmd'
    $taskArguments = Encoded-Node $installedNode @((Join-Path $target 'dist\cli.js'),'serve','--data-dir',$data,'--port',[string]$port) $runtimeSha $null $null (Join-Path $root 'logs')
    $helperArguments = Encoded-Node $installedNode @($installedAgent,'configure',$root) $runtimeSha $installedAgent $agentSha $null
    $helperText = '@echo off' + "`r`n" + '"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" ' + $helperArguments + "`r`nexit /b %errorlevel%`r`n"
    if ($helperText.Length -gt 7500 -or $taskArguments.Length -gt 7500) { throw 'MANAGED_PATH_TOO_LONG' }
    $stagedManager = Join-Path $stage 'manager'; New-ProtectedDirectory $stagedManager
    [IO.File]::Copy($agent, (Join-Path $stagedManager 'windows-agent.cjs'))
    Write-Utf8 (Join-Path $stagedManager 'configure-codex.cmd') $helperText
    $helperSha = File-Hash (Join-Path $stagedManager 'configure-codex.cmd')
    $next = [pscustomobject]@{ schema=2; sid=$sid; base=$root; version=$version; variant=$variant; port=$port; packageDir=$target; node=$installedNode;
      taskName=$taskName; taskExecutable=$systemShell; taskArguments=$taskArguments; manifestSha256=$manifestSha; agent=$installedAgent; agentSha=$agentSha;
      codexHelper=$installedHelper; helperSha=$helperSha }

    Assert-Local $target; Assert-Local $installedAgent; Assert-Local $installedHelper
    $oldDisabled = $false; $newTaskRegistered = $false; $published = $false; $newPayload = $false; $newManagement = $false; $taskXml = $null
    try {
      if (Test-Path -LiteralPath $target) { Invoke-Node $node @($agent,'verify',$target,$version,$variant,$manifestSha) 'EXISTING_PACKAGE_MISMATCH' | Out-Null }
      if (Test-Path -LiteralPath $management) {
        if ((File-Hash $installedAgent) -ne $agentSha -or (File-Hash $installedHelper) -ne $helperSha) { throw 'MANAGED_FILES_CHANGED' }
      }
      if ($old) {
        Assert-Task (Read-Task) $old
        $taskXml = Export-ScheduledTask -TaskPath $taskPath -TaskName $taskName
        $oldDisabled = $true
        Stop-Owned $old
      } elseif ((Read-Task) -or (Test-Path -LiteralPath $instanceLock)) { throw 'UNMANAGED_SERVICE' }
      Assert-FreePort
      Invoke-Node $node @($agent,'inspect',$payload,$data) 'DATA_UNSUPPORTED_OR_BUSY' | Out-Null
      $backup = Join-Path $root ('backups\install-' + [guid]::NewGuid())
      New-ProtectedDirectory $backup
      if ($old) {
        [IO.File]::WriteAllBytes((Join-Path $backup 'installer-state.json'), $oldBytes)
        Write-Utf8 (Join-Path $backup 'task.xml') ($taskXml -replace 'encoding="UTF-16"','encoding="UTF-8"')
      }
      Backup-Directory $data (Join-Path $backup 'data-mcp')
      if (-not (Test-Path -LiteralPath $target)) { Move-Stage $payload $target; $newPayload = $true }
      if (-not (Test-Path -LiteralPath $management)) { Move-Stage $stagedManager $management; $newManagement = $true }
      if ($old) { Assert-Task (Read-Task) $old } elseif (Read-Task) { throw 'UNMANAGED_SERVICE' }
      $action = New-ScheduledTaskAction -Execute $systemShell -Argument $taskArguments -WorkingDirectory $root
      $trigger = New-ScheduledTaskTrigger -AtLogOn -User $sid
      $principal = New-ScheduledTaskPrincipal -UserId $sid -LogonType Interactive -RunLevel Limited
      $settings = New-ScheduledTaskSettingsSet -Hidden -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
      Register-ScheduledTask -TaskPath $taskPath -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force:([bool]$old) | Out-Null
      $newTaskRegistered = $true
      Assert-Task (Read-Task) $next
      Start-ScheduledTask -TaskPath $taskPath -TaskName $taskName
      $active = Verify-Service $next $true
      if ($fixture -and $env:TEAMSIGHT_TEST_FAIL -eq 'after-start') { throw 'TEST_START_FAILURE' }
      $pending = Join-Path $stage 'next.json'
      Write-Utf8 $pending ($next | ConvertTo-Json)
      if ($old) { [IO.File]::Replace($pending, $statePath, [NullString]::Value) } else { [IO.File]::Move($pending, $statePath) }
      $published = $true
      Receipt $next $active $(if (-not $old) { 'installed' } elseif ($order -lt 0) { 'upgraded' } else { 'variant-switched' })
    } catch {
      $failure = $_
      try {
        if ($newTaskRegistered) {
          Stop-Owned $next
          Assert-Task (Read-Task) $next
          if (-not $old) { Unregister-ScheduledTask -TaskPath $taskPath -TaskName $taskName -Confirm:$false }
        }
        if ($published) {
          if ($old) { [IO.File]::WriteAllBytes($statePath, $oldBytes) } else { [IO.File]::Delete($statePath) }
        }
        if ($oldDisabled) {
          if ($newTaskRegistered) { Register-ScheduledTask -TaskPath $taskPath -TaskName $taskName -Xml $taskXml -Force | Out-Null }
          Assert-Task (Read-Task) $old
          if ($oldTask.Settings.Enabled -or $oldHealth) { Enable-ScheduledTask -TaskPath $taskPath -TaskName $taskName | Out-Null }
          if ($oldHealth) {
            if (-not (Test-Path -LiteralPath $instanceLock)) { Start-ScheduledTask -TaskPath $taskPath -TaskName $taskName }
            Verify-Service $old $true | Out-Null
          }
          if (-not $oldTask.Settings.Enabled) { Disable-ScheduledTask -TaskPath $taskPath -TaskName $taskName | Out-Null }
        }
        if ($newManagement) { Remove-OwnedTree $management }
        if ($newPayload) { Remove-OwnedTree $target }
      } catch { throw 'ROLLBACK_REQUIRED: preserve backups and inspect the managed service' }
      throw $failure
    }
  } finally {
    try { Remove-OwnedTree $stage }
    finally { [IO.Directory]::Delete($lock) }
  }
}
