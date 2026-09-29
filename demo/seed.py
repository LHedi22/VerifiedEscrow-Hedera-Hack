"""Seed S1-S3 on testnet through the real pipeline, assert each end state, then snapshot (Schema §8.1-8.2).

  cd api
  .venv\\Scripts\\python ..\\demo\\seed.py --fresh      # truncate (demo/reset.sql) first, then seed + snapshot

Needs the stack running (scripts/start-all.ps1) and Ollama. Spends 3 x 5 HBAR plus fees.
Stops with an error if any seed ends in a state other than the expected one: re-run rather than snapshot it.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import subprocess
import sys
import time
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1]
API = os.environ.get("API_URL", "http://localhost:8000")
ACTIVE = {"EVALUATING", "ANCHORING", "CONFIRMING", "SUBMITTING_VERDICT"}
SEEDS = json.loads((ROOT / "demo" / "seed_content.json").read_text(encoding="utf-8"))["seeds"]
t0 = time.monotonic()


def log(msg: str) -> None:
    print(f"[{time.monotonic() - t0:6.1f}s] {msg}", flush=True)


def compose(*args: str) -> None:
    subprocess.run(["docker", "compose", *args], cwd=ROOT, check=True)


def call(c: httpx.Client, method: str, path: str, persona: str | None = None, **kw) -> dict:
    r = c.request(method, f"{API}{path}", headers={"X-Persona": persona} if persona else {}, **kw)
    if r.status_code >= 400:
        raise SystemExit(f"{method} {path} -> {r.status_code} {r.text}")
    return r.json()


def step1_personas() -> None:
    """Schema §8.1: the same code the api runs at startup (insert from hedera-svc /accounts if empty)."""
    sys.path.insert(0, str(ROOT / "api"))
    from app.routers.personas import sync_personas
    asyncio.run(sync_personas())


def seed_one(c: httpx.Client, s: dict) -> dict:
    ct = call(c, "POST", "/contracts", "client", json={"title": s["title"], "sow": s["sow"], "amount_hbar": s["amount_hbar"]})
    cid = ct["id"]
    ct = call(c, "POST", f"/contracts/{cid}/fund", "client", timeout=120)
    log(f"{s['id']}: contract {cid} funded, escrow #{ct['escrow_id']}")
    # Criteria at funding (TRD §8.1 fallback 1): give the extraction a head start, as the run sheet does.
    deadline = time.monotonic() + 120
    while not call(c, "GET", f"/contracts/{cid}")["criteria_ready"] and time.monotonic() < deadline:
        time.sleep(2)
    call(c, "POST", f"/contracts/{cid}/deliverable", "freelancer", json={"content": s["deliverable"]}, timeout=30)
    submitted = time.monotonic()
    while True:
        ct = call(c, "GET", f"/contracts/{cid}")
        if ct["status"] not in ACTIVE:
            break
        if time.monotonic() - submitted > 400:
            raise SystemExit(f"{s['id']}: still {ct['status']} after 400 s")
        time.sleep(2)
    ev = call(c, "GET", f"/contracts/{cid}/evaluation")
    got = {"status": ct["status"], "hold_reason": ct["hold_reason"], "verdict": ev.get("verdict"),
           "injection": ev.get("injection_suspected")}
    want = {"status": s["expected_status"], "hold_reason": s["expected_hold_reason"], "verdict": s["expected_verdict"],
            "injection": s["expected_injection"]}
    log(f"{s['id']}: {got} in {time.monotonic() - submitted:.0f} s")
    if got != want:
        raise SystemExit(f"{s['id']} ended {got}, expected {want}: re-run seed.py; do NOT snapshot this")
    return {"id": s["id"], "contract_id": cid, "escrow_id": ct["escrow_id"], **got,
            "anchor": ct["anchor"], "seconds": round(time.monotonic() - submitted)}


def check_existing(c: httpx.Client, s: dict) -> dict:
    """--verify-only: assert the latest contract with this seed's title is in the expected end state."""
    rows = [x for x in call(c, "GET", "/contracts")["items"] if x["title"] == s["title"]]
    if not rows:
        raise SystemExit(f"{s['id']}: no contract titled {s['title']!r}")
    ct = max(rows, key=lambda x: x["id"])
    ev = call(c, "GET", f"/contracts/{ct['id']}/evaluation")
    got = {"status": ct["status"], "hold_reason": ct["hold_reason"], "verdict": ev.get("verdict"), "injection": ev.get("injection_suspected")}
    want = {"status": s["expected_status"], "hold_reason": s["expected_hold_reason"], "verdict": s["expected_verdict"],
            "injection": s["expected_injection"]}
    log(f"{s['id']}: contract {ct['id']} escrow #{ct['escrow_id']} {got}")
    if got != want:
        raise SystemExit(f"{s['id']} is {got}, expected {want}: do NOT snapshot this")
    return {"id": s["id"], "contract_id": ct["id"], "escrow_id": ct["escrow_id"], **got}


def snapshot() -> None:
    """Schema §8.2: data only, inside the container, then copied out (no binary through the shell)."""
    compose("exec", "-T", "db", "pg_dump", "-U", "vte", "-d", "vte", "-Fc", "--data-only",
            "--exclude-table=alembic_version", "-f", "/tmp/snapshot.dump")
    compose("cp", "db:/tmp/snapshot.dump", "demo/snapshot.dump")
    log(f"snapshot: demo/snapshot.dump ({(ROOT / 'demo' / 'snapshot.dump').stat().st_size} bytes)")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--fresh", action="store_true", help="truncate every table first (demo/reset.sql)")
    ap.add_argument("--only", nargs="*", help="seed ids, default S1 S2 S3")
    ap.add_argument("--verify-only", action="store_true",
                    help="seed nothing: assert the existing seeds' end states (e.g. after POST /retry), then snapshot")
    args = ap.parse_args()
    with httpx.Client(timeout=30) as c:
        h = call(c, "GET", "/health")
        down = [k for k in ("db", "ollama", "hedera_svc", "mirror") if h[k] != "ok"]
        if down or h.get("forced_eval_error"):
            raise SystemExit(f"/health not ready: down={down} forced_eval_error={h.get('forced_eval_error')}")
        busy = [x["id"] for x in call(c, "GET", "/contracts")["items"] if x["status"] in ACTIVE]
        if busy:
            raise SystemExit(f"pipelines running for contracts {busy}; wait for them to finish")
        if args.verify_only:
            results = [check_existing(c, s) for s in SEEDS]
            snapshot()
            print(json.dumps(results, indent=2))
            return
        if args.fresh:
            compose("exec", "-T", "db", "psql", "-v", "ON_ERROR_STOP=1", "-U", "vte", "-d", "vte", "-f", "/demo/reset.sql")
            log("truncated (demo/reset.sql)")
        step1_personas()
        log("personas: " + ", ".join(f"{p['role']}={p['display_name']} {p['account_id']}" for p in call(c, "GET", "/personas")))
        results = [seed_one(c, s) for s in SEEDS if not args.only or s["id"] in args.only]
    snapshot()
    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
