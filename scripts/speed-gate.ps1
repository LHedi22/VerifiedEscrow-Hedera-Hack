<#
.SYNOPSIS
  T0.2 speed gate (TRD 8.1): one full evaluation of S1 (criteria extraction, then
  evaluation) must finish in <= 40 s on the demo laptop, measured on a warm model.

.DESCRIPTION
  Reads the S1 SOW and deliverable from docs/06-DEMO-CONTENT.md, then runs both
  steps twice against Ollama. Run 1 includes the model load and is informational.
  Run 2 (warm) is the gate: PASS only if its two steps total <= LimitSeconds and
  the output is well-formed (>= 3 criteria, one result per criterion, confidence
  in 0-1). It checks speed only; verdict quality is T1.8/T1.9.

  Both system prompts are read from api/app/prompts/, so the gate measures
  exactly what the evaluator sends.

  Exit codes: 0 = PASS, 1 = FAIL (too slow or invalid output), 2 = setup error.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\speed-gate.ps1
  powershell -ExecutionPolicy Bypass -File scripts\speed-gate.ps1 -Model qwen2.5:3b-instruct
#>
param(
  [string]$OllamaUrl = "http://localhost:11434",
  [string]$Model = "qwen2.5:7b-instruct",
  [double]$LimitSeconds = 40,
  # num_predict caps per TRD 8.1
  [int]$CriteriaMaxTokens = 512,
  [int]$EvalMaxTokens = 1200,
  [int]$NumCtx = 8192,
  [switch]$CriteriaAtFunding,  # TRD 8.1 fallback 1: gate the evaluation step only
  [switch]$ShowOutput
)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot

# Keep the laptop awake while this process runs (a sleep mid-run once reported 6,963 s).
# Process-scoped: no power setting is changed, and it ends when the script exits.
Add-Type -Namespace Win32 -Name Power -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint esFlags);'
[void][Win32.Power]::SetThreadExecutionState([uint32]"0x80000001")  # ES_CONTINUOUS | ES_SYSTEM_REQUIRED

# --- S1 from docs/06 (first two fenced blocks under "### S1") -----------------
$demo = [IO.File]::ReadAllText((Join-Path $repo "docs\06-DEMO-CONTENT.md"), [Text.Encoding]::UTF8)
$s1 = [regex]::Match($demo, '(?s)### S1\b(.*?)(?=\r?\n### )')
if (-not $s1.Success) { Write-Host "Could not find S1 in docs/06-DEMO-CONTENT.md"; exit 2 }
$blocks = [regex]::Matches($s1.Groups[1].Value, '(?s)```[a-z]*\r?\n(.*?)\r?\n```')
if ($blocks.Count -lt 2) { Write-Host "S1 must contain a SOW block and a deliverable block"; exit 2 }
$sow = $blocks[0].Groups[1].Value
$deliverable = $blocks[1].Groups[1].Value

# --- Ollama call --------------------------------------------------------------
function Invoke-Ollama([string]$system, [string]$user, $schema, [int]$maxTokens) {
  $body = @{
    model      = $Model
    stream     = $false
    keep_alive = -1
    format     = $schema
    # num_predict (TRD 8.1): a looping model hits the cap instead of hanging.
    options    = @{ temperature = 0; seed = 42; num_ctx = $NumCtx; num_predict = $maxTokens }
    messages   = @(
      @{ role = "system"; content = $system },
      @{ role = "user"; content = $user }
    )
  } | ConvertTo-Json -Depth 20
  # PowerShell 5.1 sends string bodies as Latin-1; send UTF-8 bytes explicitly.
  $bytes = [Text.Encoding]::UTF8.GetBytes($body)
  $resp = Invoke-WebRequest -Uri "$OllamaUrl/api/chat" -Method Post -Body $bytes `
    -ContentType "application/json; charset=utf-8" -UseBasicParsing -TimeoutSec 300
  $text = [Text.Encoding]::UTF8.GetString($resp.RawContentStream.ToArray())
  $json = $text | ConvertFrom-Json
  return @{ Content = $json.message.content; Truncated = ($json.done_reason -eq "length"); Cap = $maxTokens }
}

function ConvertFrom-Answer($answer, [string]$step) {
  if ($answer.Truncated) { throw "$step output hit the $($answer.Cap)-token cap (done_reason=length; a failed attempt under TRD 8.4)" }
  try { return $answer.Content | ConvertFrom-Json } catch { throw "$step output is not valid JSON" }
}

# --- Prompts and schemas (TRD 8.2) ----------------------------------------------
# [ordered]: Ollama generates fields in schema order, and id must come before description.
$criteriaSchema = [ordered]@{
  type       = "object"
  properties = [ordered]@{
    criteria = [ordered]@{
      type     = "array"
      minItems = 3
      maxItems = 7
      items    = [ordered]@{
        type       = "object"
        properties = [ordered]@{
          id          = [ordered]@{ type = "string" }
          description = [ordered]@{ type = "string" }
          required    = [ordered]@{ type = "boolean" }
        }
        required   = @("id", "description", "required")
      }
    }
  }
  required   = @("criteria")
}

$criteriaSystem = [IO.File]::ReadAllText((Join-Path $repo "api\app\prompts\criteria_system.txt"), [Text.Encoding]::UTF8)

$evalSchema = [ordered]@{
  type       = "object"
  properties = [ordered]@{
    results             = [ordered]@{
      type  = "array"
      items = [ordered]@{
        type       = "object"
        properties = [ordered]@{
          id       = [ordered]@{ type = "string" }
          met      = [ordered]@{ type = "boolean" }
          evidence = [ordered]@{ type = "string" }
        }
        required   = @("id", "met", "evidence")
      }
    }
    reasoning           = [ordered]@{ type = "string" }
    confidence          = [ordered]@{ type = "number"; minimum = 0; maximum = 1 }
    injection_suspected = [ordered]@{ type = "boolean" }
  }
  required   = @("results", "reasoning", "confidence", "injection_suspected")
}

$evalSystem = [IO.File]::ReadAllText((Join-Path $repo "api\app\prompts\evaluation_system.txt"), [Text.Encoding]::UTF8)

$escaped = $deliverable -replace '<deliverable', '&lt;deliverable' -replace '</deliverable', '&lt;/deliverable'

$script:cachedCriteria = $null  # set when -CriteriaAtFunding: extracted once, like at funding time

function Invoke-Evaluation([int]$run) {
  $sw = [Diagnostics.Stopwatch]::StartNew()
  if ($script:cachedCriteria) {
    $criteria = $script:cachedCriteria
    $t1 = 0.0
  } else {
    $c = Invoke-Ollama $criteriaSystem "<sow>`n$sow`n</sow>" $criteriaSchema $CriteriaMaxTokens
    $t1 = $sw.Elapsed.TotalSeconds
    if ($ShowOutput) { Write-Host "--- criteria:`n$($c.Content)" }
    try { $criteria = ConvertFrom-Answer $c "criteria" } catch {
      Write-Host ("Run {0}: criteria {1,6:N1} s | {2}" -f $run, $t1, $_.Exception.Message)
      return @{ Total = $t1; Valid = $false; Why = $_.Exception.Message }
    }
  }
  $criteriaJson = $criteria | ConvertTo-Json -Depth 10 -Compress
  $e = Invoke-Ollama $evalSystem "<criteria>$criteriaJson</criteria>`n<deliverable>`n$escaped`n</deliverable>" $evalSchema $EvalMaxTokens
  $total = $sw.Elapsed.TotalSeconds
  if ($ShowOutput) { Write-Host "--- evaluation:`n$($e.Content)`n---" }
  try { $eval = ConvertFrom-Answer $e "evaluation" } catch {
    Write-Host ("Run {0}: criteria {1,6:N1} s | evaluation {2,6:N1} s | {3}" -f $run, $t1, ($total - $t1), $_.Exception.Message)
    return @{ Total = $total; Valid = $false; Why = $_.Exception.Message }
  }

  # A truncated or malformed answer is also a fast one, so it can't count as a timing.
  $valid = ($criteria.criteria.Count -ge 3) -and ($eval.results.Count -eq $criteria.criteria.Count) -and
    ($eval.confidence -ge 0) -and ($eval.confidence -le 1)
  $met = @($eval.results | Where-Object { $_.met }).Count
  "Run {0}: criteria {1,6:N1} s | evaluation {2,6:N1} s | total {3,6:N1} s | {4} criteria, {5}/{6} met, confidence {7}, injection {8}" -f `
    $run, $t1, ($total - $t1), $total, $criteria.criteria.Count, $met, $eval.results.Count, $eval.confidence, $eval.injection_suspected | Write-Host
  return @{ Total = $total; Valid = $valid; Why = "needs >= 3 criteria, one result per criterion, confidence 0-1" }
}

# --- Preflight ------------------------------------------------------------------
try {
  $tags = Invoke-RestMethod -Uri "$OllamaUrl/api/tags" -TimeoutSec 5
} catch {
  Write-Host "Ollama not reachable at $OllamaUrl. Start Ollama and retry."; exit 2
}
if (-not ($tags.models | Where-Object { $_.name -eq $Model })) {
  Write-Host "Model '$Model' not pulled. Run: ollama pull $Model"; exit 2
}

Write-Host "Speed gate: $Model, num_ctx $NumCtx, S1 (SOW $($sow.Length) chars, deliverable $($deliverable.Length) chars), limit $LimitSeconds s on the warm run"
if ($CriteriaAtFunding) {
  # TRD 8.1 fallback 1: criteria are extracted when the contract is funded, so the live wait is evaluation only.
  $sw0 = [Diagnostics.Stopwatch]::StartNew()
  $script:cachedCriteria = ConvertFrom-Answer (Invoke-Ollama $criteriaSystem "<sow>`n$sow`n</sow>" $criteriaSchema $CriteriaMaxTokens) "criteria"
  Write-Host ("Criteria extracted at 'funding' in {0:N1} s (not gated): {1} criteria" -f $sw0.Elapsed.TotalSeconds, $script:cachedCriteria.criteria.Count)
}
$cold = Invoke-Evaluation 1
Write-Host "        (run 1 includes model load; not gated)"
$warm = Invoke-Evaluation 2

if (-not $warm.Valid) {
  Write-Host "FAIL: warm run output is unusable ($($warm.Why)), so its time does not count."; exit 1
}
if ($warm.Total -le $LimitSeconds) {
  Write-Host ("PASS: warm run {0:N1} s <= {1} s" -f $warm.Total, $LimitSeconds); exit 0
}
Write-Host ("FAIL: warm run {0:N1} s > {1} s. TRD 8.1 fallbacks: extract criteria at funding time, or -Model qwen2.5:3b-instruct" -f $warm.Total, $LimitSeconds)
exit 1
