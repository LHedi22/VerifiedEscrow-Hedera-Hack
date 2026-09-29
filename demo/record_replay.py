"""FR-29: record a real evaluation so DEMO_REPLAY=1 can replay it if Ollama fails on stage.

Reads a contract's evaluation from the running api (after mirror confirmation, so it is the anchored one) and
writes api/app/replay/recordings.json, keyed by the SOW hash and the deliverable hash.

  api\\.venv\\Scripts\\python demo\\record_replay.py            # contract 1 = seeded S1 (the "Use example SOW" run)
"""
import hashlib
import json
import sys
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1]
API = "http://localhost:8000"
OUT = ROOT / "api" / "app" / "replay" / "recordings.json"
cid = int(sys.argv[1]) if len(sys.argv) > 1 else 1

c = httpx.get(f"{API}/contracts/{cid}").json()
ev = httpx.get(f"{API}/contracts/{cid}/evaluation").json()
if not ev.get("available"):
    raise SystemExit(f"contract {cid}: evaluation not confirmed yet")
if ev["model_version"].startswith("replay/"):
    raise SystemExit(f"contract {cid} is itself a replay; record from a real run")
deliverable = c["deliverable"]["content"]  # stored text is already normalized (TRD §5.2)
rec = {
    "sow_hash": c["sow_hash"],
    "deliverable_sha256": hashlib.sha256(deliverable.encode("utf-8")).hexdigest(),
    "model_version": ev["model_version"],
    "verdict": ev["verdict"],
    "reasoning": ev["reasoning"],
    "confidence": ev["confidence"],
    "injection_suspected": ev["injection_suspected"],
    "criteria": ev["criteria"],
    "results": ev["results"],
    "recorded_from": {"contract_id": cid, "escrow_id": c["escrow_id"], "title": c["title"],
                      "record_timestamp": ev["record_timestamp"], "hcs_tx_id": c["anchor"]["tx_id"]},
}
OUT.parent.mkdir(parents=True, exist_ok=True)
existing = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else []
existing = [r for r in existing if (r["sow_hash"], r["deliverable_sha256"]) != (rec["sow_hash"], rec["deliverable_sha256"])]
OUT.write_bytes((json.dumps(existing + [rec], ensure_ascii=False, indent=2) + "\n").encode("utf-8"))
print(f"recorded contract {cid} (escrow #{c['escrow_id']}, {ev['verdict']}, {ev['model_version']}) -> {OUT}")
