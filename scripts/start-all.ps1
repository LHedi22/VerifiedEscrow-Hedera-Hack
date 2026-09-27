# Start the demo stack: Postgres (Docker), hedera-svc, api and web, each in its own PowerShell window.
# Windows PowerShell 5.1, ASCII only (TRD 18). Ollama runs natively and is not started here.
#
#   scripts\start-all.ps1          production web build (next build && next start) - rehearsals, T3.8, stage
#   scripts\start-all.ps1 -Dev     next dev + uvicorn --reload - while building the UI
#
# Close a service by closing its window. Re-running the script opens new windows; close the old ones first.
param([switch]$Dev)

$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $root

function Fail($msg) { Write-Host $msg -ForegroundColor Red; exit 1 }

# 1. Docker Desktop must be up (it does not survive sleep; compose then hangs instead of failing).
$null = docker version --format "{{.Server.Version}}" 2>$null
if ($LASTEXITCODE -ne 0) { Fail "Docker Desktop is not running. Start it, wait for 'Engine running', then re-run." }
docker compose up -d db
if ($LASTEXITCODE -ne 0) { Fail "docker compose up -d db failed" }
Write-Host "db: up" -ForegroundColor Green

# 2. Stage guard: the Day 2 forced evaluation-error mode must be off.
$forced = $env:OLLAMA_EVAL_NUM_PREDICT
if (-not $forced -and (Select-String -Path (Join-Path $root "api\.env") -Pattern "^\s*OLLAMA_EVAL_NUM_PREDICT\s*=" -Quiet)) { $forced = "(set in api\.env)" }
if ($forced) { Write-Host "WARNING: OLLAMA_EVAL_NUM_PREDICT is set $forced - every evaluation will end as EVALUATION_ERROR." -ForegroundColor Yellow }

# 3. Ollama is native; warn if it is not answering.
try { $null = Invoke-RestMethod -Uri "http://localhost:11434/api/tags" -TimeoutSec 3 }
catch { Write-Host "WARNING: Ollama is not answering on :11434 - start it before submitting a deliverable." -ForegroundColor Yellow }

function Start-Window($title, $dir, $command) {
    $cmd = "`$host.UI.RawUI.WindowTitle = 'vte $title'; Set-Location '$dir'; $command"
    Start-Process powershell.exe -ArgumentList @("-NoExit", "-NoProfile", "-Command", $cmd) -WorkingDirectory $dir | Out-Null
    Write-Host "$title`: started in its own window" -ForegroundColor Green
}

Start-Window "hedera-svc" $root "pnpm --filter hedera-svc dev"

$apiDir = Join-Path $root "api"
$reload = ""
if ($Dev) { $reload = " --reload" }
# -Dev: no warm-up prompt, so the 7B model stays unloaded while building UI (15 GB RAM laptop).
$warm = ""
if ($Dev) { $warm = "`$env:OLLAMA_WARM_UP = '0'; " }
Start-Window "api" $apiDir "$warm.\.venv\Scripts\python.exe -m uvicorn app.main:app --port 8000$reload"

if ($Dev) { Start-Window "web (dev)" $root "pnpm --filter web dev" }
else { Start-Window "web (stage build)" $root "pnpm --filter web stage" }

Write-Host ""
Write-Host "Wait for 'Uvicorn running', 'hedera-svc listening' and 'Ready', then open http://localhost:3000" -ForegroundColor Cyan
Write-Host "Health: http://localhost:8000/health (all ok, forced_eval_error false)" -ForegroundColor Cyan
