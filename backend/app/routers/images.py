from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, RedirectResponse

from app.services.storage import storage_service

router = APIRouter(prefix="/api/images", tags=["images"])


def _safe_filename(name: str, fallback: str) -> str:
    """Strip characters that would break a Content-Disposition header.
    Falls back to a safe default if the result is empty."""
    cleaned = (
        name.replace('"', "")
        .replace("\n", "")
        .replace("\r", "")
        .replace("/", "_")
        .replace("\\", "_")
        .strip()
    )
    return cleaned or fallback


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


@router.get("/{image_id}/download")
def download_image(image_id: str, filename: str | None = None):
    """Force a real file download. Browsers ignore the <a download> attribute
    on cross-origin URLs (our S3 public URLs), so the only reliable way is to
    serve the file with Content-Disposition: attachment.

    S3 mode: redirect to a presigned URL that carries ResponseContentDisposition.
    Local mode: FileResponse(filename=...) sets the attachment header itself.
    """
    safe_name = _safe_filename(filename or f"{image_id}.png", f"{image_id}.png")
    try:
        download_url = storage_service.get_image_download_url(image_id, safe_name)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Image not found")

    if download_url:
        return RedirectResponse(download_url, status_code=302)

    try:
        path = storage_service.get_image_path(image_id)
        mime = storage_service.get_mime_type(image_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Image not found")

    if path is None or not path.exists():
        raise HTTPException(status_code=404, detail="Image file missing from disk")

    return FileResponse(path, media_type=mime, filename=safe_name)
