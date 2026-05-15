from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlmodel import Session, select

from app.database import get_session
from app.models import MoodReference
from app.services.storage import storage_service

router = APIRouter(prefix="/api/mood", tags=["mood"])


def _mood_to_dict(m: MoodReference) -> dict:
    return {
        "id": m.id,
        "name": m.name,
        "tags": m.tags,
        "image_id": m.image_id,
        "created_at": m.created_at.isoformat(),
    }


@router.get("")
def list_moods(session: Session = Depends(get_session)):
    stmt = select(MoodReference).order_by(MoodReference.created_at.desc())
    moods = list(session.exec(stmt).all())
    return [_mood_to_dict(m) for m in moods]


@router.post("", status_code=201)
async def upload_mood(
    file: UploadFile = File(...),
    name: str = Form(...),
    tags: str = Form(""),
    session: Session = Depends(get_session),
):
    content = await file.read()
    mime = file.content_type or "image/png"

    asset = storage_service.save_image(content, mime, "uploaded", session=session)

    mood = MoodReference(
        name=name,
        tags=tags,
        image_id=asset.id,
    )
    session.add(mood)
    session.commit()
    session.refresh(mood)
    return _mood_to_dict(mood)


@router.delete("/{mood_id}", status_code=204)
def delete_mood(mood_id: str, session: Session = Depends(get_session)):
    mood = session.get(MoodReference, mood_id)
    if not mood:
        return
    image_id = mood.image_id
    session.delete(mood)
    session.flush()
    storage_service.delete_asset_if_unreferenced(session, image_id)
    session.commit()
