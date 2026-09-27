"""Point every test at a throwaway `vte_test` database (same Postgres container), never the demo DB.

Must run before `app.config` is imported: `settings` and the engine are built at import time, and an
environment variable beats api/.env in pydantic-settings.
"""
import os
import re
from pathlib import Path

if "DATABASE_URL" in os.environ:
    DEMO_DB_URL = os.environ["DATABASE_URL"]
else:
    _env = (Path(__file__).resolve().parent.parent / ".env").read_text(encoding="utf-8")
    DEMO_DB_URL = re.search(r"^DATABASE_URL=(.+)$", _env, re.M).group(1).strip()
TEST_DB_URL = re.sub(r"/[^/]+$", "/vte_test", DEMO_DB_URL)
os.environ["DATABASE_URL"] = TEST_DB_URL
