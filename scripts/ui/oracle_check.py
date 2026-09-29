"""T5.1 / T4.3 check: /verify/<escrowId> result, "Escrow contract / HCS / App" row, the 4 oracle checks, topic scan.

  python scripts/ui/oracle_check.py 15 16 17            # S1 S2 S3 as seeded
  python scripts/ui/oracle_check.py 16 --shot NAME      # also screenshot docs/progress/day4/NAME.png
"""
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

OUT = Path(__file__).resolve().parents[2] / "docs" / "progress" / "day4"
args = sys.argv[1:]
shot = args[args.index("--shot") + 1] if "--shot" in args else None
ids = [a for a in args if a.isdigit()]

with sync_playwright() as p:
    b = p.chromium.launch(channel="chrome")
    for esc in ids:
        pg = b.new_context(viewport={"width": 1440, "height": 1100}).new_page()
        pg.goto(f"http://localhost:3000/verify/{esc}")
        pg.wait_for_selector("[data-result]", timeout=60000)
        pg.wait_for_function("document.querySelector('[data-testid=scan-count]')?.textContent !== 'scanning…'", timeout=60000)
        pg.wait_for_timeout(500)
        row = pg.query_selector("[data-testid=consistency-row]")
        checks = [li.inner_text().replace("\n", " ") for li in pg.query_selector_all("[data-testid=oracle-checks] li")]
        print(f"escrow #{esc}: {pg.get_attribute('[data-result]', 'data-result')}")
        print(f"   row: {row.inner_text().replace(chr(10), ' ')}  (contract={row.get_attribute('data-contract')} hcs={row.get_attribute('data-hcs')} app={row.get_attribute('data-app')})")
        print(f"   checks: {checks}")
        print(f"   scan: {pg.inner_text('[data-testid=scan-count]')}")
        if pg.query_selector("[data-testid=anchored-verdict]"):
            print(f"   anchored panel: {pg.inner_text('[data-testid=anchored-verdict]')}")
        if shot:
            OUT.mkdir(parents=True, exist_ok=True)
            pg.screenshot(path=str(OUT / f"{shot}.png"), full_page=True)
        pg.context.close()
    b.close()
