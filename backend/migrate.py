"""Schema migrations for modepick-model.

Run before restarting the backend after pulling changes:

    cd backend && .venv/bin/python migrate.py

This script is idempotent — each step checks the current schema state and only
applies what's missing. Safe to re-run.
"""
from sqlalchemy import text

from app.database import create_db_and_tables, engine


def _columns(conn, table: str) -> set[str]:
    rows = conn.exec_driver_sql(f"PRAGMA table_info({table})").fetchall()
    return {row[1] for row in rows}


def _table_exists(conn, table: str) -> bool:
    row = conn.exec_driver_sql(
        "SELECT name FROM sqlite_master WHERE type='table' AND name = :n",
        {"n": table},
    ).fetchone()
    return row is not None


def main() -> None:
    with engine.begin() as conn:
        # Migration 1 — wardrobe 1:N rebuild. The legacy schema had
        # `image_id` directly on wardrobe_item; the new schema moves images to
        # the wardrobe_item_image table.
        if _table_exists(conn, "wardrobe_item") and "image_id" in _columns(conn, "wardrobe_item"):
            conn.exec_driver_sql("DROP TABLE IF EXISTS wardrobe_item_image")
            conn.exec_driver_sql("DROP TABLE IF EXISTS wardrobe_item")
            print("[1] Dropped legacy wardrobe_item (1:N rebuild).")

        # Migration 2 — add `size` column for bag sizing.
        if _table_exists(conn, "wardrobe_item") and "size" not in _columns(conn, "wardrobe_item"):
            conn.exec_driver_sql("ALTER TABLE wardrobe_item ADD COLUMN size TEXT")
            print("[2] Added wardrobe_item.size column.")

        # Migration 3 — drop any rows with the retired 'accessory' category.
        if _table_exists(conn, "wardrobe_item"):
            result = conn.execute(
                text("DELETE FROM wardrobe_item WHERE category = 'accessory'")
            )
            if result.rowcount:
                print(f"[3] Removed {result.rowcount} legacy accessory row(s).")

        # Migration 4 — FeedPost gains caption / hashtags / posted_at for the
        # Instagram-prep workflow (caption drafts, hashtag set, posted toggle).
        if _table_exists(conn, "feed_post"):
            feed_cols = _columns(conn, "feed_post")
            if "caption" not in feed_cols:
                conn.exec_driver_sql("ALTER TABLE feed_post ADD COLUMN caption TEXT")
                print("[4a] Added feed_post.caption")
            if "hashtags" not in feed_cols:
                conn.exec_driver_sql(
                    "ALTER TABLE feed_post ADD COLUMN hashtags TEXT DEFAULT '[]'"
                )
                print("[4b] Added feed_post.hashtags")
            if "posted_at" not in feed_cols:
                conn.exec_driver_sql("ALTER TABLE feed_post ADD COLUMN posted_at DATETIME")
                print("[4c] Added feed_post.posted_at")
            if "compose_params" not in feed_cols:
                # Snapshot of compose state for "re-compose from this post".
                conn.exec_driver_sql(
                    "ALTER TABLE feed_post ADD COLUMN compose_params TEXT DEFAULT '{}'"
                )
                print("[4d] Added feed_post.compose_params")
            if "ig_media_id" not in feed_cols:
                conn.exec_driver_sql(
                    "ALTER TABLE feed_post ADD COLUMN ig_media_id TEXT"
                )
                print("[5a] Added feed_post.ig_media_id")
            if "ig_account_id" not in feed_cols:
                conn.exec_driver_sql(
                    "ALTER TABLE feed_post ADD COLUMN ig_account_id TEXT"
                )
                print("[5b] Added feed_post.ig_account_id")

    # Always run create_all to add any new tables.
    create_db_and_tables()
    print("Schema up to date.")


if __name__ == "__main__":
    main()
