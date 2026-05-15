from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlmodel import Session, func, select

from app.database import get_session
from app.models import WardrobeItem, WardrobeItemImage
from app.services.storage import storage_service

router = APIRouter(prefix="/api/wardrobe", tags=["wardrobe"])

VALID_CATEGORIES = {"top", "bottom", "outerwear", "dress", "bag", "shoes"}
MAX_IMAGES_PER_ITEM = 8


def _item_to_dict(item: WardrobeItem) -> dict:
    return {
        "id": item.id,
        "name": item.name,
        "category": item.category,
        "notes": item.notes,
        "size": item.size,
        "created_at": item.created_at.isoformat(),
        "images": [
            {
                "id": img.id,
                "image_id": img.image_id,
                "sort_order": img.sort_order,
            }
            for img in item.images
        ],
    }


def _validate_category(category: str) -> None:
    if category not in VALID_CATEGORIES:
        raise HTTPException(400, f"Invalid category. Must be one of: {sorted(VALID_CATEGORIES)}")


@router.get("")
def list_items(
    category: str | None = None,
    limit: int = 100,
    offset: int = 0,
    session: Session = Depends(get_session),
):
    base = select(WardrobeItem)
    count_base = select(func.count()).select_from(WardrobeItem)
    if category and category in VALID_CATEGORIES:
        base = base.where(WardrobeItem.category == category)
        count_base = count_base.where(WardrobeItem.category == category)

    stmt = base.order_by(WardrobeItem.created_at.desc()).offset(offset).limit(limit)
    items = list(session.exec(stmt).all())
    total = session.exec(count_base).one()

    return {"items": [_item_to_dict(i) for i in items], "total": total}


@router.post("", status_code=201)
async def create_item(
    files: list[UploadFile] = File(..., description="One or more reference images of the same product"),
    name: str = Form(...),
    category: str = Form(...),
    notes: str = Form(""),
    size: str = Form(""),
    session: Session = Depends(get_session),
):
    _validate_category(category)
    if not files:
        raise HTTPException(400, "At least one image is required")
    if len(files) > MAX_IMAGES_PER_ITEM:
        raise HTTPException(400, f"Max {MAX_IMAGES_PER_ITEM} images per item")

    item = WardrobeItem(
        name=name,
        category=category,
        notes=notes or None,
        size=size or None,
    )
    session.add(item)
    session.flush()

    for order, upload in enumerate(files):
        content = await upload.read()
        mime = upload.content_type or "image/png"
        asset = storage_service.save_image(content, mime, "uploaded", session=session)
        session.add(
            WardrobeItemImage(item_id=item.id, image_id=asset.id, sort_order=order)
        )

    session.commit()
    session.refresh(item)
    return _item_to_dict(item)


@router.post("/{item_id}/images", status_code=201)
async def add_item_image(
    item_id: str,
    file: UploadFile = File(...),
    session: Session = Depends(get_session),
):
    item = session.get(WardrobeItem, item_id)
    if not item:
        raise HTTPException(404, "Item not found")
    if len(item.images) >= MAX_IMAGES_PER_ITEM:
        raise HTTPException(400, f"Item already has the maximum of {MAX_IMAGES_PER_ITEM} images")

    next_order = max((img.sort_order for img in item.images), default=-1) + 1
    content = await file.read()
    mime = file.content_type or "image/png"
    asset = storage_service.save_image(content, mime, "uploaded", session=session)
    session.add(
        WardrobeItemImage(item_id=item_id, image_id=asset.id, sort_order=next_order)
    )
    session.commit()
    session.refresh(item)
    return _item_to_dict(item)


@router.delete("/{item_id}/images/{image_record_id}", status_code=204)
def remove_item_image(
    item_id: str,
    image_record_id: str,
    session: Session = Depends(get_session),
):
    record = session.get(WardrobeItemImage, image_record_id)
    if not record or record.item_id != item_id:
        return
    item = session.get(WardrobeItem, item_id)
    if item and len(item.images) <= 1:
        raise HTTPException(400, "Cannot remove the last image — delete the item instead")

    image_id = record.image_id
    session.delete(record)
    session.flush()
    storage_service.delete_asset_if_unreferenced(session, image_id)
    session.commit()


@router.patch("/{item_id}")
def update_item(
    item_id: str,
    data: dict,
    session: Session = Depends(get_session),
):
    item = session.get(WardrobeItem, item_id)
    if not item:
        raise HTTPException(404, "Item not found")

    if "category" in data:
        _validate_category(data["category"])
    for key in ("name", "category", "notes", "size"):
        if key in data:
            setattr(item, key, data[key])

    session.commit()
    session.refresh(item)
    return _item_to_dict(item)


@router.delete("/{item_id}", status_code=204)
def delete_item(item_id: str, session: Session = Depends(get_session)):
    item = session.get(WardrobeItem, item_id)
    if not item:
        return
    image_ids = [img.image_id for img in item.images]
    session.delete(item)
    session.flush()
    for image_id in image_ids:
        storage_service.delete_asset_if_unreferenced(session, image_id)
    session.commit()
