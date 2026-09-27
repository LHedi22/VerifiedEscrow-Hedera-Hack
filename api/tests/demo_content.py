"""Parse the SOW/deliverable pairs straight out of docs/06-DEMO-CONTENT.md, so tests use
exactly the demo text. Texts are normalized as at ingestion (TRD §5.2)."""
import re
from dataclasses import dataclass
from pathlib import Path

from app.services.canonical import normalize

DOC = Path(__file__).resolve().parents[2] / "docs" / "06-DEMO-CONTENT.md"


@dataclass(frozen=True)
class Case:
    id: str
    title: str
    expected: str  # "pass" | "fail"
    injection: bool
    sow: str
    deliverable: str


def _sections(text: str) -> list[tuple[str, list[str]]]:
    """Split on '## '/'### ' headings, ignoring lines inside ``` fences (deliverables contain headings)."""
    sections: list[tuple[str, list[str]]] = []
    in_fence = False
    for line in text.splitlines():
        if line.startswith("```"):
            in_fence = not in_fence
        if not in_fence and line.startswith(("## ", "### ")):
            sections.append((line, []))
        elif sections:
            sections[-1][1].append(line)
    return sections


def load_cases() -> dict[str, Case]:
    cases: dict[str, Case] = {}
    for heading, lines in _sections(DOC.read_text(encoding="utf-8")):
        m = re.match(r"### ((?:S|E)\d)\b", heading)
        exp = re.search(r"expected \*\*(PASS|FAIL)", heading)
        blocks = re.findall(r"(?s)```[a-z]*\n(.*?)\n```", "\n".join(lines))
        if not (m and exp and len(blocks) >= 2):
            continue
        cid = m.group(1)
        title = re.search(r'"([^"]+)"', heading)
        cases[cid] = Case(
            id=cid,
            title=title.group(1) if title else cid,
            expected=exp.group(1).lower(),
            injection="injection" in heading.lower(),
            sow=normalize(blocks[0]),
            deliverable=normalize(blocks[1]),
        )
    return cases
