"""Generate the 6 cross-implementation hash fixtures (TRD 5.4) with the Python reference.

Writes packages/canonical/fixtures/NN-name.{json,canonical,sha256}. The .json is
ASCII-only (json.dumps default escaping) so no editor or Git setting can alter it;
.canonical holds the exact bytes (no trailing newline); .sha256 the hex digest.

Run from the repo root:  api/.venv/Scripts/python scripts/gen_fixtures.py
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "api"))
from app.services.canonical import canonical_bytes, record_hash  # noqa: E402

OUT = ROOT / "packages" / "canonical" / "fixtures"

BASE = {
    "contract_id": "1",
    "model_version": "ollama/qwen2.5:7b-instruct@845dbda0ea48",
    "schema": "vte-record/1",
    "timestamp": "2026-09-27T10:00:00.000Z",
    "verdict": "pass",
}

ALL_CONTROLS = "".join(chr(c) for c in range(0x01, 0x20)) + "\x7f\u2028\u2029"

CASES = {
    "01-ascii": {
        "sow": "Write a 3-section README for a CLI tool.\nInclude install, usage and license.",
        "deliverable": "# tool\n\n## Install\n\npip install tool\n\n## Usage\n\ntool run\n\n## License\n\nMIT",
        "reasoning": "All three required sections are present.",
    },
    "02-french": {
        "sow": "R\u00e9digez une page d'accueil pour un caf\u00e9 \u00e0 Tunis.",
        "deliverable": "Bienvenue au caf\u00e9 \u00ab\u00a0Jasmin\u00a0\u00bb\u00a0: cr\u00e8me br\u00fbl\u00e9e, th\u00e9 \u00e0 la menthe, na\u00efvet\u00e9 et \u0153uvre d'art.",
        "reasoning": "Le texte r\u00e9pond \u00e0 la demande ; ton chaleureux.",
        "verdict": "fail",
    },
    "03-arabic": {
        "sow": "\u0627\u0643\u062a\u0628 \u0635\u0641\u062d\u0629 \u062a\u0639\u0631\u064a\u0641\u064a\u0629 \u0644\u0645\u0642\u0647\u0649 \u0641\u064a \u062a\u0648\u0646\u0633.",
        "deliverable": "\u0645\u0631\u062d\u0628\u064b\u0627 \u0628\u0643\u0645 \u0641\u064a \u0645\u0642\u0647\u0649 \u0627\u0644\u064a\u0627\u0633\u0645\u064a\u0646 \u2014 \u0642\u0647\u0648\u0629 \u0648\u0634\u0627\u064a \u0628\u0627\u0644\u0646\u0639\u0646\u0627\u0639 (\u0661\u0662\u0663).",
        "reasoning": "Mixed direction: \u0627\u0644\u0646\u0635 \u0633\u0644\u064a\u0645 and ASCII 123.",
    },
    "04-emoji": {
        "sow": "Launch post with emoji \U0001F680",
        "deliverable": "Team: \U0001F9D1\u200D\U0001F4BB\U0001F469\U0001F3FD\u200D\U0001F52C \U0001F468\u200D\U0001F469\u200D\U0001F467\u200D\U0001F466 flags \U0001F1F9\U0001F1F3 keycap 1\uFE0F\u20E3 max \U0010FFFF",
        "reasoning": "Emoji ZWJ sequences, skin tone, flag and keycap preserved.",
    },
    "05-quotes-backslash-tab": {
        "sow": 'Quote "exactly" and keep C:\\path\\to\\file',
        "deliverable": 'He said "hi" \\ then \'bye\'\n\tindented\tline\n\\n is not a newline, \\u0041 is not A',
        "reasoning": 'Backslash \\ quote " apostrophe \' tab\t newline\n end',
    },
    "06-control-chars": {
        "sow": "controls:" + ALL_CONTROLS,
        "deliverable": "a" + ALL_CONTROLS + "z",
        "reasoning": "every 0x01-0x1F, DEL, U+2028, U+2029: " + ALL_CONTROLS,
        "verdict": "fail",
    },
}


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for name, fields in CASES.items():
        rec = {**BASE, **fields}
        (OUT / f"{name}.json").write_text(json.dumps(rec, indent=2, sort_keys=True) + "\n", encoding="utf-8", newline="\n")
        (OUT / f"{name}.canonical").write_bytes(canonical_bytes(rec))
        (OUT / f"{name}.sha256").write_text(record_hash(rec), encoding="utf-8", newline="\n")
        print(f"{name}: {record_hash(rec)}  ({len(canonical_bytes(rec))} bytes)")


if __name__ == "__main__":
    main()
