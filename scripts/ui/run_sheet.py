"""T3.8 / rehearsals: the App Flow §9 demo run sheet, driven click by click and timed per step.

W1 = browser context with the Client persona cookie, W2 = Freelancer (they stand in for the two Chrome
profiles), W3 = `\\i /demo/tamper.sql` inside the db container. Screenshots go to docs/progress/day3/.

  python scripts/ui/run_sheet.py              # headless
  set HEADED=1 & python scripts/ui/run_sheet.py

Precondition: demo/reset run (S1-S3 seeded, S2 HELD), stack on the production build, Ollama warm.
"""
import json
import os
import subprocess
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "docs" / "progress" / "day3"
BASE = "http://localhost:3000"
SHEET = {1: 30, 2: 30, 3: 15, 4: 45, 5: 15, 6: 30, 7: 20, 8: 10, 9: 30}  # run-sheet column, seconds
S2_TITLE = "Product FAQ for Olive & Co"

rows: list[dict] = []
t_start = time.monotonic()


class Step:
    def __init__(self, n: int, what: str):
        self.n, self.what = n, what

    def __enter__(self):
        self.t = time.monotonic()
        print(f"step {self.n}: {self.what} …", flush=True)
        return self

    def __exit__(self, exc_type, exc, tb):
        dt = time.monotonic() - self.t
        rows.append({"step": self.n, "what": self.what, "actual_s": round(dt, 1), "sheet_s": SHEET[self.n], "ok": exc is None})
        print(f"step {self.n}: {'OK' if exc is None else 'FAILED'} in {dt:.1f} s (sheet {SHEET[self.n]} s)", flush=True)
        return False


def balance(pg) -> float:
    pg.wait_for_function("!document.querySelector('[data-testid=persona-balance]').textContent.includes('loading')")
    return float(pg.inner_text("[data-testid=persona-balance]").split()[0].replace(",", ""))


def open_hashscan(ctx, pg, selector: str) -> str:
    """Click a HashScan link; wait until HashScan has rendered the page; close the tab."""
    with ctx.expect_page() as info:
        pg.click(selector)
    tab = info.value
    tab.wait_for_load_state("domcontentloaded", timeout=60000)
    tab.wait_for_timeout(2500)
    url = tab.url
    tab.close()
    return url


with sync_playwright() as p:
    b = p.chromium.launch(channel="chrome", headless=os.environ.get("HEADED") != "1")
    ctxs = {}
    for role in ("client", "freelancer"):
        ctxs[role] = b.new_context(viewport={"width": 1440, "height": 1000})
        ctxs[role].add_cookies([{"name": "vte_persona", "value": role, "url": BASE}])
        # T3.7: record every toast (App Flow §7) that appears in this persona's pages.
        ctxs[role].add_init_script("""
          window.__toasts = [];
          new MutationObserver(() => document.querySelectorAll('[data-testid=toast]').forEach(t => {
            if (!t.dataset.seen) { t.dataset.seen = 1; window.__toasts.push(t.innerText.replace(/\s+/g, ' ').replace(/ ×$/, '')); }
          })).observe(document, { childList: true, subtree: true });
        """)
    w1, w2 = ctxs["client"].new_page(), ctxs["freelancer"].new_page()
    w1.goto(BASE + "/"); w2.goto(BASE + "/")
    w1.wait_for_selector("[data-testid=contracts-table]"); w2.wait_for_selector("[data-testid=contracts-table]")
    client_before, freelancer_before = balance(w1), balance(w2)
    print(f"balances before: client {client_before} ℏ, freelancer {freelancer_before} ℏ")

    with Step(1, "W1 Dashboard → + New contract → Use example SOW → Create draft"):
        w1.click("a.btn.primary:has-text('+ New contract')")
        w1.click("[data-testid=use-example]")
        w1.click("[data-testid=create-draft]")
        w1.wait_for_selector("[data-testid=fund]", timeout=30000)
        cid = int(w1.url.rstrip("/").split("/")[-1])
        assert w1.get_attribute("[data-testid=stepper]", "data-status") == "DRAFT"

    with Step(2, "W1 Fund escrow → confirm; balance drops; funding tx on HashScan"):
        w1.click("[data-testid=fund]")
        w1.click("[data-testid=modal-confirm]")
        w1.wait_for_selector("[data-testid=stepper][data-status=FUNDED]", timeout=120000)
        w1.wait_for_function(f"parseFloat(document.querySelector('[data-testid=persona-balance]').textContent) < {client_before - 4}", timeout=60000)
        client_after_fund = balance(w1)
        w1.wait_for_selector("[data-testid=tx-CREATE_ESCROW] a.pill", timeout=60000)  # linked once the mirror has it
        funding_url = open_hashscan(ctxs["client"], w1, "[data-testid=tx-CREATE_ESCROW] a.pill")
        print(f"   balance {client_before} → {client_after_fund} ℏ; HashScan {funding_url}")

    with Step(3, "W2 open contract → Insert sample → good → Submit"):
        w2.goto(f"{BASE}/contracts/{cid}")
        w2.click("[data-testid=insert-sample]")
        w2.click("[data-testid=sample-good]")
        w2.click("[data-testid=submit]")
        w2.click("[data-testid=modal-confirm]")
        w2.wait_for_selector("[data-testid=stepper][data-status=EVALUATING]", timeout=30000)
        submitted = time.monotonic()
        print("   criteria sub-step:", w2.inner_text("[data-testid=criteria-substep]"))

    with Step(4, "W2 narrate while the stepper runs; click 'Anchored · msgs #N–M' → HashScan"):
        statuses = []
        while True:
            st = w2.get_attribute("[data-testid=stepper]", "data-status")
            if not statuses or statuses[-1][0] != st:
                statuses.append((st, round(time.monotonic() - submitted, 1)))
            if st in ("EVALUATING", "ANCHORING", "CONFIRMING"):  # FR-11: no verdict before mirror confirmation
                assert w2.query_selector("[data-testid=evaluation]") is None, f"verdict visible during {st}"
            if w2.query_selector("[data-testid=anchored-link]"):
                break
            if time.monotonic() - submitted > 300:
                raise TimeoutError("not anchored after 300 s")
            time.sleep(0.25)
        anchored_url = open_hashscan(ctxs["freelancer"], w2, "[data-testid=anchored-link]")
        print(f"   HashScan {anchored_url}")

    with Step(5, "W2 stepper reaches Paid; green PASS card; freelancer balance +5 ℏ"):
        w2.wait_for_selector("[data-testid=verdict-card][data-card=released]", timeout=300000)
        statuses.append(("RELEASED", round(time.monotonic() - submitted, 1)))
        w2.wait_for_function(f"parseFloat(document.querySelector('[data-testid=persona-balance]').textContent) > {freelancer_before + 4}", timeout=60000)
        freelancer_after = balance(w2)
        w2.wait_for_selector("[data-testid=evaluation]")
        w2.screenshot(path=str(OUT / "t3.8-contract-pass.png"), full_page=True)
        stepper = w2.inner_text("[data-testid=stepper]").replace("\n", " ")
        print(f"   freelancer {freelancer_before} → {freelancer_after} ℏ; statuses {statuses}\n   {stepper}")

    with Step(6, "W1 open seeded S2 → Verify this record → green MATCH"):
        w1.goto(BASE + "/")
        w1.click(f"tbody tr:has-text('{S2_TITLE}') >> nth=0")
        w1.wait_for_selector("[data-testid=verdict-card][data-card=held]")
        s2_url = w1.url
        w1.click("[data-testid=verify-link]")
        w1.wait_for_selector("[data-result]", timeout=30000)
        assert w1.get_attribute("[data-result]", "data-result") == "MATCH", w1.inner_text("[data-result]")
        w1.wait_for_function("document.querySelector('[data-testid=chain-status]')?.textContent !== 'reading…'", timeout=15000)
        verify_url = w1.url
        w1.screenshot(path=str(OUT / "t3.8-s2-verify-match.png"), full_page=True)

    with Step(7, "W3 \\i /demo/tamper.sql"):
        r = subprocess.run(["docker", "compose", "exec", "-T", "db", "psql", "-U", "vte", "-d", "vte"],
                           input="\\i /demo/tamper.sql\n", cwd=ROOT, capture_output=True, text=True, encoding="utf-8")
        print("   " + r.stdout.strip().replace("\n", "\n   "))
        assert r.returncode == 0 and r.stdout.count("UPDATE 1") == 2, r.stderr

    with Step(8, "W1 refresh the contract detail → now claims PASS"):
        w1.goto(s2_url)
        w1.wait_for_selector("[data-testid=verdict-card][data-card=released]", timeout=15000)
        w1.wait_for_selector("[data-testid=eval-verdict]")
        print("   card:", w1.inner_text("[data-testid=verdict-card]").split("\n")[0], "| evaluation:", w1.inner_text("[data-testid=eval-verdict]"),
              "| on-chain:", w1.inner_text("[data-testid=onchain-status]"))
        w1.screenshot(path=str(OUT / "t3.8-s2-tampered-detail.png"), full_page=True)

    with Step(9, "W1 refresh /verify → red TAMPERING DETECTED; diff; anchored panel still FAIL"):
        w1.goto(verify_url)
        w1.wait_for_selector("[data-result]", timeout=30000)
        assert w1.get_attribute("[data-result]", "data-result") == "MISMATCH"
        changed = [e.get_attribute("data-field") for e in w1.query_selector_all("tr[data-changed=true]")]
        anchored = w1.inner_text("[data-testid=anchored-verdict]")
        assert "verdict" in changed and anchored == "Verdict FAIL", (changed, anchored)
        w1.wait_for_function("document.querySelector('[data-testid=chain-status]')?.textContent !== 'reading…'", timeout=15000)
        print(f"   changed {changed}; anchored panel '{anchored}'; on-chain {w1.inner_text('[data-testid=chain-status]')}")
        w1.screenshot(path=str(OUT / "t3.8-verify-red.png"), full_page=True)
        w1.locator("[data-testid=field-diff]").screenshot(path=str(OUT / "t3.8-field-diff.png"))

    toasts = {"W1": w1.evaluate("window.__toasts"), "W2": w2.evaluate("window.__toasts")}
    b.close()

print("toasts seen on the current page of each window (earlier pages reload and lose theirs):", json.dumps(toasts, ensure_ascii=False))
total = sum(r["actual_s"] for r in rows)
print("\n| # | Step | Sheet | Actual |\n| --- | --- | --- | --- |")
for r in rows:
    print(f"| {r['step']} | {r['what']} | {r['sheet_s']} s | {r['actual_s']} s |")
print(f"| | **Total (steps 1–9)** | {sum(SHEET.values())} s | {total:.1f} s |")
print(json.dumps({"contract_id": cid, "rows": rows, "total_s": round(total, 1), "wall_s": round(time.monotonic() - t_start, 1)}))
