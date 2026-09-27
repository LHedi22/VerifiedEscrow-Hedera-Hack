#!/usr/bin/env bash
# Day 2 gate: the whole business flow over api's HTTP interface only (plus read-only mirror lookups
# to turn EVM tx hashes into HashScan links, TRD §11).
#
#   scripts/day2_gate.sh pass    S1: create -> fund -> deliverable -> RELEASED
#   scripts/day2_gate.sh fail    S2: ... -> HELD/FAILED_VERDICT -> arbitrator release -> RELEASED
#   scripts/day2_gate.sh error   S2 text with api started with OLLAMA_EVAL_NUM_PREDICT=8:
#                                ... -> EVALUATION_ERROR record anchored -> HELD on-chain -> refund
# Needs: api on :8000, hedera-svc, Ollama, Postgres. Run from the repo root.
set -euo pipefail
cd "$(dirname "$0")/.."
API=http://localhost:8000
MIRROR=https://testnet.mirrornode.hedera.com/api/v1
HS=https://hashscan.io/testnet
PY=api/.venv/Scripts/python
export PYTHONUTF8=1
SCENARIO=${1:?usage: day2_gate.sh pass|fail|error}

j() { "$PY" -c "import json,sys; d=json.load(sys.stdin); print($1)"; }
call() { # method path persona [json]
  local out code
  if [ $# -ge 4 ]; then out=$(curl -s -m 150 -w '\n%{http_code}' -X "$1" "$API$2" -H "X-Persona: $3" -H "Content-Type: application/json" -d "$4")
  else out=$(curl -s -m 150 -w '\n%{http_code}' -X "$1" "$API$2" -H "X-Persona: $3"); fi
  code=${out##*$'\n'}; body=${out%$'\n'*}
  if [ "${code:0:1}" != 2 ]; then echo "HTTP $code on $1 $2: $body" >&2; exit 1; fi
  echo "$body"
}
evm_link() { # EVM tx hash -> HashScan link by consensus timestamp
  local ts; ts=$(curl -s "$MIRROR/contracts/results/$1" | j "d.get('timestamp','')")
  echo "$HS/transaction/$ts"
}
case_text() { "$PY" -c "import sys,json; sys.path.insert(0,'api'); from tests.demo_content import load_cases; c=load_cases()['$1']; print(json.dumps(c.$2))"; }

case "$SCENARIO" in
  pass) CASE=S1; TITLE="Landing page copy for Nour Studio";;
  fail) CASE=S2; TITLE="Product FAQ for Olive & Co";;
  error) CASE=S2; TITLE="Forced evaluation error (S2 text)";;
  *) echo "unknown scenario $SCENARIO" >&2; exit 2;;
esac
SOW=$(case_text "$CASE" sow); DEL=$(case_text "$CASE" deliverable)

echo "== health: $(curl -s -m 20 $API/health)"
C=$(call POST /contracts client "{\"title\":\"$TITLE\",\"sow\":$SOW,\"amount_hbar\":\"5\"}")
ID=$(echo "$C" | j "d['id']"); echo "== created contract $ID ($(echo "$C" | j "d['status']"))"
C=$(call POST /contracts/$ID/fund client)
ESC=$(echo "$C" | j "d['escrow_id']"); FUND_TX=$(echo "$C" | j "[t['tx_hash'] for t in d['txs'] if t['kind']=='CREATE_ESCROW'][0]")
echo "== funded: escrow #$ESC  funding tx $FUND_TX"
call POST /contracts/$ID/deliverable freelancer "{\"content\":$DEL}" >/dev/null
echo "== deliverable submitted; evaluation (gated): $(call GET /contracts/$ID/evaluation freelancer)"

prev=""
for _ in $(seq 1 120); do
  st=$(call GET /contracts/$ID client | j "d['status'] + ('/' + d['hold_reason'] if d['hold_reason'] else '')")
  [ "$st" != "$prev" ] && echo "   $(date +%H:%M:%S) $st" && prev=$st
  case $st in RELEASED*|HELD*|ERROR*) break;; esac
  sleep 3
done

C=$(call GET /contracts/$ID client)
EV=$(call GET /contracts/$ID/evaluation client)
echo "== evaluation: $(echo "$EV" | j "{k: d.get(k) for k in ('available','verdict','confidence','injection_suspected')}")"
echo "   reasoning: $(echo "$EV" | j "d.get('reasoning','')[:160]")"

if [ "$SCENARIO" != pass ]; then
  RELEASE=$([ "$SCENARIO" = fail ] && echo true || echo false)
  echo "== arbitrator resolves (release=$RELEASE)"
  C=$(call POST /contracts/$ID/resolve arbitrator "{\"release\":$RELEASE}")
  echo "   -> $(echo "$C" | j "d['status']")"
fi

VER=$(call GET /verify/$ESC client)
TOPIC=$(echo "$VER" | j "d['anchor']['topic_id']"); HCS_TX=$(echo "$VER" | j "d['anchor']['tx_id']")
HCS_TXM=$("$PY" -c "a,s='$HCS_TX'.split('@'); x,n=s.split('.'); print(f'{a}-{x}-{n.ljust(9,\"0\")}')")
echo
echo "== RESULT contract $ID / escrow #$ESC: $(echo "$C" | j "d['status']") (hold_reason at verdict: see timeline)"
echo "$C" | j "'\n'.join('   ' + t['kind'].ljust(10) + t['message'] for t in d['timeline'])"
echo "== HashScan"
echo "   contract    $HS/contract/$(echo "$VER" | j "d['escrow']['contract_address']")"
echo "   funding     $(evm_link "$FUND_TX")"
echo "   HCS record  $HS/transaction/$HCS_TXM   (topic $HS/topic/$TOPIC, seq $(echo "$VER" | j "str(d['anchor']['sequence_first'])+'-'+str(d['anchor']['sequence_last'])"))"
for kind in SUBMIT_VERDICT RESOLVE_DISPUTE; do
  TX=$(echo "$C" | j "next((t['tx_hash'] for t in d['txs'] if t['kind']=='$kind'), '')")
  if [ -n "$TX" ]; then echo "   ${kind,,}  $(evm_link "$TX")"; fi
done
echo "== GATE SCENARIO '$SCENARIO' OK"
