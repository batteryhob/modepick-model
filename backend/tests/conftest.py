"""Pytest setup — must run BEFORE app modules are imported.

Settings + DB engine are module-level singletons, so the env vars they
read have to be in place before the first `from app.* import ...`. This
file is loaded by pytest before any test module collection.

We force a throwaway sqlite file (not :memory:, because separate
connections wouldn't share the schema) and clear S3 / IG / API-key
env vars so tests never touch real services even if the dev's `.env`
file would otherwise supply them.
"""
from __future__ import annotations

import os
import tempfile
from pathlib import Path

_TEST_DIR = Path(tempfile.mkdtemp(prefix="modepick-test-"))
_TEST_DB_PATH = _TEST_DIR / "test.db"
_TEST_STORAGE_DIR = _TEST_DIR / "images"
_TEST_STORAGE_DIR.mkdir(parents=True, exist_ok=True)

# Force (not setdefault) so a developer's local .env can't leak real
# creds or point us at the real DB.
os.environ["DATABASE_URL"] = f"sqlite:///{_TEST_DB_PATH}"
os.environ["STORAGE_DIR"] = str(_TEST_STORAGE_DIR)
os.environ["S3_BUCKET_NAME"] = ""
os.environ["S3_ACCESS_KEY"] = ""
os.environ["S3_SECRET_KEY"] = ""
os.environ["OPENAI_API_KEY"] = "test-stub"
os.environ["GEMINI_API_KEY"] = ""
os.environ["INSTAGRAM_APP_ID"] = ""
os.environ["INSTAGRAM_APP_SECRET"] = ""
