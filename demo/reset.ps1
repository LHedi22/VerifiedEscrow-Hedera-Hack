Set-Location (Join-Path $PSScriptRoot "..")
docker compose exec -T db psql -v ON_ERROR_STOP=1 -U vte -d vte -f /demo/reset.sql
if ($LASTEXITCODE -ne 0) { throw "truncate failed" }
docker compose exec -T db pg_restore --data-only --disable-triggers -U vte -d vte /demo/snapshot.dump
if ($LASTEXITCODE -ne 0) { throw "restore failed" }
Write-Host "Demo DB restored. Refresh every browser window."
