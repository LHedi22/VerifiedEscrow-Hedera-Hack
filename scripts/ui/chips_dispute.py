"""T4.4 + T4.5 checks. Run demo/reset afterwards (the dispute flag is written to the DB).

T4.4: S3 (contract 3) shows the injection chip; a replayed contract shows the replay chip (pass its DB id);
      Insert sample → good / weak fills the editor (contract 1 shown as FUNDED to the freelancer by patching the
      GET response in the browser: no chain spend).
T4.5: the client flags RELEASED S1 (contract 1) as disputed → Disputed chip, timeline entry, banner → Verify.

  python scripts/ui/chips_dispute.py [replayed-contract-id]
"""
import json
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "docs" / "progress" / "day4"
SEEDS = {s["id"]: s for s in json.loads((ROOT / "demo" / "seed_content.json").read_text(encoding="utf-8"))["seeds"]}
BASE, API = "http://localhost:3000", "http://localhost:8000"
replayed = sys.argv[1] if len(sys.argv) > 1 else None


def page(b, role):
    ctx = b.new_context(viewport={"width": 1440, "height": 1000})
    ctx.add_cookies([{"name": "vte_persona", "value": role, "url": BASE}])
    return ctx.new_page()


with sync_playwright() as p:
    b = p.chromium.launch(channel="chrome")

    pg = page(b, "client"); pg.goto(f"{BASE}/contracts/3"); pg.wait_for_selector("[data-testid=evaluation]")
    print("T4.4 S3 injection chip:", pg.inner_text("[data-testid=injection-chip]"))
    pg.screenshot(path=str(OUT / "t4.4-s3-injection-chip.png")); pg.context.close()

    if replayed:
        pg = page(b, "client"); pg.goto(f"{BASE}/contracts/{replayed}"); pg.wait_for_selector("[data-testid=evaluation]")
        print("T4.4 replay chip:", [c.inner_text() for c in pg.query_selector_all("[data-testid=evaluation] .chip") if "Replayed" in c.inner_text()])
        pg.context.close()

    pg = page(b, "freelancer")
    def as_funded(route):
        r = route.fetch(); d = r.json()
        d.update(status="FUNDED", deliverable=None, anchor=None, txs=[t for t in d["txs"] if t["kind"] == "CREATE_ESCROW"])
        route.fulfill(response=r, body=json.dumps(d))
    pg.route(f"{API}/contracts/1", as_funded)
    pg.goto(f"{BASE}/contracts/1"); pg.wait_for_selector("[data-testid=insert-sample]")
    for kind, seed in (("good", "S1"), ("weak", "S2")):
        pg.click("[data-testid=insert-sample]"); pg.click(f"[data-testid=sample-{kind}]")
        val = pg.input_value("[data-testid=deliverable]")
        print(f"T4.4 Insert sample → {kind}: {len(val)} chars, equals {seed} deliverable: {val == SEEDS[seed]['deliverable']}")
    pg.context.close()

    pg = page(b, "client"); pg.goto(f"{BASE}/contracts/1"); pg.wait_for_selector("[data-testid=flag-dispute]")
    pg.click("[data-testid=flag-dispute]")
    pg.fill("[data-testid=dispute-reason]", "The verdict shown doesn't match what I was told")
    pg.click("[data-testid=modal-confirm]")
    pg.wait_for_selector("[data-testid=dispute-banner]", timeout=15000)
    pg.wait_for_timeout(800)
    head = pg.inner_text(".page-head")
    tl = [li.inner_text().replace("\n", " ") for li in pg.query_selector_all("[data-testid=timeline] li.disputed")]
    print("T4.5 header chip Disputed:", "Disputed" in head)
    print("T4.5 banner:", pg.inner_text("[data-testid=dispute-banner]"), "→", pg.get_attribute("[data-testid=dispute-verify]", "href"))
    print("T4.5 timeline:", tl)
    print("T4.5 flag link gone:", pg.query_selector("[data-testid=flag-dispute]") is None)
    pg.screenshot(path=str(OUT / "t4.5-dispute.png"), full_page=True); pg.context.close()
    b.close()
