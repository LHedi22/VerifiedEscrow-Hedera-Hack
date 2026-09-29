"""Evaluation state machine (TRD §9, Schema §7).

FUNDED -> EVALUATING -> ANCHORING -> CONFIRMING -> SUBMITTING_VERDICT -> RELEASED | HELD, with ERROR as a
paused state that resumes from error_step. Every transition is one short DB transaction; no transaction
stays open across an LLM or network call. Each step is idempotent, so startup resume and /retry share it.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from sqlalchemy import select, text

from app.config import settings
from app.db import SessionLocal
from app.errors import ApiError
from app.models import ChainTx, Contract, Deliverable, Evaluation, HcsAnchor, TimelineEvent
from app.services import evaluator, hedera_client, mirror
from app.services.canonical import KEYS, canonical_bytes, record_hash, record_timestamp

log = logging.getLogger("pipeline")

MAX_RECORD_BYTES = 18_000
HCS_ATTEMPTS = 3
ACTIVE = ("EVALUATING", "ANCHORING", "CONFIRMING", "SUBMITTING_VERDICT")
EVALUATION_ERROR_PREFIX = "EVALUATION_ERROR:"

_tasks: dict[int, asyncio.Task] = {}  # one pipeline task per contract
_criteria_tasks: dict[int, asyncio.Task] = {}  # funding-time criteria extraction (TRD §8.1 fallback 1)


class StepError(Exception):
    """A step failed in a way that pauses the contract in ERROR at that step."""


def busy() -> bool:
    return any(not t.done() for t in _tasks.values())


# ------------------------------------------------------------------ helpers
def timeline(s, contract_id: int, kind: str, message: str, ref: dict | None = None) -> None:
    s.add(TimelineEvent(contract_id=contract_id, kind=kind, message=message, ref=ref))


def set_error(contract_id: int, step: str, message: str) -> None:
    with SessionLocal.begin() as s:
        c = s.get(Contract, contract_id)
        c.status, c.error_step, c.error_message = "ERROR", step, message[:2000]
        timeline(s, contract_id, "error", f"Paused at {step}: {message[:300]}")
    log.warning("contract %s ERROR at %s: %s", contract_id, step, message)


def _record_from_view(s, contract_id: int) -> dict | None:
    row = s.execute(text("SELECT * FROM v_canonical_record WHERE db_contract_id = :id"), {"id": contract_id}).mappings().first()
    if row is None:
        return None
    return {k: row[k] for k in KEYS}  # drops db_contract_id


# ------------------------------------------------------------------ entry points
def start(contract_id: int) -> None:
    """Run (or resume) the pipeline for a contract, unless it already has a live task."""
    t = _tasks.get(contract_id)
    if t and not t.done():
        return
    _tasks[contract_id] = asyncio.create_task(_run(contract_id), name=f"pipeline-{contract_id}")


def resume_all() -> list[int]:
    """Startup resume for every contract mid-pipeline (TRD §9)."""
    with SessionLocal() as s:
        ids = list(s.scalars(select(Contract.id).where(Contract.status.in_(ACTIVE))))
    for cid in ids:
        start(cid)
    return ids


def retry(contract_id: int) -> None:
    """ERROR -> error_step, then resume with the same rules as startup."""
    with SessionLocal.begin() as s:
        c = s.get(Contract, contract_id)
        if c is None:
            raise ApiError(404, "NOT_FOUND", f"contract {contract_id} not found")
        if c.status != "ERROR":
            raise ApiError(409, "INVALID_STATE", f"Contract {contract_id} is {c.status}, expected ERROR")
        step = c.error_step
        c.status, c.error_step, c.error_message = step, None, None
        timeline(s, contract_id, "retried", f"Retrying from {step}")
    start(contract_id)


def start_criteria_extraction(contract_id: int) -> asyncio.Task:
    """At funding: extract and cache criteria so the live wait is the evaluation step only (TRD §8.1).
    One extraction at a time per contract: a running task is returned, never duplicated. A finished one is
    replaced, because demo/reset reuses DB ids (the old task's cache row is gone); _extract_criteria itself
    returns at once if criteria are already cached."""
    t = _criteria_tasks.get(contract_id)
    if t is None or t.done():
        t = _criteria_tasks[contract_id] = asyncio.create_task(_extract_criteria(contract_id), name=f"criteria-{contract_id}")
    return t


async def _wait_for_criteria(contract_id: int) -> None:
    """Evaluation step: reuse the funding-time extraction. If it is still running, wait for it (shielded, so a
    cancelled pipeline never cancels the shared extraction). Its failure is logged, not raised: evaluate() then
    extracts once itself."""
    t = _criteria_tasks.get(contract_id)
    if t is None:
        return  # e.g. api restarted after funding: nothing running, evaluate() extracts
    try:
        await asyncio.shield(t)
    except Exception as e:
        log.warning("funding-time criteria extraction for %s failed: %r", contract_id, e)


async def _extract_criteria(contract_id: int) -> None:
    with SessionLocal() as s:
        sow = s.get(Contract, contract_id).sow
        if s.scalar(select(Evaluation.id).where(Evaluation.contract_id == contract_id)):
            return  # already cached
    try:
        criteria, attempts, failures = await evaluator.extract_criteria(sow)
    except evaluator.EvaluatorUnavailable as e:
        log.warning("criteria at funding skipped for %s: %s", contract_id, e)
        return  # extracted later, when the deliverable arrives
    if not criteria:
        log.warning("criteria at funding failed for %s: %s", contract_id, failures)
        return
    with SessionLocal.begin() as s:
        if not s.scalar(select(Evaluation.id).where(Evaluation.contract_id == contract_id)):
            s.add(Evaluation(contract_id=contract_id, criteria=criteria, attempts=attempts))
    log.info("criteria cached for contract %s (%d criteria)", contract_id, len(criteria))


# ------------------------------------------------------------------ the loop
async def _run(contract_id: int) -> None:
    steps = {
        "EVALUATING": _evaluate,
        "ANCHORING": _anchor,
        "CONFIRMING": _confirm,
        "SUBMITTING_VERDICT": _submit_verdict,
    }
    while True:
        with SessionLocal() as s:
            status = s.get(Contract, contract_id).status
        step = steps.get(status)
        if step is None:
            return  # RELEASED, HELD, ERROR, ... : nothing to do
        try:
            await step(contract_id)
        except (StepError, evaluator.EvaluatorUnavailable, mirror.MirrorTimeout, ApiError) as e:
            set_error(contract_id, status, getattr(e, "message", None) or str(e))
            return
        except Exception as e:  # never leave a contract stuck mid-state silently
            log.exception("pipeline %s crashed at %s", contract_id, status)
            set_error(contract_id, status, f"unexpected: {e!r}")
            return


# ------------------------------------------------------------------ steps
async def _evaluate(contract_id: int) -> None:
    """EVALUATING -> ANCHORING. Ollama unreachable/timeout -> ERROR (nothing anchored)."""
    await _wait_for_criteria(contract_id)  # never a second extraction while the funding-time one runs
    with SessionLocal() as s:
        c = s.get(Contract, contract_id)
        sow = c.sow
        deliverable = s.scalar(select(Deliverable.content).where(Deliverable.contract_id == contract_id))
        ev = s.scalar(select(Evaluation).where(Evaluation.contract_id == contract_id))
        cached = ev.criteria if ev and ev.criteria else None
        prior_attempts = ev.attempts if ev else 0

    outcome = await evaluator.evaluate(sow, deliverable, criteria=cached)  # raises EvaluatorUnavailable

    # Hashing step: one transaction (TRD §9, Schema §7).
    with SessionLocal.begin() as s:
        c = s.get(Contract, contract_id)
        ev = s.scalar(select(Evaluation).where(Evaluation.contract_id == contract_id))
        if ev is None:
            ev = Evaluation(contract_id=contract_id, criteria=outcome.criteria)
            s.add(ev)
        ev.criteria = outcome.criteria
        ev.results = outcome.results
        ev.confidence = outcome.confidence
        ev.injection_suspected = outcome.injection_suspected
        ev.verdict = outcome.verdict
        ev.reasoning = outcome.reasoning
        ev.model_version = outcome.model_version
        ev.record_timestamp = record_timestamp()
        ev.attempts = prior_attempts + outcome.attempts
        ev.raw_output = outcome.raw_output
        s.flush()
        rec = _record_from_view(s, contract_id)
        data = canonical_bytes(rec)
        while len(data) > MAX_RECORD_BYTES:  # shrink reasoning further if needed
            ev.reasoning = evaluator.truncate(ev.reasoning, max(200, len(ev.reasoning) - (len(data) - MAX_RECORD_BYTES) - 50))
            s.flush()
            rec = _record_from_view(s, contract_id)
            data = canonical_bytes(rec)
        ev.record_hash = record_hash(rec)
        ev.record_bytes = len(data)
        c.status = "ANCHORING"
        timeline(s, contract_id, "evaluated", "Evaluation complete")  # never the verdict (FR-11)
    if outcome.evaluation_error:
        log.warning("contract %s: EVALUATION_ERROR record (%s)", contract_id, outcome.failures)


async def _anchor(contract_id: int) -> None:
    """ANCHORING -> CONFIRMING. Resubmitting is harmless: a duplicate is byte-identical (TRD §9)."""
    with SessionLocal() as s:
        if s.scalar(select(HcsAnchor.id).where(HcsAnchor.contract_id == contract_id)):
            with SessionLocal.begin() as s2:
                s2.get(Contract, contract_id).status = "CONFIRMING"
            return
        rec = _record_from_view(s, contract_id)
        stored_hash = s.scalar(select(Evaluation.record_hash).where(Evaluation.contract_id == contract_id))
    data = canonical_bytes(rec)
    h = record_hash(rec)
    if h != stored_hash:
        raise StepError("stored record no longer matches the hash computed at evaluation; refusing to anchor")
    expected_topic = settings.topic_id  # demo topic only, never devTopicId

    last: Exception | None = None
    for attempt in range(1, HCS_ATTEMPTS + 1):
        try:
            sub = await hedera_client.hcs_submit(data, h)
            break
        except ApiError as e:
            last = e
            if attempt < HCS_ATTEMPTS:
                await asyncio.sleep(2 * attempt)
    else:
        raise StepError(f"HCS submit failed {HCS_ATTEMPTS}x: {getattr(last, 'message', last)}")
    if sub.topic_id != expected_topic:
        raise StepError(f"hedera-svc submitted to {sub.topic_id}, expected demo topic {expected_topic}")

    with SessionLocal.begin() as s:
        s.add(HcsAnchor(contract_id=contract_id, topic_id=sub.topic_id, tx_id=sub.tx_id,
                        sequence_first=sub.sequence_first, sequence_last=sub.sequence_last, chunk_count=sub.chunks))
        s.get(Contract, contract_id).status = "CONFIRMING"
        timeline(s, contract_id, "anchored", f"Record anchored on HCS topic {sub.topic_id} ({sub.chunks} chunks)",
                 {"topic_id": sub.topic_id, "sequence": sub.sequence_last, "tx_id": sub.tx_id})


async def _confirm(contract_id: int) -> None:
    """CONFIRMING -> SUBMITTING_VERDICT. Only ever polls the mirror node; never resubmits."""
    with SessionLocal() as s:
        a = s.scalar(select(HcsAnchor).where(HcsAnchor.contract_id == contract_id))
        h = s.scalar(select(Evaluation.record_hash).where(Evaluation.contract_id == contract_id))
        topic, tx_id, first, last = a.topic_id, a.tx_id, a.sequence_first, a.sequence_last
    conf = await mirror.confirm(topic, tx_id, first, last, h)  # MirrorTimeout -> ERROR after 120 s
    with SessionLocal.begin() as s:
        a = s.scalar(select(HcsAnchor).where(HcsAnchor.contract_id == contract_id))
        a.consensus_timestamp = conf.consensus_timestamp
        a.confirmed_at = datetime.now(timezone.utc)  # the visibility gate (FR-11)
        s.get(Contract, contract_id).status = "SUBMITTING_VERDICT"
        timeline(s, contract_id, "confirmed", "Mirror node confirmed the anchored record by hash",
                 {"topic_id": topic, "sequence": last})


async def _submit_verdict(contract_id: int) -> None:
    """SUBMITTING_VERDICT -> RELEASED | HELD. Reads the chain first; reconciles if already applied."""
    with SessionLocal() as s:
        c = s.get(Contract, contract_id)
        ev = s.scalar(select(Evaluation).where(Evaluation.contract_id == contract_id))
        escrow_id, sow_hash = c.escrow_id, c.sow_hash
        passed = ev.verdict == "pass"
        verdict_hash = ev.record_hash
        hold_reason = "EVALUATION_ERROR" if ev.reasoning.startswith(EVALUATION_ERROR_PREFIX) else "FAILED_VERDICT"
        amount_hbar = _hbar(c.amount_tinybars)

    chain = await hedera_client.escrow_get(escrow_id)
    if chain.status in ("Released", "Held", "Refunded"):  # already applied: reconcile, don't resubmit
        with SessionLocal.begin() as s:
            c = s.get(Contract, contract_id)
            c.status = {"Released": "RELEASED", "Held": "HELD", "Refunded": "REFUNDED"}[chain.status]
            c.hold_reason = hold_reason if c.status == "HELD" else None
            timeline(s, contract_id, "reconciled", f"Reconciled from chain: escrow #{escrow_id} is {chain.status}")
        return

    tx = await hedera_client.escrow_verdict(escrow_id, passed, verdict_hash, sow_hash)  # ApiError -> ERROR
    with SessionLocal.begin() as s:
        c = s.get(Contract, contract_id)
        s.add(ChainTx(contract_id=contract_id, kind="SUBMIT_VERDICT", tx_hash=tx.tx_hash.lower(), succeeded=True, events=tx.events))
        if passed:
            c.status, c.hold_reason = "RELEASED", None
            timeline(s, contract_id, "released", f"{amount_hbar} ℏ released to the freelancer", {"tx_hash": tx.tx_hash})
        else:
            c.status, c.hold_reason = "HELD", hold_reason
            timeline(s, contract_id, "held", f"{amount_hbar} ℏ held for arbitrator review ({hold_reason})", {"tx_hash": tx.tx_hash})


def _hbar(tinybars: int) -> str:
    whole, frac = divmod(tinybars, 100_000_000)
    return f"{whole}.{frac:08d}".rstrip("0").rstrip(".")
