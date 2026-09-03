# The wrapper Task Scheduler runs.
#
# WHY A WRAPPER. A task that never fires and a task that fired and died look identical if the
# only evidence is the database, so the dated log file is created BEFORE anything that can fail:
# an absent file means the scheduler never started us, a file with only the banner means we died
# immediately, and a file with a tail means the run failed and the tail says how.
#
# WHY cmd REDIRECTION AND NOT A POWERSHELL PIPELINE.
#
# The first version piped npm through `| Out-File -Append`, and under Task Scheduler the chain
# died about sixty seconds into the first scraper with exit 0xC000013A (STATUS_CONTROL_C_EXIT) —
# three times, including once with nothing else running on the machine. The same scraper run
# directly from a shell finished cleanly and wrote 5,818 offers, so the scraper was never the
# problem: piping a native command that spawns dozens of child processes through a PowerShell
# pipeline, inside a task's non-interactive console, is.
#
# `cmd /c "... >> file 2>&1"` has none of that machinery. The child writes straight to a file
# handle, there is no pipeline to break, and stdout and stderr interleave in the order they
# happened rather than in the order PowerShell chose to flush them.

$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$stamp = Get-Date -Format "yyyy-MM-dd"
$logDir = Join-Path $root "logs\nightly"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
$log = Join-Path $logDir "$stamp.log"

# Written first, so the file's existence proves the task fired.
Add-Content -Path $log -Value "=== nightly started $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz') ==="
Add-Content -Path $log -Value "    cwd  : $root"
Add-Content -Path $log -Value "    user : $env:USERNAME"

# Task Scheduler starts with a minimal PATH and `npm` is NOT on it. The failure then looks like
# a missing command rather than a missing environment, so resolve node explicitly.
$nodeDir = "C:\Program Files\nodejs"
if (Test-Path $nodeDir) { $env:PATH = "$nodeDir;$env:PATH" }
if (-not (Test-Path (Join-Path $nodeDir "npm.cmd"))) {
  Add-Content -Path $log -Value "    FATAL: npm.cmd not found under $nodeDir"
  exit 127
}

# Quoting: the whole command is one argument to cmd /c, and the log path may contain spaces.
$cmdLine = '"' + (Join-Path $nodeDir "npm.cmd") + '" run nightly >> "' + $log + '" 2>&1'
& cmd.exe /c $cmdLine
$code = $LASTEXITCODE

Add-Content -Path $log -Value ""
Add-Content -Path $log -Value "=== nightly finished $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') exit=$code ==="
exit $code
