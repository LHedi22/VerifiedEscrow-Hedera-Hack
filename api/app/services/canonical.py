import json, hashlib, unicodedata, re
from datetime import datetime, timezone

KEYS = ("contract_id","deliverable","model_version","reasoning","schema","sow","timestamp","verdict")
_TRAILING_WS = re.compile(r"[ \t\n\r\f\v]+\Z")

class InvalidText(ValueError): ...

def normalize(s: str) -> str:
    if "\x00" in s:
        raise InvalidText("NUL character")
    try:
        s.encode("utf-8")
    except UnicodeEncodeError as e:  # lone surrogate
        raise InvalidText("invalid Unicode") from e
    s = s.replace("\r\n", "\n").replace("\r", "\n")
    return _TRAILING_WS.sub("", unicodedata.normalize("NFC", s))

def record_timestamp() -> str:
    now = datetime.now(timezone.utc)
    return now.strftime("%Y-%m-%dT%H:%M:%S.") + f"{now.microsecond // 1000:03d}Z"

def canonical_bytes(rec: dict) -> bytes:
    assert set(rec) == set(KEYS) and all(isinstance(v, str) for v in rec.values())
    return json.dumps(rec, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")

def record_hash(rec: dict) -> str:
    return hashlib.sha256(canonical_bytes(rec)).hexdigest()
