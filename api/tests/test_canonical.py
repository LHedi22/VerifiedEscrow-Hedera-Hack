import json
import re
from pathlib import Path

import pytest

from app.services.canonical import (
    KEYS,
    InvalidText,
    canonical_bytes,
    normalize,
    record_hash,
    record_timestamp,
)

FIXTURES = Path(__file__).resolve().parents[2] / "packages" / "canonical" / "fixtures"
CASES = sorted(p.stem for p in FIXTURES.glob("*.json"))


def test_six_fixtures_present():
    assert len(CASES) == 6


@pytest.mark.parametrize("name", CASES)
def test_fixture_bytes_and_hash(name):
    rec = json.loads((FIXTURES / f"{name}.json").read_text(encoding="utf-8"))
    expected_bytes = (FIXTURES / f"{name}.canonical").read_bytes()
    expected_hash = (FIXTURES / f"{name}.sha256").read_text(encoding="utf-8").strip()
    assert canonical_bytes(rec) == expected_bytes
    assert record_hash(rec) == expected_hash


def test_canonical_shape():
    rec = {k: "x" for k in KEYS}
    out = canonical_bytes(rec).decode("utf-8")
    assert out.startswith('{"contract_id":"x","deliverable":"x"')
    assert " " not in out and not out.endswith("\n")


def test_non_ascii_emitted_raw():
    rec = {k: "x" for k in KEYS} | {"sow": "caf\u00e9 \u0627"}
    assert "caf\u00e9 \u0627".encode("utf-8") in canonical_bytes(rec)


def test_rejects_bad_records():
    rec = {k: "x" for k in KEYS}
    with pytest.raises(AssertionError):
        canonical_bytes({**rec, "extra": "x"})
    with pytest.raises(AssertionError):
        canonical_bytes({**rec, "verdict": True})


def test_normalize_rules():
    assert normalize("a\r\nb\rc  \t\n") == "a\nb\nc"
    assert normalize("e\u0301") == "\u00e9"
    assert normalize("x\u00a0") == "x\u00a0"  # NBSP is not in the strip set
    assert normalize("x\x1c") == "x\x1c"  # bare rstrip() would remove this
    assert normalize("x\x85") == "x\x85"  # and this


def test_normalize_rejects_nul():
    with pytest.raises(InvalidText):
        normalize("a\x00b")


def test_normalize_rejects_lone_surrogate():
    with pytest.raises(InvalidText):
        normalize("a\ud800b")


def test_record_timestamp_format():
    assert re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z", record_timestamp())
