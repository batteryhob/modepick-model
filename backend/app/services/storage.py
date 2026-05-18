import io
import logging
import time
from pathlib import Path
from uuid import uuid4

from PIL import Image
from sqlmodel import Session, select

from app.config import settings
from app.database import engine
from app.models import (
    Character,
    CharacterReference,
    FeedPost,
    ImageAsset,
    MoodReference,
    WardrobeItemImage,
    WorldLocationImage,
)


logger = logging.getLogger(__name__)

# Files newer than this aren't candidates for orphan cleanup, in case an upload
# is mid-flight when startup sweeps run.
ORPHAN_GRACE_SECONDS = 300


MIME_TO_EXT = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
}


class StorageService:
    def __init__(self, base_dir: Path | None = None):
        self.base_dir = base_dir or settings.storage_path

    def save_image(
        self,
        file_bytes: bytes,
        mime_type: str,
        source: str,
        session: Session | None = None,
    ) -> ImageAsset:
        """Save image to disk and DB.

        If `session` is provided, the new ImageAsset row is added to it and
        flushed (but not committed) — the caller owns the transaction. Use this
        when the surrounding request also writes related rows (e.g. wardrobe
        item images) so everything happens in one transaction and SQLite
        doesn't deadlock against itself.

        If `session` is None, a short-lived session is opened and committed
        immediately — useful for background tasks like image generation that
        don't have an enclosing request session.
        """
        ext = MIME_TO_EXT.get(mime_type, ".png")
        file_id = str(uuid4())
        filename = f"{file_id}{ext}"
        file_path = self.base_dir / filename

        file_path.write_bytes(file_bytes)

        img = Image.open(io.BytesIO(file_bytes))
        width, height = img.size

        asset = ImageAsset(
            id=file_id,
            storage_path=filename,
            width=width,
            height=height,
            mime_type=mime_type,
            file_size=len(file_bytes),
            source=source,
        )

        if session is not None:
            session.add(asset)
            session.flush()
            return asset

        with Session(engine) as own_session:
            own_session.add(asset)
            own_session.commit()
            own_session.refresh(asset)

        return asset

    def load_image_bytes(self, image_id: str) -> bytes:
        with Session(engine) as session:
            asset = session.get(ImageAsset, image_id)
            if not asset:
                raise FileNotFoundError(f"ImageAsset {image_id} not found")
            return self._resolve_storage_path(asset.storage_path).read_bytes()

    def get_image_path(self, image_id: str) -> Path:
        with Session(engine) as session:
            asset = session.get(ImageAsset, image_id)
            if not asset:
                raise FileNotFoundError(f"ImageAsset {image_id} not found")
            return self._resolve_storage_path(asset.storage_path)

    def get_mime_type(self, image_id: str) -> str:
        with Session(engine) as session:
            asset = session.get(ImageAsset, image_id)
            if not asset:
                raise FileNotFoundError(f"ImageAsset {image_id} not found")
            return asset.mime_type

    def delete_file(self, image_id: str) -> None:
        """Delete only the file from disk."""
        with Session(engine) as session:
            asset = session.get(ImageAsset, image_id)
            if not asset:
                return
            path = self._resolve_storage_path(asset.storage_path)
            if path.exists():
                path.unlink()

    def delete_asset_if_unreferenced(self, session: Session, image_id: str) -> None:
        """Delete an ImageAsset row and file only when no model references it."""
        asset = session.get(ImageAsset, image_id)
        if not asset:
            return

        reference_exists = any(
            session.exec(stmt).first() is not None
            for stmt in (
                select(Character.id).where(Character.base_image_id == image_id),
                select(CharacterReference.id).where(CharacterReference.image_id == image_id),
                select(WardrobeItemImage.id).where(WardrobeItemImage.image_id == image_id),
                select(WorldLocationImage.id).where(WorldLocationImage.image_id == image_id),
                select(MoodReference.id).where(MoodReference.image_id == image_id),
                select(FeedPost.id).where(FeedPost.image_id == image_id),
            )
        )
        if reference_exists:
            return

        path = self._resolve_storage_path(asset.storage_path)
        session.delete(asset)
        session.flush()
        try:
            if path.exists():
                path.unlink()
        except Exception:
            pass

    def _resolve_storage_path(self, storage_path: str) -> Path:
        path = Path(storage_path)
        return path if path.is_absolute() else self.base_dir / path

    def cleanup_orphan_files(self) -> int:
        """Remove disk files that no ImageAsset row points to.

        Skips files modified within ORPHAN_GRACE_SECONDS so an in-flight upload
        that hasn't yet committed its DB row isn't yanked out from under it.
        Returns the count of files removed.
        """
        with Session(engine) as session:
            known_basenames = {
                Path(a.storage_path).name
                for a in session.exec(select(ImageAsset)).all()
            }

        now = time.time()
        removed = 0
        for path in self.base_dir.iterdir():
            if not path.is_file():
                continue
            if path.name in known_basenames:
                continue
            if now - path.stat().st_mtime < ORPHAN_GRACE_SECONDS:
                continue
            try:
                path.unlink()
                removed += 1
            except Exception:
                logger.warning("Failed to remove orphan file %s", path, exc_info=True)
        if removed:
            logger.info("Removed %s orphan image file(s)", removed)
        return removed


storage_service = StorageService()
