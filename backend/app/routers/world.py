from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlmodel import Session, func, select

from app.database import get_session
from app.models import WorldLocation, WorldLocationImage
from app.services.storage import storage_service

router = APIRouter(prefix="/api/world", tags=["world"])

# A location is a recurring place — typically users will have only a
# handful (home, cafe, street, workplace). The cap is generous and only
# exists to keep a single API call under the OpenAI reference limit.
MAX_IMAGES_PER_LOCATION = 8


def _location_to_dict(loc: WorldLocation) -> dict:
    return {
        "id": loc.id,
        "name": loc.name,
        "notes": loc.notes,
        "created_at": loc.created_at.isoformat(),
        "images": [
            {
                "id": img.id,
                "image_id": img.image_id,
                "sort_order": img.sort_order,
            }
            for img in loc.images
        ],
    }


@router.get("")
def list_locations(
    limit: int = 100,
    offset: int = 0,
    session: Session = Depends(get_session),
):
    stmt = (
        select(WorldLocation)
        .order_by(WorldLocation.created_at.desc())
        .offset(offset)
        .limit(limit)
    )
    items = list(session.exec(stmt).all())
    total = session.exec(select(func.count()).select_from(WorldLocation)).one()
    return {"items": [_location_to_dict(i) for i in items], "total": total}


@router.post("", status_code=201)
async def create_location(
    files: list[UploadFile] = File(..., description="One or more reference images of the same place"),
    name: str = Form(...),
    notes: str = Form(""),
    session: Session = Depends(get_session),
):
    if not files:
        raise HTTPException(400, "At least one image is required")
    if len(files) > MAX_IMAGES_PER_LOCATION:
        raise HTTPException(400, f"Max {MAX_IMAGES_PER_LOCATION} images per location")

    loc = WorldLocation(name=name, notes=notes or None)
    session.add(loc)
    session.flush()

    for order, upload in enumerate(files):
        content = await upload.read()
        mime = upload.content_type or "image/png"
        asset = storage_service.save_image(content, mime, "uploaded", session=session)
        session.add(
            WorldLocationImage(location_id=loc.id, image_id=asset.id, sort_order=order)
        )

    session.commit()
    session.refresh(loc)
    return _location_to_dict(loc)


@router.post("/{location_id}/images", status_code=201)
async def add_location_image(
    location_id: str,
    file: UploadFile = File(...),
    session: Session = Depends(get_session),
):
    loc = session.get(WorldLocation, location_id)
    if not loc:
        raise HTTPException(404, "Location not found")
    if len(loc.images) >= MAX_IMAGES_PER_LOCATION:
        raise HTTPException(
            400, f"Location already has the maximum of {MAX_IMAGES_PER_LOCATION} images"
        )

    next_order = max((img.sort_order for img in loc.images), default=-1) + 1
    content = await file.read()
    mime = file.content_type or "image/png"
    asset = storage_service.save_image(content, mime, "uploaded", session=session)
    session.add(
        WorldLocationImage(
            location_id=location_id, image_id=asset.id, sort_order=next_order
        )
    )
    session.commit()
    session.refresh(loc)
    return _location_to_dict(loc)


@router.delete("/{location_id}/images/{image_record_id}", status_code=204)
def remove_location_image(
    location_id: str,
    image_record_id: str,
    session: Session = Depends(get_session),
):
    record = session.get(WorldLocationImage, image_record_id)
    if not record or record.location_id != location_id:
        return
    loc = session.get(WorldLocation, location_id)
    if loc and len(loc.images) <= 1:
        raise HTTPException(
            400, "Cannot remove the last image — delete the location instead"
        )

    image_id = record.image_id
    session.delete(record)
    session.flush()
    storage_service.delete_asset_if_unreferenced(session, image_id)
    session.commit()


@router.patch("/{location_id}")
def update_location(
    location_id: str,
    data: dict,
    session: Session = Depends(get_session),
):
    loc = session.get(WorldLocation, location_id)
    if not loc:
        raise HTTPException(404, "Location not found")

    for key in ("name", "notes"):
        if key in data:
            setattr(loc, key, data[key])

    session.commit()
    session.refresh(loc)
    return _location_to_dict(loc)


@router.delete("/{location_id}", status_code=204)
def delete_location(location_id: str, session: Session = Depends(get_session)):
    loc = session.get(WorldLocation, location_id)
    if not loc:
        return
    image_ids = [img.image_id for img in loc.images]
    session.delete(loc)
    session.flush()
    for image_id in image_ids:
        storage_service.delete_asset_if_unreferenced(session, image_id)
    session.commit()
