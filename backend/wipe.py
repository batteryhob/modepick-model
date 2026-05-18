"""Wipe all media + content rows. Use this when switching storage backends
(local <-> S3) and you don't want to migrate existing media.

What gets deleted:
    * All ImageAsset rows
    * All Character / CharacterReference / WardrobeItem / WardrobeItemImage /
      MoodReference / WorldLocation / WorldLocationImage / FeedPost rows
    * All GenerationJob rows (they reference image ids that won't exist)
    * Local files under storage/images/

What is NOT touched:
    * The SQLite schema (tables stay, just emptied)
    * .env / config / code
    * S3 bucket contents (use the bucket console to clear if needed)

Run interactively — refuses to proceed without an explicit yes.
"""
from pathlib import Path
from sqlmodel import Session, delete

from app.config import settings
from app.database import engine
from app.models import (
    Character,
    CharacterReference,
    FeedPost,
    GenerationJob,
    ImageAsset,
    MoodReference,
    WardrobeItem,
    WardrobeItemImage,
    WorldLocation,
    WorldLocationImage,
)


def main() -> None:
    print("This will DELETE all characters, wardrobe, mood, world,")
    print("feed posts, jobs, and image rows. Local files under")
    print(f"  {settings.storage_path}")
    print("will also be removed.")
    print()
    answer = input('Type "wipe" to confirm: ').strip().lower()
    if answer != "wipe":
        print("Aborted.")
        return

    with Session(engine) as session:
        # Order matters — child rows before parents so FKs don't complain.
        for model in (
            FeedPost,
            GenerationJob,
            WardrobeItemImage,
            WardrobeItem,
            WorldLocationImage,
            WorldLocation,
            MoodReference,
            CharacterReference,
            Character,
            ImageAsset,
        ):
            session.exec(delete(model))
        session.commit()
    print("DB rows wiped.")

    storage_dir = Path(settings.storage_dir)
    if storage_dir.is_dir():
        removed = 0
        for p in storage_dir.iterdir():
            if p.is_file():
                try:
                    p.unlink()
                    removed += 1
                except Exception as exc:
                    print(f"  failed to remove {p.name}: {exc}")
        print(f"Local storage cleared: {removed} file(s) removed.")
    else:
        print("Local storage dir not present — skipped.")

    print("Done. Restart the backend.")


if __name__ == "__main__":
    main()
