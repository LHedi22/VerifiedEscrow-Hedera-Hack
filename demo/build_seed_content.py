"""Write demo/seed_content.json = the S1-S3 texts of docs/06-DEMO-CONTENT.md, exactly (Schema §8.2).

Re-run after editing 06-DEMO-CONTENT.md:  api\.venv\Scripts\python demo\build_seed_content.py
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / "api"), str(ROOT)]
from api.tests.demo_content import load_cases  # noqa: E402

END_STATE = {"S1": ("RELEASED", None), "S2": ("HELD", "FAILED_VERDICT"), "S3": ("HELD", "FAILED_VERDICT")}

cases = load_cases()
seeds = [
    {"id": cid, "title": c.title, "sow": c.sow, "deliverable": c.deliverable, "amount_hbar": "5",
     "expected_status": END_STATE[cid][0], "expected_hold_reason": END_STATE[cid][1],
     "expected_verdict": c.expected, "expected_injection": c.injection}
    for cid, c in sorted(cases.items()) if cid in END_STATE
]
assert [s["id"] for s in seeds] == ["S1", "S2", "S3"], seeds
out = ROOT / "demo" / "seed_content.json"
out.write_bytes((json.dumps({"source": "docs/06-DEMO-CONTENT.md", "seeds": seeds}, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))
print(f"wrote {out} ({len(seeds)} seeds)")
