"""T1.5 + T1.10 check: submit a ~3 KB canonical record through hedera-svc, then confirm it on the
mirror node by hash. Uses the dev topic (hedera-svc's Day 1 fallback). Needs hedera-svc running.

Run from the repo root:  api/.venv/Scripts/python scripts/hcs_smoke.py
"""
import asyncio
import base64
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "api"))

import httpx  # noqa: E402

from app.config import settings  # noqa: E402
from app.services import mirror  # noqa: E402
from app.services.canonical import canonical_bytes, record_hash, record_timestamp  # noqa: E402

HASHSCAN = "https://hashscan.io/testnet"


def mirror_tx_id(sdk: str) -> str:
    account, _, start = sdk.partition("@")
    secs, _, nanos = start.partition(".")
    return f"{account}-{secs}-{nanos.ljust(9, '0')[:9]}"


async def main() -> int:
    fixture = json.loads((ROOT / "packages/canonical/fixtures/03-arabic.json").read_text(encoding="utf-8"))
    record = {**fixture, "contract_id": "dev-smoke", "timestamp": record_timestamp(),
              "reasoning": ("Smoke test for chunked HCS submission. " * 80)[:3000]}
    data = canonical_bytes(record)
    h = record_hash(record)
    print(f"record: {len(data)} bytes, sha256 {h}")

    async with httpx.AsyncClient(timeout=120) as client:
        r = await client.post(f"{settings.hedera_svc_url}/hcs/submit",
                              headers={"X-Internal-Token": settings.internal_token},
                              json={"messageBase64": base64.b64encode(data).decode(), "expectedHash": h})
        print(f"/hcs/submit HTTP {r.status_code}: {r.text}")
        if r.status_code != 200:
            return 1
        sub = r.json()
        ok_seq = sub["sequenceFirst"] < sub["sequenceLast"] and sub["chunks"] == sub["sequenceLast"] - sub["sequenceFirst"] + 1
        print(f"T1.5: sequenceFirst {sub['sequenceFirst']} < sequenceLast {sub['sequenceLast']}, "
              f"{sub['chunks']} chunks -> {'PASS' if ok_seq else 'FAIL'}")

        c = await mirror.confirm(sub["topicId"], sub["txId"], sub["sequenceFirst"], sub["sequenceLast"], h)
        print(f"T1.10: mirror confirmed by hash: seq {c.sequence_first}-{c.sequence_last}, {c.chunk_count} chunks, "
              f"consensus {c.consensus_timestamp}, bytes equal: {c.record_bytes == data}")

        # Link helper formats (TRD §11): the mirror resolves the same IDs HashScan uses.
        txm = mirror_tx_id(sub["txId"])
        t = await client.get(f"{settings.mirror_url}/api/v1/transactions/{txm}")
        tp = await client.get(f"{settings.mirror_url}/api/v1/topics/{sub['topicId']}")
        print(f"link ids resolve on mirror: transaction {txm} -> HTTP {t.status_code}, topic -> HTTP {tp.status_code}")
    print(f"\n{HASHSCAN}/topic/{sub['topicId']}\n{HASHSCAN}/transaction/{txm}")
    return 0 if ok_seq and c.record_bytes == data and t.status_code == tp.status_code == 200 else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
