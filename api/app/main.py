import asyncio
import logging
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app.config import settings
from app.db import engine
from app.errors import ApiError, api_error_handler, validation_handler
from app.routers import contracts, personas, verify
from app.services import evaluator, pipeline

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("api")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    log.info("demo topic %s, contract %s", settings.deployment.get("topicId"), settings.deployment.get("contractAddress"))
    try:
        await personas.sync_personas()
    except ApiError as e:
        log.warning("persona sync skipped: %s", e.message)
    resumed = pipeline.resume_all()  # TRD §9: resume EVALUATING/ANCHORING/CONFIRMING/SUBMITTING_VERDICT
    if resumed:
        log.info("resumed pipelines: %s", resumed)
    if settings.ollama_warm_up:
        asyncio.create_task(_warm_up())
    else:
        log.info("evaluator warm-up skipped (OLLAMA_WARM_UP=0)")
    yield


async def _warm_up():
    try:
        await evaluator.warm_up()  # TRD §8.1: first live evaluation isn't a cold load
        log.info("evaluator warm")
    except Exception as e:
        log.warning("warm-up failed: %r", e)


app = FastAPI(title="Verified-Then-Paid Escrow API", lifespan=lifespan)
app.add_exception_handler(ApiError, api_error_handler)
app.add_exception_handler(RequestValidationError, validation_handler)
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:3000"], allow_methods=["*"], allow_headers=["*"])
app.include_router(personas.router)
app.include_router(contracts.router)
app.include_router(verify.router)


@app.get("/health")
async def health():
    """T2.9: ok/down for the 4 dependencies, plus model and deployment (Schema §5.3)."""
    async def check(fn) -> str:
        try:
            await fn()
            return "ok"
        except Exception:
            return "down"

    async def db():
        with engine.connect() as c:
            c.execute(text("SELECT 1"))

    async def get(url: str, headers: dict | None = None):
        async with httpx.AsyncClient(timeout=5) as client:
            r = await client.get(url, headers=headers)
            if r.status_code >= 500:
                raise RuntimeError(r.status_code)

    results = await asyncio.gather(
        check(db),
        check(lambda: get(f"{settings.ollama_url}/api/tags")),
        check(lambda: get(f"{settings.hedera_svc_url}/accounts", {"X-Internal-Token": settings.internal_token})),
        check(lambda: get(f"{settings.mirror_url}/api/v1/network/nodes?limit=1")),
    )
    try:
        model_version = await evaluator.model_version()
    except Exception:
        model_version = None
    dep = settings.deployment
    return {
        "db": results[0], "ollama": results[1], "hedera_svc": results[2], "mirror": results[3],
        "model_version": model_version, "topic_id": dep.get("topicId"), "escrow_contract": dep.get("contractAddress"),
        # OLLAMA_EVAL_NUM_PREDICT set (env or api/.env) = the Day 2 forced evaluation-error mode. Must be false on stage.
        "forced_eval_error": "ollama_eval_num_predict" in settings.model_fields_set,
    }
