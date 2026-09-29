# T3.2 check: open /verify/<escrowId>, print banner/checklist/diff, screenshot.
# Usage: python scripts/ui/verify_page.py <escrowId> <screenshot-name>
import sys
from playwright.sync_api import sync_playwright
OUT = __import__("os").path.join(__import__("os").path.dirname(__file__), "..", "..", "docs", "progress", "day3")
esc, shot = sys.argv[1], sys.argv[2]
with sync_playwright() as p:
    b = p.chromium.launch(channel="chrome")
    pg = b.new_context(viewport={"width": 1440, "height": 1000}).new_page()
    pg.goto(f"http://localhost:3000/verify/{esc}")
    pg.wait_for_selector("[data-result]", timeout=30000)
    pg.wait_for_function("document.querySelector('[data-testid=chain-status]')?.textContent !== 'reading…'", timeout=15000)
    print("result:", pg.get_attribute("[data-result]", "data-result"))
    print("banner:", pg.inner_text("[data-result]").replace("\n", " "))
    print("checklist:\n  " + pg.inner_text("[data-testid=checklist]").replace("\n", "\n  "))
    if pg.query_selector("[data-testid=field-diff]"):
        print("changed fields:", [e.get_attribute("data-field") for e in pg.query_selector_all("tr[data-changed=true]")])
    if pg.query_selector("[data-testid=anchored-verdict]"):
        print("anchored panel:", pg.inner_text("[data-testid=anchored-verdict]"), "|", pg.inner_text("[data-testid=anchored-reasoning]")[:80])
    print("chain:", pg.inner_text("[data-testid=chain-status]"))
    pg.screenshot(path=f"{OUT}/{shot}.png", full_page=True)
    b.close()
