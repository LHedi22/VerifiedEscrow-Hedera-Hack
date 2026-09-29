# T3.2 check: every red/grey state of /verify/:escrowId, by intercepting the api/mirror responses.
# Usage (stack running): python scripts/ui/verify_states.py
import json
from playwright.sync_api import sync_playwright
def run(pg, esc, route=None):
    pg.unroute_all() if hasattr(pg, "unroute_all") else None
    if route: route(pg)
    pg.goto(f"http://localhost:3000/verify/{esc}")
    pg.wait_for_selector("[data-result]", timeout=30000)
    return pg.get_attribute("[data-result]", "data-result"), pg.inner_text("[data-result]").replace("\n", " ")[:110]

def patch_api(mut):
    def r(pg):
        def h(route):
            resp = route.fetch(); body = resp.json(); mut(body)
            route.fulfill(response=resp, body=json.dumps(body))
        pg.route("http://localhost:8000/verify/*", h)
    return r

def lie_seq(b):  # point escrow 10 at escrow 9's messages (seq 5-6)
    b["anchor"].update(sequence_first=5, sequence_last=6, tx_id="0.0.10742743@1790537399.692451777")
cases = [
    ("unknown escrow", 999, None),
    ("wrong escrow pointer", 10, patch_api(lie_seq)),
    ("unexpected topic", 10, patch_api(lambda b: b["anchor"].update(topic_id="0.0.10746404"))),
    ("unexpected contract", 10, patch_api(lambda b: b["escrow"].update(contract_address="0x" + "1" * 40))),
    ("mirror unreachable", 10, lambda pg: pg.route("https://testnet.mirrornode.hedera.com/api/v1/topics/**", lambda r: r.abort())),
    ("chunk missing", 10, patch_api(lambda b: b["anchor"].update(sequence_last=b["anchor"]["sequence_first"]))),
    ("not anchored yet", 10, patch_api(lambda b: b.update(record=None, anchor=None, status="ANCHORING"))),
]
with sync_playwright() as p:
    br = p.chromium.launch(channel="chrome")
    for name, esc, route in cases:
        pg = br.new_context().new_page()
        print(f"{name:22s}", *run(pg, esc, route), sep=" | ")
        pg.context.close()
    br.close()
