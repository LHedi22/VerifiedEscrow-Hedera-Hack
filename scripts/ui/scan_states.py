"""T4.3 check: topic-scan duplicate handling on /verify/16, by injecting messages into the scan's mirror response.

  different second record for escrow #16 -> red MULTIPLE_RECORDS, authoritative = the one matching on-chain verdictHash
  identical resubmission                  -> one record ("identical resubmissions merged"), still MATCH
No DB or chain writes.   python scripts/ui/scan_states.py
"""
import base64
import json
from pathlib import Path

import httpx
from playwright.sync_api import sync_playwright

OUT = Path(__file__).resolve().parents[2] / "docs" / "progress" / "day4"
dep = json.loads((Path(__file__).resolve().parents[2] / "shared" / "deployment.json").read_text(encoding="utf-8"))
TOPIC = dep["topicId"]
v = httpx.get("http://localhost:8000/verify/16").json()
fake_rec = dict(v["record"], verdict="pass", reasoning="A second, doctored record anchored later by the operator.")
fake_bytes = json.dumps(fake_rec, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode("utf-8")


def inject(extra_fn):
    def handler(route):
        if "limit=100" not in route.request.url:  # only the topic scan, not the P0 bounded window
            return route.continue_()
        r = route.fetch(); body = r.json()
        body["messages"] = body.get("messages", []) + extra_fn(body["messages"])
        route.fulfill(response=r, body=json.dumps(body))
    return handler


def doctored(_msgs):
    return [{"sequence_number": 9999, "consensus_timestamp": "1790800000.000000001", "topic_id": TOPIC,
             "message": base64.b64encode(fake_bytes).decode(), "chunk_info": None}]


def resubmitted(msgs):  # same bytes as the real S2 record, under another transaction id
    real = [m for m in msgs if m["sequence_number"] in range(v["anchor"]["sequence_first"], v["anchor"]["sequence_last"] + 1)]
    out = []
    for i, m in enumerate(real):
        m2 = json.loads(json.dumps(m))
        m2["sequence_number"] = 9000 + i
        m2["chunk_info"]["initial_transaction_id"]["transaction_valid_start"] = "1790800000.000000002"
        out.append(m2)
    return out


with sync_playwright() as p:
    b = p.chromium.launch(channel="chrome")
    for name, fn in [("different second record", doctored), ("identical resubmission", resubmitted)]:
        pg = b.new_context(viewport={"width": 1440, "height": 1000}).new_page()
        pg.route(f"https://testnet.mirrornode.hedera.com/api/v1/topics/{TOPIC}/messages**", inject(fn))
        pg.goto("http://localhost:3000/verify/16")
        pg.wait_for_selector("[data-result]", timeout=60000)
        pg.wait_for_function("document.querySelector('[data-testid=scan-count]')?.textContent !== 'scanning…'")
        pg.wait_for_timeout(500)
        print(f"{name}: {pg.get_attribute('[data-result]', 'data-result')}")
        print("   banner:", pg.inner_text("[data-result]").replace("\n", " "))
        print("   scan:", pg.inner_text("[data-testid=scan-count]"))
        if fn is doctored:
            pg.screenshot(path=str(OUT / "t4.3-multiple-records.png"))
        pg.context.close()
    b.close()
