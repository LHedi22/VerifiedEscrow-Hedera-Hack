"""GET /personas (Schema §5.3) and the startup persona sync (Schema §8.1, seed step 1)."""
import logging

from fastapi import APIRouter
from sqlalchemy import select

from app.db import SessionLocal
from app.models import Persona
from app.schemas import ROLES, persona_out
from app.services import hedera_client

router = APIRouter(tags=["personas"])
log = logging.getLogger("personas")

DISPLAY_NAMES = {"client": "Amira", "freelancer": "Youssef", "arbitrator": "Nour"}  # Schema §8.1


async def sync_personas() -> None:
    """Insert the three personas from hedera-svc GET /accounts if the table is empty (same as seed step 1).
    Existing rows are left alone: demo/reset restores them from the snapshot."""
    with SessionLocal() as s:
        if s.scalar(select(Persona.id).limit(1)):
            return
    accounts = await hedera_client.accounts()
    with SessionLocal.begin() as s:
        for role in ROLES:
            a = accounts[role]
            s.add(Persona(role=role, display_name=DISPLAY_NAMES[role], account_id=a.account_id, evm_address=a.evm_address.lower()))
    log.info("personas seeded from hedera-svc /accounts")


@router.get("/personas")
async def personas():
    accounts = await hedera_client.accounts()
    with SessionLocal() as s:
        rows = s.scalars(select(Persona).order_by(Persona.id)).all()
        return [persona_out(p) | {"balance_hbar": accounts[p.role].balance_hbar if p.role in accounts else None} for p in rows]
