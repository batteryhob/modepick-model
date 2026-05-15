from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, func, select

from app.database import get_session
from app.models import FeedPost
from app.services.storage import storage_service

router = APIRouter(prefix="/api/feed", tags=["feed"])


class FeedPostCreate(BaseModel):
    character_id: str
    image_id: str
    slots: dict = {}
    scene: str = ""


def _post_to_dict(p: FeedPost) -> dict:
    return {
        "id": p.id,
        "character_id": p.character_id,
        "image_id": p.image_id,
        "slots": p.slots,
        "scene": p.scene,
        "created_at": p.created_at.isoformat(),
    }


@router.get("")
def list_posts(
    limit: int = 27,
    offset: int = 0,
    session: Session = Depends(get_session),
):
    stmt = (
        select(FeedPost)
        .order_by(FeedPost.created_at.desc())
        .offset(offset)
        .limit(limit)
    )
    posts = list(session.exec(stmt).all())
    total = session.exec(select(func.count()).select_from(FeedPost)).one()
    return {"posts": [_post_to_dict(p) for p in posts], "total": total}


@router.post("", status_code=201)
def create_post(req: FeedPostCreate, session: Session = Depends(get_session)):
    post = FeedPost(
        character_id=req.character_id,
        image_id=req.image_id,
        slots=req.slots,
        scene=req.scene,
    )
    session.add(post)
    session.commit()
    session.refresh(post)
    return _post_to_dict(post)


@router.delete("/{post_id}", status_code=204)
def delete_post(post_id: str, session: Session = Depends(get_session)):
    post = session.get(FeedPost, post_id)
    if not post:
        return
    image_id = post.image_id
    session.delete(post)
    session.flush()
    storage_service.delete_asset_if_unreferenced(session, image_id)
    session.commit()
