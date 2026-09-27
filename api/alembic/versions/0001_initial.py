"""0001_initial: Schema v1.1 §4 DDL, verbatim from 0001_initial.sql.

Revision ID: 0001_initial
Revises:
"""
from pathlib import Path

from alembic import op

revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None

DDL = Path(__file__).with_suffix(".sql").read_text(encoding="utf-8")


def upgrade() -> None:
    # exec_driver_sql: no SQLAlchemy bind-param parsing of the DDL's regexes and ::casts.
    op.get_bind().exec_driver_sql(DDL)


def downgrade() -> None:
    op.get_bind().exec_driver_sql(
        """
        DROP VIEW IF EXISTS v_canonical_record;
        DROP TABLE IF EXISTS timeline_events, chain_txs, hcs_anchors, evaluations, deliverables, contracts, personas CASCADE;
        DROP FUNCTION IF EXISTS touch_updated_at();
        DROP TYPE IF EXISTS tx_kind, hold_reason, contract_status, persona_role;
        """
    )
