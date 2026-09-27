"""AI evaluator (TRD §8): criteria extraction, evaluation, deterministic aggregation.

The model reports per-criterion facts; code decides the verdict (TRD §8.3).
Failed attempts (§8.4): invalid JSON, schema/ID mismatch, confidence outside [0, 1], or a
reply that hit num_predict (done_reason == "length"). Three failed attempts produce an
EVALUATION_ERROR fail outcome. Ollama unreachable or a 90 s timeout is an infrastructure
error (EvaluatorUnavailable): nothing is produced, the caller moves to ERROR.
"""
from __future__ import annotations

import asyncio
import json
import re
from dataclasses import dataclass, field
from pathlib import Path

import httpx
from pydantic import BaseModel, Field, ValidationError, field_validator

from app.config import settings
from app.services.canonical import InvalidText, normalize

PROMPTS = Path(__file__).resolve().parent.parent / "prompts"
CRITERIA_SYSTEM = (PROMPTS / "criteria_system.txt").read_text(encoding="utf-8")
EVALUATION_SYSTEM = (PROMPTS / "evaluation_system.txt").read_text(encoding="utf-8")

MAX_ATTEMPTS = 3
TIMEOUT_S = 90
# num_predict caps (TRD §8.1): settings.ollama_criteria_num_predict = 512, settings.ollama_eval_num_predict = 1200
REASONING_CAP = 3000
EVALUATION_ERROR_REASONING = (
    "EVALUATION_ERROR: the evaluator returned invalid output 3 times; "
    "no verdict was produced. Held for human review."
)

# TRD §8.3, verbatim
INJECTION = re.compile(r"""(?imx)
  ^[\s>*_#-]*(?:note\s+to\s+(?:the\s+)?)?(?:evaluator|grader|reviewer|assistant|ai|llm)\s*[:,]   # a line addressed to the evaluator
| \bmark\s+(?:this|it|me)\s+(?:as\s+)?(?:a\s+)?pass
| \b(?:ignore|disregard|forget)\s+(?:all\s+|any\s+|the\s+)?(?:previous|prior|above|earlier)\s+instructions
""")

_ollama_lock = asyncio.Semaphore(1)  # one generation at a time (TRD §8.1)


# ---------------------------------------------------------------- schemas (TRD §8.2)
class Criterion(BaseModel):
    id: str
    description: str = Field(min_length=1)
    required: bool


class CriteriaOut(BaseModel):
    criteria: list[Criterion] = Field(min_length=3, max_length=7)

    @field_validator("criteria")
    @classmethod
    def unique_ids(cls, v: list[Criterion]) -> list[Criterion]:
        if len({c.id for c in v}) != len(v):
            raise ValueError("duplicate criterion id")
        return v


class Result(BaseModel):
    id: str
    met: bool
    evidence: str


class EvaluationOut(BaseModel):
    results: list[Result]
    reasoning: str
    confidence: float = Field(ge=0, le=1)
    injection_suspected: bool


# Ollama `format` schemas. Key order matters: Ollama generates properties in schema order.
CRITERIA_SCHEMA = {
    "type": "object",
    "properties": {
        "criteria": {
            "type": "array",
            "minItems": 3,
            "maxItems": 7,
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "description": {"type": "string"},
                    "required": {"type": "boolean"},
                },
                "required": ["id", "description", "required"],
            },
        }
    },
    "required": ["criteria"],
}

EVALUATION_SCHEMA = {
    "type": "object",
    "properties": {
        "results": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "met": {"type": "boolean"},
                    "evidence": {"type": "string"},
                },
                "required": ["id", "met", "evidence"],
            },
        },
        "reasoning": {"type": "string"},
        "confidence": {"type": "number", "minimum": 0, "maximum": 1},
        "injection_suspected": {"type": "boolean"},
    },
    "required": ["results", "reasoning", "confidence", "injection_suspected"],
}


# ---------------------------------------------------------------- outcome
@dataclass
class Outcome:
    criteria: list[dict]
    verdict: str  # "pass" | "fail" (hashed)
    reasoning: str  # normalized, <= 3,000 chars (hashed)
    model_version: str  # (hashed)
    results: list[dict] | None = None
    confidence: float | None = None
    injection_suspected: bool = False
    attempts: int = 0
    raw_output: dict | None = None
    evaluation_error: bool = False  # True -> hold_reason EVALUATION_ERROR
    failures: list[str] = field(default_factory=list)


class EvaluatorUnavailable(RuntimeError):
    """Ollama unreachable or timed out: an infrastructure failure, not an evaluation error."""


class AttemptFailed(ValueError):
    """One failed attempt under TRD §8.4."""


# ---------------------------------------------------------------- Ollama
async def _chat(system: str, user: str, schema: dict, max_tokens: int) -> str:
    body = {
        "model": settings.ollama_model,
        "stream": False,
        "keep_alive": -1,
        "format": schema,
        "options": {"temperature": 0, "seed": 42, "num_ctx": settings.ollama_num_ctx, "num_predict": max_tokens},
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
    }
    async with _ollama_lock:
        try:
            async with httpx.AsyncClient(timeout=TIMEOUT_S) as client:
                r = await client.post(f"{settings.ollama_url}/api/chat", json=body)
                r.raise_for_status()
        except (httpx.TransportError, httpx.HTTPStatusError) as e:
            raise EvaluatorUnavailable(f"Ollama: {e!r}") from e
    data = r.json()
    if data.get("done_reason") == "length":
        raise AttemptFailed(f"reply hit num_predict={max_tokens} (done_reason=length)")
    return data["message"]["content"]


async def model_version() -> str:
    """`ollama/<tag>@<first 12 hex of digest>` from GET /api/tags (TRD §5.1)."""
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(f"{settings.ollama_url}/api/tags")
            r.raise_for_status()
    except (httpx.TransportError, httpx.HTTPStatusError) as e:
        raise EvaluatorUnavailable(f"Ollama: {e!r}") from e
    for m in r.json()["models"]:
        if m["name"] == settings.ollama_model:
            digest = m["digest"].removeprefix("sha256:")
            return f"ollama/{settings.ollama_model}@{digest[:12]}"
    raise EvaluatorUnavailable(f"model {settings.ollama_model} not pulled")


async def warm_up() -> None:
    """Tiny prompt on startup so the first live evaluation isn't a cold load (TRD §8.1)."""
    await _chat("Reply with JSON.", "ok", {"type": "object", "properties": {"ok": {"type": "boolean"}}}, 16)


# ---------------------------------------------------------------- steps
def _escape_deliverable(text: str) -> str:
    return text.replace("<deliverable", "&lt;deliverable").replace("</deliverable", "&lt;/deliverable")


async def extract_criteria(sow: str) -> tuple[list[dict], int, list[str]]:
    """Step 1. Returns (criteria, attempts, failures); criteria == [] after 3 failed attempts."""
    failures: list[str] = []
    for attempt in range(1, MAX_ATTEMPTS + 1):
        try:
            raw = await _chat(CRITERIA_SYSTEM, f"<sow>\n{sow}\n</sow>", CRITERIA_SCHEMA, settings.ollama_criteria_num_predict)
            parsed = CriteriaOut.model_validate_json(raw)
            return [c.model_dump() for c in parsed.criteria], attempt, failures
        except (AttemptFailed, ValidationError, ValueError) as e:
            failures.append(f"criteria attempt {attempt}: {_short(e)}")
    return [], MAX_ATTEMPTS, failures


def _validate_evaluation(raw: str, criteria: list[dict]) -> EvaluationOut:
    out = EvaluationOut.model_validate_json(raw)
    expected = {c["id"] for c in criteria}
    got = [r.id for r in out.results]
    if set(got) != expected or len(got) != len(expected):
        raise AttemptFailed(f"criterion ids {sorted(got)} != {sorted(expected)}")
    return out


def truncate(text: str, limit: int = REASONING_CAP) -> str:
    """Cap at `limit` chars, cutting at a word boundary and ending with an ellipsis (TRD §8.3)."""
    if len(text) <= limit:
        return text
    cut = text[: limit - 1]
    if " " in cut:
        cut = cut[: cut.rindex(" ")]
    return cut.rstrip() + "…"


def aggregate(out: EvaluationOut, criteria: list[dict], deliverable: str) -> tuple[str, bool]:
    """TRD §8.3: the verdict is computed in code from per-criterion facts."""
    required = {c["id"]: c["required"] for c in criteria}
    injection = out.injection_suspected or bool(INJECTION.search(deliverable))
    verdict = "pass" if (all(r.met for r in out.results if required[r.id])
                         and out.confidence >= settings.confidence_threshold
                         and not injection) else "fail"
    return verdict, injection


async def evaluate(sow: str, deliverable: str, criteria: list[dict] | None = None) -> Outcome:
    """Full two-step evaluation. `sow`/`deliverable` are already normalized (stored) strings.
    Pass cached `criteria` (evaluations.criteria) to skip step 1."""
    version = await model_version()
    failures: list[str] = []
    attempts = 0
    if criteria is None:
        criteria, attempts, failures = await extract_criteria(sow)
        if not criteria:
            return _evaluation_error([], version, attempts, None, failures)

    criteria_json = json.dumps(criteria, ensure_ascii=False, separators=(",", ":"))
    user = f"<criteria>{criteria_json}</criteria>\n<deliverable>\n{_escape_deliverable(deliverable)}\n</deliverable>"
    raw_last: dict | None = None
    for attempt in range(1, MAX_ATTEMPTS + 1):
        try:
            raw = await _chat(EVALUATION_SYSTEM, user, EVALUATION_SCHEMA, settings.ollama_eval_num_predict)
            try:
                raw_last = json.loads(raw)
            except json.JSONDecodeError:
                raw_last = {"unparseable": raw[:2000]}
            out = _validate_evaluation(raw, criteria)
            reasoning = truncate(normalize(out.reasoning))
        except (AttemptFailed, ValidationError, InvalidText, ValueError) as e:
            failures.append(f"evaluation attempt {attempt}: {_short(e)}")
            continue
        verdict, injection = aggregate(out, criteria, deliverable)
        return Outcome(
            criteria=criteria,
            verdict=verdict,
            reasoning=reasoning,
            model_version=version,
            results=[r.model_dump() for r in out.results],
            confidence=round(out.confidence, 3),
            injection_suspected=injection,
            attempts=attempt,
            raw_output=raw_last,
            failures=failures,
        )
    return _evaluation_error(criteria, version, MAX_ATTEMPTS, raw_last, failures)


def _evaluation_error(criteria, version, attempts, raw, failures) -> Outcome:
    """Three failed attempts: still a fail record that gets anchored (TRD §8.4)."""
    return Outcome(
        criteria=criteria,
        verdict="fail",
        reasoning=EVALUATION_ERROR_REASONING,
        model_version=version,
        attempts=attempts,
        raw_output=raw,
        evaluation_error=True,
        failures=failures,
    )


def _short(e: Exception) -> str:
    return str(e).splitlines()[0][:200]
