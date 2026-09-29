"""T3.5 check: the full contract flow clicked through the UI, one browser context per persona.

  python scripts/ui/e2e_flow.py S2 weak refund     # create S2 → fund → submit weak → HELD → arbitrator refunds
  python scripts/ui/e2e_flow.py S1 good none       # create S1 → fund → submit good → RELEASED

Needs the stack running (scripts/start-all.ps1) and Ollama. Spends testnet HBAR (5 ℏ + fees).
"""
import json
import os
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "docs" / "progress" / "day3"
BASE = "http://localhost:3000"
SEEDS = {s["id"]: s for s in json.loads((ROOT / "demo" / "seed_content.json").read_text(encoding="utf-8"))["seeds"]}

case, sample, resolution = (sys.argv[1:4] + ["S1", "good", "none"][len(sys.argv) - 1:])[:3]
seed = SEEDS[case]
t0 = time.monotonic()


def log(msg: str) -> None:
    print(f"[{time.monotonic() - t0:6.1f}s] {msg}", flush=True)


def ctx_for(browser, role):
    ctx = browser.new_context(viewport={"width": 1440, "height": 1000})
    ctx.add_cookies([{"name": "vte_persona", "value": role, "url": BASE}])
    return ctx


with sync_playwright() as p:
    b = p.chromium.launch(channel="chrome", headless=os.environ.get("HEADED") != "1")
    client, freelancer, arbitrator = (ctx_for(b, r).new_page() for r in ("client", "freelancer", "arbitrator"))

    # Client: create + fund
    client.goto(f"{BASE}/contracts/new")
    client.wait_for_selector("[data-testid=title]")
    if case == "S1":
        client.click("[data-testid=use-example]")
    else:
        client.fill("[data-testid=title]", seed["title"])
        client.fill("[data-testid=sow]", seed["sow"])
        client.fill("[data-testid=amount]", seed["amount_hbar"])
    client.click("[data-testid=create-draft]")
    client.wait_for_selector("[data-testid=fund]", timeout=30000)
    cid = int(client.url.rstrip("/").split("/")[-1])
    log(f"draft created: contract {cid}")
    client.click("[data-testid=fund]")
    client.click("[data-testid=modal-confirm]")
    client.wait_for_selector("[data-testid=stepper][data-status=FUNDED]", timeout=120000)
    log("funded: " + client.inner_text("[data-testid=tx-CREATE_ESCROW]"))
    funded_at = time.monotonic()

    # Freelancer: insert sample + submit
    freelancer.goto(f"{BASE}/contracts/{cid}")
    freelancer.click("[data-testid=insert-sample]")
    freelancer.click(f"[data-testid=sample-{sample}]")
    freelancer.click("[data-testid=submit]")
    freelancer.click("[data-testid=modal-confirm]")
    freelancer.wait_for_selector("[data-testid=stepper][data-status=EVALUATING]", timeout=30000)
    submitted_at = time.monotonic()
    log(f"submitted {funded_at and submitted_at - funded_at:.1f}s after funding; stepper running")

    seen = set()
    while True:
        st = freelancer.get_attribute("[data-testid=stepper]", "data-status")
        if st not in seen:
            seen.add(st)
            hidden = bool(freelancer.query_selector("[data-testid=evaluation]"))
            log(f"status {st}  (evaluation visible: {hidden})")
            if st == "SUBMITTING_VERDICT":
                freelancer.screenshot(path=str(OUT / f"t3.5-{case}-submitting.png"))
        if st in ("RELEASED", "HELD", "ERROR", "REFUNDED"):
            break
        if time.monotonic() - submitted_at > 300:
            raise SystemExit("timeout waiting for a terminal status")
        time.sleep(0.5)
    log(f"deliverable -> {st}: {time.monotonic() - submitted_at:.1f}s")
    freelancer.wait_for_selector("[data-testid=evaluation]", timeout=20000)
    log("card: " + freelancer.inner_text("[data-testid=verdict-card]").replace("\n", " | "))
    log("stepper: " + freelancer.inner_text("[data-testid=stepper]").replace("\n", " "))
    freelancer.screenshot(path=str(OUT / f"t3.5-{case}-{st.lower()}.png"), full_page=True)

    if st == "HELD" and resolution in ("release", "refund"):
        arbitrator.goto(f"{BASE}/contracts/{cid}")
        arbitrator.click(f"[data-testid={resolution}]")
        log("resolve modal: " + arbitrator.inner_text("[data-testid=modal-resolve] p").replace("\n", " "))
        arbitrator.click("[data-testid=modal-confirm]")
        arbitrator.wait_for_selector("[data-testid=stepper][data-status=%s]" % ("RELEASED" if resolution == "release" else "REFUNDED"), timeout=120000)
        log("resolved: " + arbitrator.inner_text("[data-testid=verdict-card]").replace("\n", " | "))
        arbitrator.screenshot(path=str(OUT / f"t3.5-{case}-{resolution}.png"), full_page=True)

    client.reload()
    client.wait_for_selector("[data-testid=verdict-card]")
    client.wait_for_function("!document.querySelector('[data-testid=persona-balance]').textContent.includes('loading')")
    log("client header after: " + client.inner_text("[data-testid=persona-balance]"))
    print(json.dumps({"contract_id": cid, "final": st, "deliverable_to_terminal_s": round(time.monotonic() - submitted_at, 1)}))
    b.close()
