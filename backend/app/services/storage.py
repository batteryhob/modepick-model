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
    """Two backends, one interface.

    When `settings.s3_enabled` is True, all reads/writes/deletes/listing go
    through an S3-compatible bucket (AWS S3, Lightsail Object Storage, or
    any other S3-compatible service). `storage_path` on each ImageAsset row
    stores the S3 object key.

    Otherwise the local-disk backend is used: files live under
    `settings.storage_dir` and `storage_path` is just the relative filename.

    The switch is global per-process and decided at boot. Mixing modes is
    not supported in a single run — migrate first (or wipe and restart).
    """

    def __init__(self, base_dir: Path | None = None):
        self.base_dir = base_dir or settings.storage_path
        self.use_s3 = settings.s3_enabled
        self.bucket = settings.s3_bucket_name
        # Namespace everything under a single root folder in the bucket so
        # the bucket can host other data without collision. Strip any
        # leading/trailing slashes for safety.
        self.key_prefix = settings.s3_key_prefix.strip("/")
        self._s3 = None
        if self.use_s3:
            self._s3 = self._make_s3_client()
            logger.info(
                "StorageService using S3 bucket %r prefix %r",
                self.bucket,
                self.key_prefix or "(root)",
            )
        else:
            logger.info("StorageService using local disk %s", self.base_dir)

    def _build_key(self, *parts: str) -> str:
        """Compose an S3 key under the configured root prefix."""
        cleaned = [p.strip("/") for p in parts if p]
        if self.key_prefix:
            cleaned = [self.key_prefix, *cleaned]
        return "/".join(cleaned)

    @property
    def _images_prefix(self) -> str:
        """The list-prefix for the `images/` namespace (with trailing slash)."""
        return self._build_key("images") + "/"

    # ------------------------------------------------------------------ S3

    def _make_s3_client(self):
        import boto3

        kwargs: dict = {
            "aws_access_key_id": settings.s3_access_key,
            "aws_secret_access_key": settings.s3_secret_key,
            "region_name": settings.s3_bucket_region,
        }
        if settings.s3_endpoint_url:
            kwargs["endpoint_url"] = settings.s3_endpoint_url
        return boto3.client("s3", **kwargs)

    def _s3_put(self, key: str, body: bytes, content_type: str) -> None:
        assert self._s3 is not None
        params: dict = {
            "Bucket": self.bucket,
            "Key": key,
            "Body": body,
            "ContentType": content_type,
        }
        if settings.s3_public_read:
            # Each object is individually marked public-read so the direct
            # URL works without bucket-wide public-access policy. The
            # bucket must still allow ACLs (Block Public Access OFF +
            # Object Ownership permitting ACLs).
            params["ACL"] = "public-read"
        self._s3.put_object(**params)

    def _s3_get_bytes(self, key: str) -> bytes:
        assert self._s3 is not None
        resp = self._s3.get_object(Bucket=self.bucket, Key=key)
        return resp["Body"].read()

    def _s3_delete(self, key: str) -> None:
        assert self._s3 is not None
        try:
            self._s3.delete_object(Bucket=self.bucket, Key=key)
        except Exception:
            logger.warning("Failed to delete S3 object %s", key, exc_info=True)

    def _s3_presigned_url(self, key: str) -> str:
        assert self._s3 is not None
        return self._s3.generate_presigned_url(
            "get_object",
            Params={"Bucket": self.bucket, "Key": key},
            ExpiresIn=settings.s3_presigned_expires_seconds,
        )

    def _s3_public_url(self, key: str) -> str:
        """Stable, permanent virtual-hosted URL. Only resolvable if the
        object has public-read ACL (or the bucket is broadly public)."""
        region = settings.s3_bucket_region
        # AWS treats us-east-1 specially; safest virtual-hosted form
        # includes the region in the host for all other regions.
        host = f"{self.bucket}.s3.{region}.amazonaws.com"
        return f"https://{host}/{key}"

    # -------------------------------------------------------------- writes

    def save_image(
        self,
        file_bytes: bytes,
        mime_type: str,
        source: str,
        session: Session | None = None,
    ) -> ImageAsset:
        """Persist image bytes and create the matching ImageAsset row.

        If `session` is given, the row is added + flushed (but not committed)
        on that session — caller owns the transaction. Otherwise a short-
        lived session is opened and committed immediately.
        """
        ext = MIME_TO_EXT.get(mime_type, ".png")
        file_id = str(uuid4())
        filename = f"{file_id}{ext}"

        img = Image.open(io.BytesIO(file_bytes))
        width, height = img.size

        if self.use_s3:
            key = self._build_key("images", filename)
            self._s3_put(key, file_bytes, mime_type)
            storage_path = key
        else:
            file_path = self.base_dir / filename
            file_path.write_bytes(file_bytes)
            storage_path = filename

        asset = ImageAsset(
            id=file_id,
            storage_path=storage_path,
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

    # --------------------------------------------------------------- reads

    def load_image_bytes(self, image_id: str) -> bytes:
        with Session(engine) as session:
            asset = session.get(ImageAsset, image_id)
            if not asset:
                raise FileNotFoundError(f"ImageAsset {image_id} not found")
            if self.use_s3:
                return self._s3_get_bytes(asset.storage_path)
            return self._resolve_storage_path(asset.storage_path).read_bytes()

    def get_image_path(self, image_id: str) -> Path | None:
        """Local-mode only: return the on-disk path. Returns None in S3 mode
        (callers should fall back to `get_image_presigned_url` instead)."""
        if self.use_s3:
            return None
        with Session(engine) as session:
            asset = session.get(ImageAsset, image_id)
            if not asset:
                raise FileNotFoundError(f"ImageAsset {image_id} not found")
            return self._resolve_storage_path(asset.storage_path)

    def get_image_presigned_url(self, image_id: str) -> str | None:
        """S3-mode only: returns either a permanent public URL (when objects
        are uploaded public-read) or a short-lived presigned URL. Returns
        None in local mode. Name kept for API stability — the URL kind is
        a config concern, not a caller concern."""
        if not self.use_s3:
            return None
        with Session(engine) as session:
            asset = session.get(ImageAsset, image_id)
            if not asset:
                raise FileNotFoundError(f"ImageAsset {image_id} not found")
            if settings.s3_public_read:
                return self._s3_public_url(asset.storage_path)
            return self._s3_presigned_url(asset.storage_path)

    def get_image_download_url(self, image_id: str, filename: str) -> str | None:
        """S3-mode only: presigned URL with Content-Disposition: attachment
        so the browser saves the file instead of previewing it. Public-URL
        objects can't override Content-Disposition, so this always builds a
        presigned URL even when public-read is enabled. Returns None in
        local mode."""
        if not self.use_s3:
            return None
        assert self._s3 is not None
        with Session(engine) as session:
            asset = session.get(ImageAsset, image_id)
            if not asset:
                raise FileNotFoundError(f"ImageAsset {image_id} not found")
            return self._s3.generate_presigned_url(
                "get_object",
                Params={
                    "Bucket": self.bucket,
                    "Key": asset.storage_path,
                    "ResponseContentDisposition": f'attachment; filename="{filename}"',
                },
                ExpiresIn=settings.s3_presigned_expires_seconds,
            )

    def get_mime_type(self, image_id: str) -> str:
        with Session(engine) as session:
            asset = session.get(ImageAsset, image_id)
            if not asset:
                raise FileNotFoundError(f"ImageAsset {image_id} not found")
            return asset.mime_type

    # ------------------------------------------------------------- deletes

    def delete_file(self, image_id: str) -> None:
        """Delete only the underlying object (S3 or disk). DB row untouched."""
        with Session(engine) as session:
            asset = session.get(ImageAsset, image_id)
            if not asset:
                return
            if self.use_s3:
                self._s3_delete(asset.storage_path)
            else:
                path = self._resolve_storage_path(asset.storage_path)
                if path.exists():
                    path.unlink()

    def delete_asset_if_unreferenced(self, session: Session, image_id: str) -> None:
        """Delete an ImageAsset row + its backing object only when no model
        references it. Safe to call after removing any single reference."""
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

        storage_path = asset.storage_path
        session.delete(asset)
        session.flush()
        if self.use_s3:
            self._s3_delete(storage_path)
        else:
            try:
                path = self._resolve_storage_path(storage_path)
                if path.exists():
                    path.unlink()
            except Exception:
                logger.warning("Failed to remove local file %s", storage_path, exc_info=True)

    # ----------------------------------------------------------- internals

    def _resolve_storage_path(self, storage_path: str) -> Path:
        path = Path(storage_path)
        return path if path.is_absolute() else self.base_dir / path

    # ------------------------------------------------------------- orphans

    def cleanup_orphan_files(self) -> int:
        """Remove objects that no ImageAsset row points to.

        Local mode: skips files modified within ORPHAN_GRACE_SECONDS so an
        in-flight upload that hasn't committed yet isn't yanked.

        S3 mode: same idea using S3 LastModified. Returns the count
        removed. Safe to call repeatedly.
        """
        with Session(engine) as session:
            known = {
                Path(a.storage_path).name if not self.use_s3 else a.storage_path
                for a in session.exec(select(ImageAsset)).all()
            }

        if self.use_s3:
            return self._cleanup_orphans_s3(known)
        return self._cleanup_orphans_local(known)

    def _cleanup_orphans_local(self, known_basenames: set[str]) -> int:
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
            logger.info("Removed %s orphan local file(s)", removed)
        return removed

    def _cleanup_orphans_s3(self, known_keys: set[str]) -> int:
        assert self._s3 is not None
        import datetime as _dt

        cutoff = _dt.datetime.now(_dt.UTC) - _dt.timedelta(seconds=ORPHAN_GRACE_SECONDS)
        removed = 0
        paginator = self._s3.get_paginator("list_objects_v2")
        try:
            for page in paginator.paginate(Bucket=self.bucket, Prefix=self._images_prefix):
                for obj in page.get("Contents", []) or []:
                    key = obj["Key"]
                    if key in known_keys:
                        continue
                    last_modified = obj.get("LastModified")
                    if last_modified and last_modified > cutoff:
                        continue
                    self._s3.delete_object(Bucket=self.bucket, Key=key)
                    removed += 1
        except Exception:
            logger.warning("S3 orphan cleanup failed", exc_info=True)
        if removed:
            logger.info("Removed %s orphan S3 object(s)", removed)
        return removed


storage_service = StorageService()
