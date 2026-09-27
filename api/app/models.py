"""ORM mapping of Schema v1.1 §4. The DDL (alembic/versions/0001_initial.sql) owns the schema;
these classes only map onto it, so enums use create_type=False and CHECKs live in the DDL."""
from datetime import datetime
from decimal import Decimal

from sqlalchemy import BigInteger, Boolean, CHAR, ForeignKey, Integer, Numeric, SmallInteger, Text, text
from sqlalchemy.dialects.postgresql import ENUM, JSONB, TIMESTAMP
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

PersonaRole = ENUM("client", "freelancer", "arbitrator", name="persona_role", create_type=False)
ContractStatus = ENUM(
    "DRAFT", "FUNDED", "EVALUATING", "ANCHORING", "CONFIRMING",
    "SUBMITTING_VERDICT", "RELEASED", "HELD", "REFUNDED", "ERROR",
    name="contract_status", create_type=False,
)
HoldReason = ENUM("FAILED_VERDICT", "EVALUATION_ERROR", name="hold_reason", create_type=False)
TxKind = ENUM("CREATE_ESCROW", "SUBMIT_VERDICT", "RESOLVE_DISPUTE", name="tx_kind", create_type=False)

TSTZ = TIMESTAMP(timezone=True)
NOW = text("now()")


class Base(DeclarativeBase):
    pass


class Persona(Base):
    __tablename__ = "personas"
    id: Mapped[int] = mapped_column(SmallInteger, primary_key=True)
    role: Mapped[str] = mapped_column(PersonaRole, unique=True)
    display_name: Mapped[str] = mapped_column(Text)
    account_id: Mapped[str] = mapped_column(Text, unique=True)
    evm_address: Mapped[str] = mapped_column(Text, unique=True)  # lowercase only


class Contract(Base):
    __tablename__ = "contracts"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    title: Mapped[str] = mapped_column(Text)
    sow: Mapped[str] = mapped_column(Text)
    sow_hash: Mapped[str] = mapped_column(CHAR(64))
    amount_tinybars: Mapped[int] = mapped_column(BigInteger)
    client_id: Mapped[int] = mapped_column(SmallInteger, ForeignKey("personas.id"))
    freelancer_id: Mapped[int] = mapped_column(SmallInteger, ForeignKey("personas.id"))
    arbitrator_id: Mapped[int] = mapped_column(SmallInteger, ForeignKey("personas.id"))
    status: Mapped[str] = mapped_column(ContractStatus, server_default="DRAFT")
    hold_reason: Mapped[str | None] = mapped_column(HoldReason)
    escrow_id: Mapped[int | None] = mapped_column(BigInteger, unique=True)
    disputed: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))
    dispute_reason: Mapped[str | None] = mapped_column(Text)
    error_step: Mapped[str | None] = mapped_column(ContractStatus)
    error_message: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(TSTZ, server_default=NOW)
    updated_at: Mapped[datetime] = mapped_column(TSTZ, server_default=NOW)


class Deliverable(Base):
    __tablename__ = "deliverables"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    contract_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("contracts.id", ondelete="CASCADE"), unique=True)
    content: Mapped[str] = mapped_column(Text)
    submitted_at: Mapped[datetime] = mapped_column(TSTZ, server_default=NOW)


class Evaluation(Base):
    __tablename__ = "evaluations"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    contract_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("contracts.id", ondelete="CASCADE"), unique=True)
    criteria: Mapped[list] = mapped_column(JSONB)
    results: Mapped[list | None] = mapped_column(JSONB)
    confidence: Mapped[Decimal | None] = mapped_column(Numeric(4, 3))
    injection_suspected: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))
    # hashed fields (exact strings)
    verdict: Mapped[str | None] = mapped_column(Text)
    reasoning: Mapped[str | None] = mapped_column(Text)
    model_version: Mapped[str | None] = mapped_column(Text)
    record_timestamp: Mapped[str | None] = mapped_column(Text)
    # bookkeeping
    record_hash: Mapped[str | None] = mapped_column(CHAR(64))
    record_bytes: Mapped[int | None] = mapped_column(Integer)
    attempts: Mapped[int] = mapped_column(SmallInteger, server_default=text("0"))
    raw_output: Mapped[dict | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(TSTZ, server_default=NOW)
    updated_at: Mapped[datetime] = mapped_column(TSTZ, server_default=NOW)


class HcsAnchor(Base):
    __tablename__ = "hcs_anchors"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    contract_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("contracts.id", ondelete="CASCADE"), unique=True)
    topic_id: Mapped[str] = mapped_column(Text)
    tx_id: Mapped[str] = mapped_column(Text)
    sequence_first: Mapped[int] = mapped_column(BigInteger)
    sequence_last: Mapped[int] = mapped_column(BigInteger)
    chunk_count: Mapped[int] = mapped_column(SmallInteger)
    consensus_timestamp: Mapped[str | None] = mapped_column(Text)
    confirmed_at: Mapped[datetime | None] = mapped_column(TSTZ)  # the visibility gate (FR-11)
    created_at: Mapped[datetime] = mapped_column(TSTZ, server_default=NOW)


class ChainTx(Base):
    __tablename__ = "chain_txs"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    contract_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("contracts.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(TxKind)
    tx_hash: Mapped[str] = mapped_column(Text)
    succeeded: Mapped[bool] = mapped_column(Boolean)
    events: Mapped[list | None] = mapped_column(JSONB)
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(TSTZ, server_default=NOW)


class TimelineEvent(Base):
    __tablename__ = "timeline_events"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    contract_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("contracts.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(Text)
    message: Mapped[str] = mapped_column(Text)  # never contains the verdict before confirmation (FR-11)
    ref: Mapped[dict | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(TSTZ, server_default=NOW)
