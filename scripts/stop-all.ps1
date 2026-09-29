# Stop the services scripts\start-all.ps1 started - only its own windows, found by their "vte <service>" title.
# Postgres (Docker) and Ollama keep running. Windows PowerShell 5.1, ASCII only.
#
#   scripts\stop-all.ps1              hedera-svc, api and web
#   scripts\stop-all.ps1 -Only web    one service
param([ValidateSet("", "hedera-svc", "api", "web")][string]$Only = "")

$pattern = "WindowTitle = 'vte "
if ($Only) { $pattern = "WindowTitle = 'vte $Only" }
$mine = Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($pattern) }
if (-not $mine) { Write-Host "nothing to stop"; exit 0 }
foreach ($p in $mine) {
    $title = ([regex]::Match($p.CommandLine, "vte [^']+")).Value
    taskkill /T /F /PID $p.ProcessId | Out-Null
    Write-Host "stopped $title (pid $($p.ProcessId))"
}
