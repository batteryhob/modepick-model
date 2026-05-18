from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, RedirectResponse

from app.services.storage import storage_service

router = APIRouter(prefix="/api/images", tags=["images"])


@router.get("/{image_id}")
def serve_image(image_id: str):
    """In S3 mode the browser is redirected to a short-lived presigned URL
    so it fetches the bytes directly from the bucket; the backend never
    streams the bytes. In local mode the bytes are served as a FileResponse
    with a long cache header."""
    try:
        presigned = storage_service.get_image_presigned_url(image_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Image not found")

    if presigned:
        return RedirectResponse(presigned, status_code=302)

    try:
        path = storage_service.get_image_path(image_id)
        mime = storage_service.get_mime_type(image_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Image not found")

    if path is None or not path.exists():
        raise HTTPException(status_code=404, detail="Image file missing from disk")

    return FileResponse(
        path,
        media_type=mime,
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )
