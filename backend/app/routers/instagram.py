"""Account management + publish endpoints for connected Instagram accounts."""

from fastapi import APIRouter, HTTPException
from sqlmodel import Session, select

from app.database import engine
from app.models import InstagramAccount, utcnow
from app.services.instagram import (
    InstagramError,
    MissingResourceError,
    publish_carousel_by_ids,
    publish_feed_post_by_id,
    publish_stories_by_ids,
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


def _ig_error_to_http(e: InstagramError) -> HTTPException:
    detail = str(e)
    if e.body:
        detail += f"\n\nResponse: {e.body[:500]}"
    return HTTPException(502, detail)


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

    try:
        return await publish_feed_post_by_id(
            feed_post_id,
            account_id,
            body.get("caption") or None,
            body.get("hashtags") or [],
        )
    except MissingResourceError as e:
        raise HTTPException(404, str(e))
    except InstagramError as e:
        raise _ig_error_to_http(e)


@router.post("/publish-carousel")
async def publish_carousel_endpoint(body: dict):
    """Publish 2–10 FeedPosts as a single Instagram carousel.

    Body: { feed_post_ids: [..], account_id, caption?, hashtags? }

    The same caption applies to the whole carousel (IG's data model).
    All FeedPosts in the batch get the same resulting ig_media_id, so
    the feed grid will mark each one as "published as part of a carousel".
    """
    account_id = body.get("account_id")
    if not account_id:
        raise HTTPException(400, "Missing account_id")

    try:
        return await publish_carousel_by_ids(
            body.get("feed_post_ids") or [],
            account_id,
            body.get("caption") or None,
            body.get("hashtags") or [],
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    except MissingResourceError as e:
        raise HTTPException(404, str(e))
    except InstagramError as e:
        raise _ig_error_to_http(e)


@router.post("/publish-stories")
async def publish_stories_endpoint(body: dict):
    """Publish 1–10 FeedPosts as sequential Instagram Stories.

    Body: { feed_post_ids: [..], account_id }

    Stories have no caption/hashtag support via the Graph API, so the
    request payload is simpler than the feed variants. Each story is
    its own media on IG (no carousel-story concept), so every post
    gets a unique ig_media_id.

    Stories are published one at a time and committed individually —
    if the 3rd story fails, the first two are already saved with their
    ig_media_ids. The error response notes how many succeeded.
    """
    account_id = body.get("account_id")
    if not account_id:
        raise HTTPException(400, "Missing account_id")

    try:
        return await publish_stories_by_ids(
            body.get("feed_post_ids") or [],
            account_id,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    except MissingResourceError as e:
        raise HTTPException(404, str(e))
    except InstagramError as e:
        raise _ig_error_to_http(e)
