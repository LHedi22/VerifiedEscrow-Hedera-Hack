"""T3.7 check: each App Flow §7 toast fires. No HBAR is spent: "Draft saved" is real (DB only); Funded and
Resolved use fulfilled POST responses; Held and Error use patched status transitions on a polled contract.
Run demo/reset afterwards (the draft stays in the DB).   python scripts/ui/toasts.py
"""
import json

import httpx
from playwright.sync_api import sync_playwright

BASE, API = "http://localhost:3000", "http://localhost:8000"
S2 = next(c for c in httpx.get(f"{API}/contracts").json()["items"] if c["title"] == "Product FAQ for Olive & Co")


def collect(pg):
    return [t.inner_text().replace("\n", " ").rstrip(" ×") for t in pg.query_selector_all("[data-testid=toast]")]


with sync_playwright() as p:
    b = p.chromium.launch(channel="chrome")
    seen = []

    # Draft saved (real) → then Funded (fulfilled POST /fund)
    ctx = b.new_context(); ctx.add_cookies([{"name": "vte_persona", "value": "client", "url": BASE}])
    pg = ctx.new_page(); pg.goto(f"{BASE}/contracts/new"); pg.click("[data-testid=use-example]"); pg.click("[data-testid=create-draft]")
    pg.wait_for_selector("[data-testid=fund]"); seen += collect(pg)
    cid = int(pg.url.rstrip("/").split("/")[-1])
    draft = httpx.get(f"{API}/contracts/{cid}").json()
    funded = {**draft, "status": "FUNDED", "escrow_id": 999, "txs": [{"kind": "CREATE_ESCROW", "tx_hash": "0x" + "ab" * 32, "succeeded": True, "created_at": draft["created_at"]}]}
    pg.route(f"{API}/contracts/{cid}/fund", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps(funded)))
    pg.click("[data-testid=fund]"); pg.click("[data-testid=modal-confirm]"); pg.wait_for_timeout(1000); seen += collect(pg)
    ctx.close()

    # Resolved (fulfilled POST /resolve on S2)
    ctx = b.new_context(); ctx.add_cookies([{"name": "vte_persona", "value": "arbitrator", "url": BASE}])
    pg = ctx.new_page(); pg.goto(f"{BASE}/contracts/{S2['id']}"); pg.wait_for_selector("[data-testid=refund]")
    s2 = httpx.get(f"{API}/contracts/{S2['id']}").json()
    refunded = {**s2, "status": "REFUNDED", "hold_reason": None, "txs": s2["txs"] + [{"kind": "RESOLVE_DISPUTE", "tx_hash": "0x" + "cd" * 32, "succeeded": True, "created_at": s2["created_at"]}]}
    pg.route(f"{API}/contracts/{S2['id']}/resolve", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps(refunded)))
    pg.click("[data-testid=refund]"); pg.click("[data-testid=modal-confirm]"); pg.wait_for_timeout(1000); seen += collect(pg)
    ctx.close()

    # Held, then Error: the polled contract changes status under the page
    for status, extra in [("HELD", {"hold_reason": "FAILED_VERDICT"}), ("ERROR", {"error": {"step": "CONFIRMING", "message": "no hash match after 120 s"}})]:
        ctx = b.new_context(); ctx.add_cookies([{"name": "vte_persona", "value": "freelancer", "url": BASE}])
        pg = ctx.new_page()

        def make(status, extra):
            state = {"n": 0}

            def h(route):
                r = route.fetch(); d = r.json(); state["n"] += 1
                d.update({"status": "SUBMITTING_VERDICT", "hold_reason": None} if state["n"] == 1 else {"status": status, **extra})
                route.fulfill(response=r, body=json.dumps(d))
            return h
        pg.route(f"{API}/contracts/{S2['id']}", make(status, extra))
        pg.goto(f"{BASE}/contracts/{S2['id']}"); pg.wait_for_timeout(7000); seen += collect(pg)
        ctx.close()
    b.close()

print("toasts:"); [print("  -", t) for t in seen]
print(f"draft contract {cid} left in DB: run demo/reset")
