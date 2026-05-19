"""Account management + publish endpoints for connected Instagram accounts."""

from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from sqlmodel import Session, select

from app.database import engine
from app.models import FeedPost, InstagramAccount, utcnow
from app.services.instagram import (
    InstagramError,
    publish_carousel,
    publish_feed_post,
    refresh_token_if_needed,
)

router = APIRouter(prefix="/api/instagram", tags=["instagram"])


def _account_to_dict(a: InstagramAccount) -> dict:
    # Never expose the raw access_token to the frontend; it's a credential.
    return {
        "id": a.id,
        "ig_user_id": a.ig_user_id,
        "username": a.username,
        "token_expires_at": a.token_expires_at,
        "label": a.label,
        "created_at": a.created_at,
    }


@router.get("/accounts")
def list_accounts():
    with Session(engine) as session:
        accounts = session.exec(
            select(InstagramAccount).order_by(InstagramAccount.created_at)
        ).all()
        return [_account_to_dict(a) for a in accounts]


@router.delete("/accounts/{account_id}", status_code=204)
def remove_account(account_id: str):
    with Session(engine) as session:
        account = session.get(InstagramAccount, account_id)
        if not account:
            raise HTTPException(404, "Account not found")
        session.delete(account)
        session.commit()


@router.patch("/accounts/{account_id}")
def update_account_label(account_id: str, body: dict):
    """Lets the user attach a free-form label (e.g. '메인 계정')."""
    label = (body.get("label") or "").strip() or None
    with Session(engine) as session:
        account = session.get(InstagramAccount, account_id)
        if not account:
            raise HTTPException(404, "Account not found")
        account.label = label
        account.updated_at = utcnow()
        session.add(account)
        session.commit()
        session.refresh(account)
        return _account_to_dict(account)


@router.post("/publish/{feed_post_id}")
async def publish_post(feed_post_id: str, body: dict):
    """Publish a single FeedPost. Caption + hashtags are passed inline
    in the request body — they're typed in at publish time and not
    persisted on the FeedPost itself.

    Body: { account_id, caption?, hashtags? }
    """
    account_id = body.get("account_id")
    if not account_id:
        raise HTTPException(400, "Missing account_id")
    caption_text = body.get("caption") or None
    hashtags = body.get("hashtags") or []

    with Session(engine) as session:
        post = session.get(FeedPost, feed_post_id)
        if not post:
            raise HTTPException(404, "Feed post not found")
        # Re-publishing is allowed — IG treats each call as a new media
        # creation, and the user's mental model is "image is reusable".
        # We just overwrite ig_media_id with the latest one.
        account = session.get(InstagramAccount, account_id)
        if not account:
            raise HTTPException(404, "Instagram account not found")
        post_copy = FeedPost(**post.model_dump())

    try:
        await refresh_token_if_needed(account)
    except InstagramError:
        pass  # fall through; publish call will surface a clearer error

    try:
        with Session(engine) as session:
            fresh = session.get(InstagramAccount, account_id)
            if not fresh:
                raise HTTPException(404, "Account vanished mid-publish")
            ig_media_id = await publish_feed_post(
                post_copy, fresh, caption_text, hashtags
            )

        with Session(engine) as session:
            post = session.get(FeedPost, feed_post_id)
            if not post:
                raise HTTPException(404, "Feed post vanished mid-publish")
            post.ig_media_id = ig_media_id
            post.ig_account_id = account_id
            post.posted_at = datetime.now(timezone.utc)
            session.add(post)
            session.commit()

        return {
            "ig_media_id": ig_media_id,
            "posted_at": datetime.now(timezone.utc),
        }

    except InstagramError as e:
        detail = str(e)
        if e.body:
            detail += f"\n\nResponse: {e.body[:500]}"
        raise HTTPException(502, detail)


@router.post("/publish-carousel")
async def publish_carousel_endpoint(body: dict):
    """Publish 2–10 FeedPosts as a single Instagram carousel.

    Body: { feed_post_ids: [..], account_id, caption?, hashtags? }

    The same caption applies to the whole carousel (IG's data model).
    All FeedPosts in the batch get the same resulting ig_media_id, so
    the feed grid will mark each one as "published as part of a carousel".
    """
    feed_post_ids: list[str] = body.get("feed_post_ids") or []
    account_id = body.get("account_id")
    caption_text = body.get("caption") or None
    hashtags = body.get("hashtags") or []

    if not account_id:
        raise HTTPException(400, "Missing account_id")
    if len(feed_post_ids) < 2 or len(feed_post_ids) > 10:
        raise HTTPException(
            400, "feed_post_ids must have 2–10 entries for a carousel"
        )

    with Session(engine) as session:
        posts: list[FeedPost] = []
        for fpid in feed_post_ids:
            p = session.get(FeedPost, fpid)
            if not p:
                raise HTTPException(404, f"Feed post {fpid} not found")
            # No de-duplication: re-publishing previously-published posts
            # is intentional. Each call overwrites the recorded ig_media_id
            # with the latest one.
            posts.append(p)

        account = session.get(InstagramAccount, account_id)
        if not account:
            raise HTTPException(404, "Instagram account not found")
        # Detach so the async call doesn't hold the session.
        post_copies = [FeedPost(**p.model_dump()) for p in posts]

    try:
        await refresh_token_if_needed(account)
    except InstagramError:
        pass

    try:
        with Session(engine) as session:
            fresh = session.get(InstagramAccount, account_id)
            if not fresh:
                raise HTTPException(404, "Account vanished mid-publish")
            ig_media_id = await publish_carousel(
                post_copies, fresh, caption_text, hashtags
            )

        now = datetime.now(timezone.utc)
        with Session(engine) as session:
            for fpid in feed_post_ids:
                post = session.get(FeedPost, fpid)
                if not post:
                    continue
                post.ig_media_id = ig_media_id
                post.ig_account_id = account_id
                post.posted_at = now
                session.add(post)
            session.commit()

        return {"ig_media_id": ig_media_id, "posted_at": now, "count": len(feed_post_ids)}

    except InstagramError as e:
        detail = str(e)
        if e.body:
            detail += f"\n\nResponse: {e.body[:500]}"
        raise HTTPException(502, detail)
