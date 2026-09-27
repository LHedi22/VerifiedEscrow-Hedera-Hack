"""Mirror-node confirmation of an HCS record (TRD §6.1).

Same reassembly rules as packages/canonical/hcs.ts:
- keep only messages whose chunk_info.initial_transaction_id matches the expected transaction
  (account_id + transaction_valid_start);
- chunk_info == null is a complete 1-of-1 message;
- sort by chunk_info.number, require 1..total with no gaps, base64-decode and concatenate.
Confirmed iff all chunks are present and sha256(bytes) == record hash.
"""
from __future__ import annotations

import asyncio
import base64
import hashlib
import time
from dataclasses import dataclass

import httpx

from app.config import settings

POLL_S = 1.0
TIMEOUT_S = 120.0


@dataclass(frozen=True)
class Confirmation:
    topic_id: str
    sequence_first: int
    sequence_last: int
    chunk_count: int
    consensus_timestamp: str  # of the last chunk, mirror format "1759501329.481234567"
    record_bytes: bytes


class MirrorTimeout(TimeoutError):
    """No hash-matching record within TIMEOUT_S; the pipeline moves to ERROR (resumable, never resubmits)."""


def parse_tx_id(tx_id: str) -> tuple[str, str]:
    """SDK "0.0.5@1759501329.48123" -> ("0.0.5", "1759501329.481230000") in mirror format (9-digit nanos)."""
    account, _, valid_start = tx_id.partition("@")
    seconds, _, nanos = valid_start.partition(".")
    if not (account and seconds.isdigit()):
        raise ValueError(f"bad transaction id: {tx_id!r}")
    return account, f"{seconds}.{nanos.ljust(9, '0')[:9]}"


def reassemble(messages: list[dict], tx_id: str) -> tuple[bytes, list[dict]] | None:
    """Apply the reassembly rules. Returns (bytes, chunks used) or None if incomplete."""
    account, valid_start = parse_tx_id(tx_id)
    chunks: list[dict] = []
    for m in messages:
        info = m.get("chunk_info")
        if info is None:
            # a complete 1-of-1 message; only valid if the query window is exactly this message
            if len(messages) == 1:
                return base64.b64decode(m["message"]), [m]
            continue
        initial = info.get("initial_transaction_id") or {}
        if initial.get("account_id") == account and initial.get("transaction_valid_start") == valid_start:
            chunks.append(m)
    if not chunks:
        return None
    chunks.sort(key=lambda m: m["chunk_info"]["number"])
    total = chunks[0]["chunk_info"]["total"]
    numbers = [m["chunk_info"]["number"] for m in chunks]
    if numbers != list(range(1, total + 1)) or any(m["chunk_info"]["total"] != total for m in chunks):
        return None
    return b"".join(base64.b64decode(m["message"]) for m in chunks), chunks


async def fetch_window(client: httpx.AsyncClient, topic_id: str, first: int, last: int) -> list[dict]:
    r = await client.get(
        f"{settings.mirror_url}/api/v1/topics/{topic_id}/messages",
        params=[("sequencenumber", f"gte:{first}"), ("sequencenumber", f"lte:{last}"), ("limit", "25")],
    )
    r.raise_for_status()
    return r.json().get("messages", [])


def check(messages: list[dict], topic_id: str, tx_id: str, expected_hash: str) -> Confirmation | None:
    got = reassemble(messages, tx_id)
    if got is None:
        return None
    data, chunks = got
    if hashlib.sha256(data).hexdigest() != expected_hash:
        return None
    return Confirmation(
        topic_id=topic_id,
        sequence_first=chunks[0]["sequence_number"],
        sequence_last=chunks[-1]["sequence_number"],
        chunk_count=len(chunks),
        consensus_timestamp=chunks[-1]["consensus_timestamp"],
        record_bytes=data,
    )


async def confirm(topic_id: str, tx_id: str, first: int, last: int, expected_hash: str,
                  timeout_s: float = TIMEOUT_S) -> Confirmation:
    """Poll the bounded window every second until the record is confirmed by hash."""
    deadline = time.monotonic() + timeout_s
    async with httpx.AsyncClient(timeout=10) as client:
        while True:
            try:
                c = check(await fetch_window(client, topic_id, first, last), topic_id, tx_id, expected_hash)
                if c:
                    return c
            except httpx.HTTPError:
                pass  # mirror hiccup: keep polling until the deadline
            if time.monotonic() >= deadline:
                raise MirrorTimeout(f"no hash match for {topic_id} seq {first}-{last} after {timeout_s:.0f} s")
            await asyncio.sleep(POLL_S)
