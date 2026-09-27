"""Typed httpx client for hedera-svc (TRD §10.2, Schema §6).

Hashes are lowercase hex without 0x inside api; the 0x prefix is added only here, toward hedera-svc.
Errors map to Schema §5.1: 503 HEDERA_SVC_OFFLINE when unreachable, 502 CHAIN_ERROR with the
revert reason in details.reason, 409 INVALID_STATE for a call the contract would revert.
"""
from __future__ import annotations

import base64
from dataclasses import dataclass

import httpx

from app.config import settings
from app.errors import ApiError

TIMEOUT = httpx.Timeout(90.0, connect=5.0)  # contract calls wait up to 60 s for a receipt


@dataclass(frozen=True)
class Account:
    account_id: str
    evm_address: str
    balance_hbar: str


@dataclass(frozen=True)
class HcsSubmit:
    tx_id: str
    topic_id: str
    sequence_first: int
    sequence_last: int
    chunks: int


@dataclass(frozen=True)
class ChainTx:
    tx_hash: str  # 0x-prefixed EVM tx hash
    events: list[dict]


@dataclass(frozen=True)
class EscrowState:
    client: str
    freelancer: str
    arbitrator: str
    sow_hash: str  # no 0x
    verdict_hash: str  # no 0x
    verdict_passed: bool
    amount_tinybars: int
    status: str  # None | Funded | Released | Held | Refunded


def _0x(h: str) -> str:
    return h if h.startswith("0x") else "0x" + h


def _strip(h: str) -> str:
    return h[2:] if h.startswith("0x") else h


async def _call(method: str, path: str, json: dict | None = None) -> dict:
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            r = await client.request(method, f"{settings.hedera_svc_url}{path}", json=json,
                                     headers={"X-Internal-Token": settings.internal_token})
    except httpx.TransportError as e:
        raise ApiError(503, "HEDERA_SVC_OFFLINE", f"hedera-svc unreachable: {e!r}") from e
    if r.status_code < 300:
        return r.json()
    err = (r.json() if r.headers.get("content-type", "").startswith("application/json") else {}).get("error", {})
    details = {"reason": err.get("reason"), "hedera_svc_code": err.get("code")}
    if r.status_code == 409:
        raise ApiError(409, "INVALID_STATE", err.get("message", "contract call would revert"), details)
    if r.status_code == 404:
        raise ApiError(404, "NOT_FOUND", err.get("message", "not found"), details)
    raise ApiError(502, "CHAIN_ERROR", err.get("message", f"hedera-svc HTTP {r.status_code}"), details)


async def accounts() -> dict[str, Account]:
    data = await _call("GET", "/accounts")
    return {role: Account(v["accountId"], v["evmAddress"].lower(), v["balanceHbar"])
            for role, v in data.items() if "accountId" in v}


async def hcs_submit(record_bytes: bytes, record_hash: str) -> HcsSubmit:
    d = await _call("POST", "/hcs/submit",
                    {"messageBase64": base64.b64encode(record_bytes).decode(), "expectedHash": record_hash})
    return HcsSubmit(d["txId"], d["topicId"], d["sequenceFirst"], d["sequenceLast"], d["chunks"])


async def escrow_create(amount_hbar: str, freelancer_evm: str, arbitrator_evm: str, sow_hash: str) -> tuple[ChainTx, int]:
    d = await _call("POST", "/escrow/create", {"amountHbar": amount_hbar, "freelancerEvm": freelancer_evm,
                                               "arbitratorEvm": arbitrator_evm, "sowHash": _0x(sow_hash)})
    return ChainTx(d["txHash"], d.get("events", [])), int(d["escrowId"])


async def escrow_verdict(escrow_id: int, passed: bool, verdict_hash: str, sow_hash: str) -> ChainTx:
    d = await _call("POST", "/escrow/verdict", {"escrowId": escrow_id, "passed": passed,
                                                "verdictHash": _0x(verdict_hash), "sowHash": _0x(sow_hash)})
    return ChainTx(d["txHash"], d.get("events", []))


async def escrow_resolve(escrow_id: int, release: bool) -> ChainTx:
    d = await _call("POST", "/escrow/resolve", {"escrowId": escrow_id, "release": release})
    return ChainTx(d["txHash"], d.get("events", []))


async def escrow_get(escrow_id: int) -> EscrowState:
    d = await _call("GET", f"/escrow/{escrow_id}")
    return EscrowState(d["client"], d["freelancer"], d["arbitrator"], _strip(d["sowHash"]), _strip(d["verdictHash"]),
                       bool(d["verdictPassed"]), int(d["amountTinybars"]), d["status"])
