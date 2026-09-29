"""T3.7 check: "API unreachable → full-width red bar 'Backend offline' and polling pauses" (App Flow §8).

Aborts every browser request to the api, then lets them through again. No server is stopped.
  python scripts/ui/offline_bar.py
"""
import time

from playwright.sync_api import sync_playwright

API = "http://localhost:8000/"
with sync_playwright() as p:
    b = p.chromium.launch(channel="chrome")
    ctx = b.new_context()
    ctx.add_cookies([{"name": "vte_persona", "value": "client", "url": "http://localhost:3000"}])
    pg = ctx.new_page()
    calls = {"n": 0, "blocked": True}

    def handler(route):
        calls["n"] += 1
        return route.abort() if calls["blocked"] else route.continue_()

    pg.goto("http://localhost:3000/contracts/1")
    pg.wait_for_selector("[data-testid=stepper]")
    print("online, offline bar shown:", bool(pg.query_selector("[data-testid=offline-bar]")))
    pg.route(API + "**", handler)
    pg.wait_for_selector("[data-testid=offline-bar]", timeout=20000)
    print("api blocked → bar:", pg.inner_text("[data-testid=offline-bar]"), "| footer:", pg.get_attribute("[data-testid=health-footer]", "data-state"))
    n0 = calls["n"]; time.sleep(10); n1 = calls["n"]
    print(f"requests to api in 10 s while offline: {n1 - n0} (only the /health probe keeps going)")
    calls["blocked"] = False
    pg.wait_for_selector("[data-testid=offline-bar]", state="detached", timeout=20000)
    print("api back → bar gone; footer:", pg.get_attribute("[data-testid=health-footer]", "data-state"))
    b.close()
