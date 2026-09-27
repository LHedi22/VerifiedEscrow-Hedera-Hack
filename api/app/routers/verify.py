"""GET /verify/{escrow_id} (Schema §5.3): keyed by the ON-CHAIN escrow ID; never returns a hash."""
from fastapi import APIRouter
from sqlalchemy import select, text

from app.config import settings
from app.db import SessionLocal
from app.errors import ApiError
from app.models import Contract, HcsAnchor
from app.services.canonical import KEYS

router = APIRouter(tags=["verify"])


@router.get("/verify/{escrow_id}")
def verify(escrow_id: int):
    with SessionLocal() as s:
        c = s.scalar(select(Contract).where(Contract.escrow_id == escrow_id))
        if c is None:
            raise ApiError(404, "NOT_FOUND", f"no contract with escrow ID {escrow_id}")
        escrow = {"contract_address": settings.deployment.get("contractAddress"), "escrow_id": escrow_id}
        a = s.scalar(select(HcsAnchor).where(HcsAnchor.contract_id == c.id, HcsAnchor.confirmed_at.is_not(None)))
        if a is None:  # FR-11: nothing until the mirror node confirmed the anchored bytes
            return {"db_contract_id": c.id, "status": c.status, "record": None, "anchor": None, "escrow": escrow}
        row = s.execute(text("SELECT * FROM v_canonical_record WHERE db_contract_id = :id"), {"id": c.id}).mappings().first()
        return {
            "db_contract_id": c.id,
            "status": c.status,
            "record": {k: row[k] for k in KEYS} if row else None,
            "anchor": {"topic_id": a.topic_id, "tx_id": a.tx_id, "sequence_first": a.sequence_first,
                       "sequence_last": a.sequence_last, "chunk_count": a.chunk_count},
            "escrow": escrow,
        }
