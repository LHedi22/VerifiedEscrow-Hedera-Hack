#!/usr/bin/env bash
# T2.4 check: manual curl against hedera-svc.
#   A: create -> verdict(pass) -> Released
#   B: create -> verdict(fail) -> Held -> resolve(refund) -> Refunded
#   C: resolve again -> 409 WOULD_REVERT with the contract's revert reason
# Run from the repo root with hedera-svc running. Uses 5 HBAR per escrow (TRD §4 demo amount).
set -euo pipefail
cd "$(dirname "$0")/.."
SVC=http://127.0.0.1:7000
TOKEN=$(grep '^INTERNAL_TOKEN=' hedera-svc/.env | cut -d= -f2)
H="X-Internal-Token: $TOKEN"
J="Content-Type: application/json"
field() { python -c "import json,sys; print(json.load(sys.stdin)$1)"; }

call() { # method path [json] -> prints body; fails on non-2xx
  local out code
  if [ $# -ge 3 ]; then out=$(curl -s -w '\n%{http_code}' -X "$1" -H "$H" -H "$J" -d "$3" "$SVC$2")
  else out=$(curl -s -w '\n%{http_code}' -X "$1" -H "$H" "$SVC$2"); fi
  code=${out##*$'\n'}; body=${out%$'\n'*}
  if [ "${code:0:1}" != 2 ]; then echo "HTTP $code on $1 $2: $body" >&2; return 1; fi
  echo "$body"
}
events() { python -c "import json,sys; d=json.load(sys.stdin); print(d['txHash'], [(e['name'], e['args']) for e in d['events']])"; }

ACC=$(call GET /accounts)
FR=$(echo "$ACC" | field "['freelancer']['evmAddress']")
AR=$(echo "$ACC" | field "['arbitrator']['evmAddress']")
SOW=0x$(printf 'T2.4 smoke SOW %s' "$(date +%s)" | sha256sum | cut -c1-64)
VP=0x$(printf 'verdict pass %s' "$SOW" | sha256sum | cut -c1-64)
VF=0x$(printf 'verdict fail %s' "$SOW" | sha256sum | cut -c1-64)
NEW="{\"amountHbar\":\"5\",\"freelancerEvm\":\"$FR\",\"arbitratorEvm\":\"$AR\",\"sowHash\":\"$SOW\"}"

echo "== A: create -> verdict(pass)"
C=$(call POST /escrow/create "$NEW"); A=$(echo "$C" | field "['escrowId']"); echo "create escrow $A: $(echo "$C" | events)"
echo "verdict: $(call POST /escrow/verdict "{\"escrowId\":$A,\"passed\":true,\"verdictHash\":\"$VP\",\"sowHash\":\"$SOW\"}" | events)"
echo "GET /escrow/$A: $(call GET /escrow/$A)"

echo "== B: create -> verdict(fail) -> resolve(refund)"
C=$(call POST /escrow/create "$NEW"); B=$(echo "$C" | field "['escrowId']"); echo "create escrow $B: $(echo "$C" | events)"
echo "verdict: $(call POST /escrow/verdict "{\"escrowId\":$B,\"passed\":false,\"verdictHash\":\"$VF\",\"sowHash\":\"$SOW\"}" | events)"
echo "status after verdict: $(call GET /escrow/$B | field "['status']")"
echo "resolve: $(call POST /escrow/resolve "{\"escrowId\":$B,\"release\":false}" | events)"
echo "GET /escrow/$B: $(call GET /escrow/$B)"

echo "== C: resolve again (expect 409 with the revert reason)"
curl -s -w ' HTTP %{http_code}\n' -X POST -H "$H" -H "$J" -d "{\"escrowId\":$B,\"release\":true}" "$SVC/escrow/resolve"
