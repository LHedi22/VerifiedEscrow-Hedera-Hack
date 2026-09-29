"""/contracts (Schema §5.3). `{id}` is the DB id."""
from __future__ import annotations

import hashlib

import httpx
from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError

from app.config import settings
from app.db import SessionLocal
from app.errors import ApiError
from app.models import ChainTx, Contract, Deliverable, Evaluation, HcsAnchor, Persona
from app.schemas import (CreateContract, Dispute, Resolve, SubmitDeliverable, contract_out, persona_header,
                         persona_row, require_persona, summary_out, to_hbar, to_tinybars)
from app.services import evaluator, hedera_client, pipeline
from app.services.canonical import InvalidText, canonical_bytes, normalize, record_timestamp

router = APIRouter(prefix="/contracts", tags=["contracts"])


def _get(s, contract_id: int) -> Contract:
    c = s.get(Contract, contract_id)
    if c is None:
        raise ApiError(404, "NOT_FOUND", f"contract {contract_id} not found")
    return c


def _expect(c: Contract, *statuses: str) -> None:
    if c.status not in statuses:
        raise ApiError(409, "INVALID_STATE", f"Contract {c.id} is {c.status}, expected {' or '.join(statuses)}")


def _normalize(value: str, field: str, lo: int, hi: int) -> str:
    try:
        v = normalize(value)
    except InvalidText as e:
        raise ApiError(422, "INVALID_TEXT", f"{field}: {e}") from e
    if not lo <= len(v) <= hi:
        raise ApiError(422, "VALIDATION_ERROR", f"{field} must be {lo}-{hi} characters after normalization (got {len(v)})")
    return v


@router.post("", status_code=201)
def create(body: CreateContract, persona: str | None = Depends(persona_header)):
    require_persona(persona, "client")
    title = body.title.strip()
    if not 1 <= len(title) <= 120:
        raise ApiError(422, "VALIDATION_ERROR", "title must be 1-120 characters")
    sow = _normalize(body.sow, "sow", 50, 4000)
    roles = {"client", body.freelancer_role, body.arbitrator_role}
    if len(roles) != 3 or body.freelancer_role != "freelancer" or body.arbitrator_role != "arbitrator":
        raise ApiError(422, "VALIDATION_ERROR", "client, freelancer and arbitrator must be distinct personas")
    with SessionLocal.begin() as s:
        c = Contract(title=title, sow=sow, sow_hash=hashlib.sha256(sow.encode("utf-8")).hexdigest(),
                     amount_tinybars=to_tinybars(body.amount_hbar), client_id=persona_row(s, "client").id,
                     freelancer_id=persona_row(s, "freelancer").id, arbitrator_id=persona_row(s, "arbitrator").id)
        s.add(c)
        s.flush()
        pipeline.timeline(s, c.id, "created", f"Draft created: {to_hbar(c.amount_tinybars)} ℏ")
        s.flush()
        return contract_out(s, c)


@router.post("/{contract_id}/fund")
async def fund(contract_id: int, persona: str | None = Depends(persona_header)):
    require_persona(persona, "client")
    with SessionLocal() as s:
        c = _get(s, contract_id)
        _expect(c, "DRAFT")
        amount, sow_hash = to_hbar(c.amount_tinybars), c.sow_hash
        fr = s.get(Persona, c.freelancer_id).evm_address
        ar = s.get(Persona, c.arbitrator_id).evm_address
    # Network call outside any transaction. On failure the contract stays DRAFT (502 CHAIN_ERROR).
    tx, escrow_id = await hedera_client.escrow_create(amount, fr, ar, sow_hash)
    with SessionLocal.begin() as s:
        c = s.get(Contract, contract_id)
        c.escrow_id, c.status = escrow_id, "FUNDED"
        s.add(ChainTx(contract_id=contract_id, kind="CREATE_ESCROW", tx_hash=tx.tx_hash.lower(), succeeded=True, events=tx.events))
        pipeline.timeline(s, contract_id, "funded", f"{amount} ℏ locked in escrow #{escrow_id}", {"tx_hash": tx.tx_hash})
        s.flush()
        out = contract_out(s, c)
    pipeline.start_criteria_extraction(contract_id)  # TRD §8.1 fallback 1
    return out


@router.get("")
def list_contracts(status: str | None = None, mine: bool = False, persona: str | None = Depends(persona_header)):
    with SessionLocal() as s:
        q = select(Contract).order_by(Contract.updated_at.desc())
        if status:
            q = q.where(Contract.status == status.upper())
        if mine:
            me = persona_row(s, require_persona(persona, "client", "freelancer", "arbitrator"))
            col = {"client": Contract.client_id, "freelancer": Contract.freelancer_id, "arbitrator": Contract.arbitrator_id}[persona]
            q = q.where(col == me.id)
        items = [summary_out(s, c) for c in s.scalars(q)]
    return {"items": items, "total": len(items)}


@router.get("/{contract_id}")
def get_contract(contract_id: int):
    with SessionLocal() as s:
        return contract_out(s, _get(s, contract_id))


@router.post("/{contract_id}/deliverable", status_code=202)
async def submit_deliverable(contract_id: int, body: SubmitDeliverable, persona: str | None = Depends(persona_header)):
    require_persona(persona, "freelancer")
    content = _normalize(body.content, "content", 1, 8000)
    with SessionLocal() as s:
        c = _get(s, contract_id)
        _expect(c, "FUNDED")
        sow, escrow_id, sow_hash = c.sow, c.escrow_id, c.sow_hash
    # Size pre-check on the real canonical serialization, with a 3,000-char reasoning placeholder.
    probe = {"contract_id": str(escrow_id), "deliverable": content, "model_version": "ollama/" + settings.ollama_model + "@" + "0" * 12,
             "reasoning": "x" * 3000, "schema": "vte-record/1", "sow": sow, "timestamp": record_timestamp(), "verdict": "fail"}
    if len(canonical_bytes(probe)) > 18_000:
        raise ApiError(422, "RECORD_TOO_LARGE", "the anchored record would exceed 18,000 bytes; shorten the deliverable")
    replayable = settings.demo_replay and evaluator.replay(sow_hash, content) is not None  # FR-29: Ollama not needed
    if not replayable:
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                (await client.get(f"{settings.ollama_url}/api/tags")).raise_for_status()
        except httpx.HTTPError as e:
            raise ApiError(503, "EVALUATOR_OFFLINE", "the evaluator (Ollama) is offline") from e
    # Atomic claim: one short transaction, no row lock across calls (TRD §9).
    try:
        with SessionLocal.begin() as s:
            claimed = s.execute(update(Contract).where(Contract.id == contract_id, Contract.status == "FUNDED")
                                .values(status="EVALUATING").returning(Contract.id)).first()
            if claimed is None:
                raise ApiError(409, "INVALID_STATE", f"Contract {contract_id} is no longer FUNDED")
            s.add(Deliverable(contract_id=contract_id, content=content))
            s.flush()
            pipeline.timeline(s, contract_id, "submitted", "Deliverable submitted; evaluation started")
    except IntegrityError as e:
        raise ApiError(409, "ALREADY_SUBMITTED", "a deliverable was already submitted for this contract") from e
    pipeline.start(contract_id)
    return {"contract_id": contract_id, "status": "EVALUATING"}


@router.get("/{contract_id}/evaluation")
def evaluation(contract_id: int):
    """One visibility rule (FR-11): nothing about the verdict until the mirror node confirmed the record."""
    with SessionLocal() as s:
        c = _get(s, contract_id)
        confirmed = s.scalar(select(HcsAnchor.confirmed_at).where(HcsAnchor.contract_id == contract_id))
        if confirmed is None:
            return {"available": False, "status": c.status}
        ev = s.scalar(select(Evaluation).where(Evaluation.contract_id == contract_id))
        return {
            "available": True,
            "anchored": False,  # criteria/results/confidence are not hashed in v1
            "criteria": ev.criteria,
            "results": ev.results,
            "confidence": float(ev.confidence) if ev.confidence is not None else None,
            "injection_suspected": ev.injection_suspected,
            "verdict": ev.verdict,
            "reasoning": ev.reasoning,
            "model_version": ev.model_version,
            "record_timestamp": ev.record_timestamp,
        }


@router.post("/{contract_id}/resolve")
async def resolve(contract_id: int, body: Resolve, persona: str | None = Depends(persona_header)):
    require_persona(persona, "arbitrator")
    with SessionLocal() as s:
        c = _get(s, contract_id)
        _expect(c, "HELD")
        if c.arbitrator_id != persona_row(s, "arbitrator").id:
            raise ApiError(403, "WRONG_PERSONA", "only this contract's arbitrator can resolve it")
        escrow_id, amount = c.escrow_id, to_hbar(c.amount_tinybars)
    tx = await hedera_client.escrow_resolve(escrow_id, body.release)
    with SessionLocal.begin() as s:
        c = s.get(Contract, contract_id)
        c.status, c.hold_reason = ("RELEASED" if body.release else "REFUNDED"), None
        s.add(ChainTx(contract_id=contract_id, kind="RESOLVE_DISPUTE", tx_hash=tx.tx_hash.lower(), succeeded=True, events=tx.events))
        if body.release:
            pipeline.timeline(s, contract_id, "released", f"Arbitrator released {amount} ℏ to the freelancer", {"tx_hash": tx.tx_hash})
        else:
            pipeline.timeline(s, contract_id, "refunded", f"Arbitrator refunded {amount} ℏ to the client", {"tx_hash": tx.tx_hash})
        s.flush()
        return contract_out(s, c)


@router.post("/{contract_id}/dispute")
def dispute(contract_id: int, body: Dispute, persona: str | None = Depends(persona_header)):
    require_persona(persona, "client", "freelancer")
    with SessionLocal.begin() as s:
        c = _get(s, contract_id)
        _expect(c, "RELEASED")
        c.disputed, c.dispute_reason = True, body.reason[:1000]
        pipeline.timeline(s, contract_id, "disputed", f"Disputed by the {persona}")
        s.flush()
        return contract_out(s, c)


@router.post("/{contract_id}/retry", status_code=202)
async def retry(contract_id: int):  # async: pipeline.start() needs the running event loop
    pipeline.retry(contract_id)
    return JSONResponse(status_code=202, content={"contract_id": contract_id, "status": "resuming"})
