from pathlib import Path

from fastapi import APIRouter, Depends
from sqlmodel import Session, text

from app.config import settings
from app.database import get_session

router = APIRouter(prefix="/api", tags=["system"])


@router.get("/health")
def health_check(session: Session = Depends(get_session)):
    db_ok = True
    try:
        session.exec(text("SELECT 1"))
    except Exception:
        db_ok = False

    storage_ok = settings.storage_path.exists()

    return {
        "status": "ok" if (db_ok and storage_ok) else "degraded",
        "db": "ok" if db_ok else "error",
        "storage": "ok" if storage_ok else "error",
    }
