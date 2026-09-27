"""T1.11 Day 1 gate: S1 SOW + deliverable -> evaluator -> canonical record -> /hcs/submit -> mirror confirm.

The record uses contract_id "dev-1" and goes to the DEV topic (hedera-svc falls back to devTopicId
while shared/deployment.json has no demo topicId). Needs hedera-svc running and Ollama up.

Run from the repo root:  api/.venv/Scripts/python scripts/day1_e2e.py
"""
import asyncio
import base64
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "api"))

import httpx  # noqa: E402

from app.config import settings  # noqa: E402
from app.services import evaluator, mirror  # noqa: E402
from app.services.canonical import canonical_bytes, record_hash, record_timestamp  # noqa: E402
from tests.demo_content import load_cases  # noqa: E402

HASHSCAN = "https://hashscan.io/testnet"


def mirror_tx_id(sdk_tx_id: str) -> str:
    account, _, start = sdk_tx_id.partition("@")
    secs, _, nanos = start.partition(".")
    return f"{account}-{secs}-{nanos.ljust(9, '0')[:9]}"


async def main() -> int:
    deployment = json.loads((ROOT / "shared" / "deployment.json").read_text(encoding="utf-8"))
    if deployment.get("topicId"):
        print("STOP: shared/deployment.json has a demo topicId; the Day 1 record must go to the dev topic.")
        return 2

    s1 = load_cases()["S1"]
    t0 = time.perf_counter()
    outcome = await evaluator.evaluate(s1.sow, s1.deliverable)
    print(f"evaluator: verdict={outcome.verdict} confidence={outcome.confidence} "
          f"attempts={outcome.attempts} ({time.perf_counter() - t0:.1f} s)")
    if outcome.evaluation_error:
        print(f"  EVALUATION_ERROR: {outcome.failures}")

    record = {
        "contract_id": "dev-1",
        "deliverable": s1.deliverable,
        "model_version": outcome.model_version,
        "reasoning": outcome.reasoning,
        "schema": "vte-record/1",
        "sow": s1.sow,
        "timestamp": record_timestamp(),
        "verdict": outcome.verdict,
    }
    data = canonical_bytes(record)
    h = record_hash(record)
    print(f"record: {len(data)} bytes, sha256 {h}")

    async with httpx.AsyncClient(timeout=120) as client:
        r = await client.post(
            f"{settings.hedera_svc_url}/hcs/submit",
            headers={"X-Internal-Token": settings.internal_token},
            json={"messageBase64": base64.b64encode(data).decode(), "expectedHash": h},
        )
    if r.status_code != 200:
        print(f"hcs/submit failed: HTTP {r.status_code} {r.text}")
        return 1
    sub = r.json()
    print(f"submitted: topic {sub['topicId']} seq {sub['sequenceFirst']}-{sub['sequenceLast']} "
          f"({sub['chunks']} chunks), tx {sub['txId']}")

    t1 = time.perf_counter()
    c = await mirror.confirm(sub["topicId"], sub["txId"], sub["sequenceFirst"], sub["sequenceLast"], h)
    print(f"mirror: CONFIRMED by hash in {time.perf_counter() - t1:.1f} s "
          f"(seq {c.sequence_first}-{c.sequence_last}, {c.chunk_count} chunks, consensus {c.consensus_timestamp})")
    assert c.record_bytes == data

    print(f"\nHashScan topic:       {HASHSCAN}/topic/{sub['topicId']}")
    print(f"HashScan transaction: {HASHSCAN}/transaction/{mirror_tx_id(sub['txId'])}")
    print("\nDay 1 gate PASS: a real AI verdict record on the dev topic, hash-confirmed")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
