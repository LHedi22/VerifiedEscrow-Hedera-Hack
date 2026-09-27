"""TRD §8.1 fallback 1: criteria are extracted once, at funding, and the deliverable step reuses that extraction.

Drives the real HTTP endpoints (fund, deliverable) against the `vte_test` database. Ollama and hedera-svc are
faked at the module boundary; the pipeline stops after the evaluation step (anchoring is not under test).
"""
import asyncio
import time

import psycopg
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from tests.conftest import DEMO_DB_URL, TEST_DB_URL

CRITERIA_DELAY_S = 3.0  # the fake criteria call is still running when the deliverable arrives at 1 s
SOW = "Write a landing page for Nour Studio. It must include a headline, a pricing section and a contact line."
CRITERIA_JSON = ('{"criteria":[{"id":"C1","description":"Has a headline","required":true},'
                 '{"id":"C2","description":"Has a pricing section","required":true},'
                 '{"id":"C3","description":"Has a contact line","required":true}]}')
EVAL_JSON = ('{"results":[{"id":"C1","met":true,"evidence":"h"},{"id":"C2","met":true,"evidence":"p"},'
             '{"id":"C3","met":true,"evidence":"c"}],"reasoning":"All met.","confidence":0.9,"injection_suspected":false}')


def _libpq(url: str) -> str:
    return url.replace("postgresql+psycopg://", "postgresql://")


@pytest.fixture(scope="module")
def test_db():
    try:
        admin = psycopg.connect(_libpq(DEMO_DB_URL), autocommit=True, connect_timeout=5)
    except psycopg.OperationalError as e:
        pytest.skip(f"Postgres not reachable (docker compose up -d db): {e}")
    with admin:
        if not admin.execute("SELECT 1 FROM pg_database WHERE datname = 'vte_test'").fetchone():
            admin.execute("CREATE DATABASE vte_test")
    from alembic import command
    from alembic.config import Config
    command.upgrade(Config("alembic.ini"), "head")  # env.py reads settings.database_url = vte_test
    from app.db import engine
    with engine.begin() as c:
        c.execute(text("TRUNCATE timeline_events, chain_txs, hcs_anchors, evaluations, deliverables, contracts, personas "
                       "RESTART IDENTITY CASCADE"))
        c.execute(text("INSERT INTO personas (role, display_name, account_id, evm_address) VALUES "
                       "('client','Amira','0.0.1','0x" + "1" * 40 + "'),"
                       "('freelancer','Youssef','0.0.2','0x" + "2" * 40 + "'),"
                       "('arbitrator','Nour','0.0.3','0x" + "3" * 40 + "')"))
    assert TEST_DB_URL.endswith("/vte_test")
    yield


def test_deliverable_one_second_after_funding_reuses_the_running_extraction(test_db, monkeypatch):
    from app.main import app
    from app.routers import personas
    from app.services import evaluator, hedera_client, pipeline

    calls = {"criteria": 0, "evaluation": 0}

    async def fake_chat(system, user, schema, max_tokens):
        if schema is evaluator.CRITERIA_SCHEMA:
            calls["criteria"] += 1
            await asyncio.sleep(CRITERIA_DELAY_S)
            return CRITERIA_JSON
        calls["evaluation"] += 1
        return EVAL_JSON

    async def fake_escrow_create(amount, fr, ar, sow_hash):
        return hedera_client.ChainTx(tx_hash="0x" + "ab" * 32, events=[]), 424242

    async def fake_model_version():
        return "ollama/qwen2.5:7b-instruct@000000000000"

    async def noop(*_a, **_k):
        return None

    async def stop_at_anchoring(contract_id):
        raise pipeline.StepError("test stops before anchoring")

    class TagsOk:  # the deliverable endpoint's Ollama health probe
        def __init__(self, *a, **k): ...
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def get(self, url):
            import httpx
            return httpx.Response(200, request=httpx.Request("GET", url), json={"models": []})

    monkeypatch.setattr(evaluator, "_chat", fake_chat)
    monkeypatch.setattr(evaluator, "model_version", fake_model_version)
    monkeypatch.setattr(evaluator, "warm_up", noop)
    monkeypatch.setattr(personas, "sync_personas", noop)
    monkeypatch.setattr(hedera_client, "escrow_create", fake_escrow_create)
    monkeypatch.setattr(pipeline, "_anchor", stop_at_anchoring)
    import app.routers.contracts as contracts_router
    monkeypatch.setattr(contracts_router.httpx, "AsyncClient", TagsOk)

    with TestClient(app) as client:
        r = client.post("/contracts", headers={"X-Persona": "client"},
                        json={"title": "Criteria once", "sow": SOW, "amount_hbar": "5"})
        assert r.status_code == 201, r.text
        cid = r.json()["id"]
        assert r.json()["criteria_ready"] is False

        t0 = time.monotonic()
        r = client.post(f"/contracts/{cid}/fund", headers={"X-Persona": "client"})
        fund_s = time.monotonic() - t0
        assert r.status_code == 200, r.text
        assert fund_s < 1.0, f"funding waited for criteria ({fund_s:.2f} s)"
        assert r.json()["criteria_ready"] is False

        time.sleep(1.0)  # deliverable arrives while the funding-time extraction is still running
        assert calls["criteria"] == 1
        r = client.post(f"/contracts/{cid}/deliverable", headers={"X-Persona": "freelancer"},
                        json={"content": "# Nour Studio\nHeadline. Pricing: 5 per month. Contact: hi@nour.example"})
        assert r.status_code == 202, r.text

        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            body = client.get(f"/contracts/{cid}").json()
            if body["status"] == "ERROR":  # stop_at_anchoring: the evaluation step finished
                break
            time.sleep(0.2)
        assert body["status"] == "ERROR" and body["error"]["step"] == "ANCHORING", body
        assert body["criteria_ready"] is True

    print(f"\nfund returned in {fund_s * 1000:.0f} ms; Ollama calls: {calls}")
    assert calls == {"criteria": 1, "evaluation": 1}
