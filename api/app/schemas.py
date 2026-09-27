"""Request models and the shared `Contract` response object (Schema §5.2)."""
from __future__ import annotations

import re
from decimal import Decimal

from fastapi import Header
from pydantic import BaseModel, field_validator
from sqlalchemy import select

from app.errors import ApiError
from app.models import ChainTx, Contract, Deliverable, Evaluation, HcsAnchor, Persona, TimelineEvent

AMOUNT_RE = re.compile(r"^\d+(\.\d{1,8})?$")
ROLES = ("client", "freelancer", "arbitrator")


# ------------------------------------------------------------------ requests
class CreateContract(BaseModel):
    title: str
    sow: str
    amount_hbar: str
    freelancer_role: str = "freelancer"
    arbitrator_role: str = "arbitrator"

    @field_validator("amount_hbar")
    @classmethod
    def amount(cls, v: str) -> str:
        if not AMOUNT_RE.match(v) or not (Decimal(0) < Decimal(v) <= Decimal(100)):
            raise ValueError("amount_hbar must be a decimal string > 0 and <= 100, up to 8 decimals")
        return v


class SubmitDeliverable(BaseModel):
    content: str


class Resolve(BaseModel):
    release: bool


class Dispute(BaseModel):
    reason: str


def to_tinybars(amount_hbar: str) -> int:
    return int(Decimal(amount_hbar) * 100_000_000)


def to_hbar(tinybars: int) -> str:
    whole, frac = divmod(tinybars, 100_000_000)
    return f"{whole}.{frac:08d}".rstrip("0").rstrip(".")


# ------------------------------------------------------------------ persona (demo-grade, TRD §10.1)
def persona_header(x_persona: str | None = Header(default=None)) -> str | None:
    if x_persona is not None and x_persona not in ROLES:
        raise ApiError(400, "BAD_REQUEST", f"X-Persona must be one of {ROLES}")
    return x_persona


def require_persona(persona: str | None, *allowed: str) -> str:
    if persona not in allowed:
        raise ApiError(403, "WRONG_PERSONA", f"this action needs X-Persona: {' or '.join(allowed)}")
    return persona


def persona_row(s, role: str) -> Persona:
    p = s.scalar(select(Persona).where(Persona.role == role))
    if p is None:
        raise ApiError(503, "HEDERA_SVC_OFFLINE", f"persona {role} not seeded yet (api syncs them from hedera-svc at startup)")
    return p


# ------------------------------------------------------------------ responses
def persona_out(p: Persona) -> dict:
    return {"role": p.role, "display_name": p.display_name, "account_id": p.account_id, "evm_address": p.evm_address}


def iso(dt) -> str | None:
    return dt.isoformat().replace("+00:00", "Z") if dt else None


def contract_out(s, c: Contract) -> dict:
    """Schema §5.2. The verdict is never part of this object; it comes from /evaluation behind the gate."""
    people = {p.id: p for p in s.scalars(select(Persona))}
    d = s.scalar(select(Deliverable).where(Deliverable.contract_id == c.id))
    a = s.scalar(select(HcsAnchor).where(HcsAnchor.contract_id == c.id))
    txs = s.scalars(select(ChainTx).where(ChainTx.contract_id == c.id).order_by(ChainTx.created_at)).all()
    events = s.scalars(select(TimelineEvent).where(TimelineEvent.contract_id == c.id).order_by(TimelineEvent.created_at, TimelineEvent.id)).all()
    return {
        "id": c.id,
        "title": c.title,
        "sow": c.sow,
        "sow_hash": c.sow_hash,
        "amount_hbar": to_hbar(c.amount_tinybars),
        "amount_tinybars": c.amount_tinybars,
        "client": persona_out(people[c.client_id]),
        "freelancer": persona_out(people[c.freelancer_id]),
        "arbitrator": persona_out(people[c.arbitrator_id]),
        "status": c.status,
        "hold_reason": c.hold_reason,
        "escrow_id": c.escrow_id,
        "disputed": c.disputed,
        # Criteria cached (funding-time extraction done): lets the stepper show "Reading the SOW…" until then.
        "criteria_ready": bool(s.scalar(select(Evaluation.criteria).where(Evaluation.contract_id == c.id))),
        "error": {"step": c.error_step, "message": c.error_message} if c.status == "ERROR" else None,
        "deliverable": {"content": d.content, "submitted_at": iso(d.submitted_at)} if d else None,
        "anchor": None if a is None else {
            "topic_id": a.topic_id, "tx_id": a.tx_id, "sequence_first": a.sequence_first,
            "sequence_last": a.sequence_last, "chunk_count": a.chunk_count,
            "consensus_timestamp": a.consensus_timestamp, "confirmed": a.confirmed_at is not None,
        },
        "txs": [{"kind": t.kind, "tx_hash": t.tx_hash, "succeeded": t.succeeded, "created_at": iso(t.created_at)} for t in txs],
        "timeline": [{"kind": e.kind, "message": e.message, "ref": e.ref, "created_at": iso(e.created_at)} for e in events],
        "created_at": iso(c.created_at),
        "updated_at": iso(c.updated_at),
    }


def summary_out(s, c: Contract) -> dict:
    people = {p.id: p for p in s.scalars(select(Persona))}
    return {
        "id": c.id, "title": c.title,
        "client": persona_out(people[c.client_id]), "freelancer": persona_out(people[c.freelancer_id]),
        "arbitrator": persona_out(people[c.arbitrator_id]),
        "amount_hbar": to_hbar(c.amount_tinybars), "amount_tinybars": c.amount_tinybars,
        "status": c.status, "hold_reason": c.hold_reason, "disputed": c.disputed, "escrow_id": c.escrow_id,
        "updated_at": iso(c.updated_at),
    }
