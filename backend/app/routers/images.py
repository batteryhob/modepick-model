from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from app.services.storage import storage_service

router = APIRouter(prefix="/api/images", tags=["images"])


@router.get("/{image_id}")
def serve_image(image_id: str):
    try:
        path = storage_service.get_image_path(image_id)
        mime = storage_service.get_mime_type(image_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Image not found")

    if not path.exists():
        raise HTTPException(status_code=404, detail="Image file missing from disk")

    return FileResponse(
        path,
        media_type=mime,
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )
