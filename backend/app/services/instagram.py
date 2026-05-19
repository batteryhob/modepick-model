"""Instagram API integration — OAuth + publishing.

Uses the "Instagram API with Instagram Login" flow introduced in
2024-07 (no Facebook Page connection required). Public reference:
https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/

Flow:
  1. /api/auth/instagram/start  → builds the IG authorize URL, returns it
  2. user logs in on instagram.com, grants permissions, gets redirected
     back to {redirect_uri}?code=...
  3. /api/auth/instagram/callback → exchanges code for short-lived token,
     trades it for a long-lived (60d) token, fetches the IG user id +
     username, upserts InstagramAccount row.
  4. publish_feed_post(...) → creates a media container, polls until
     ready, then publishes.
"""

from __future__ import annotations

import logging
import time
from datetime import datetime, timedelta, timezone
from typing import Optional

import httpx
from sqlmodel import Session, select

from app.config import settings
from app.database import engine
from app.models import FeedPost, ImageAsset, InstagramAccount, utcnow
from app.services.storage import storage_service

logger = logging.getLogger(__name__)

# Permissions the OAuth flow asks for. instagram_business_content_publish is
# required to call /media and /media_publish; instagram_business_basic is
# required to read the account id + username.
OAUTH_SCOPES = [
    "instagram_business_basic",
    "instagram_business_content_publish",
]

# IG Graph API endpoints. v23.0 is current as of 2026; bump as needed.
GRAPH_API_VERSION = "v23.0"
AUTHORIZE_URL = "https://www.instagram.com/oauth/authorize"
TOKEN_URL = "https://api.instagram.com/oauth/access_token"
LONG_LIVED_TOKEN_URL = "https://graph.instagram.com/access_token"
GRAPH_BASE = f"https://graph.instagram.com/{GRAPH_API_VERSION}"

# Container readiness polling. The Graph API returns the container immediately
# but it may need a few seconds to be "FINISHED" before publish accepts it.
CONTAINER_POLL_INTERVAL_SECONDS = 2
CONTAINER_POLL_MAX_SECONDS = 60


class InstagramError(RuntimeError):
    """Wraps a non-2xx response or parse error from the Instagram API."""

    def __init__(self, message: str, status_code: int | None = None, body: str | None = None):
        super().__init__(message)
        self.status_code = status_code
        self.body = body


# ----------------------------------------------------------------- OAuth flow


def build_authorize_url(state: str) -> str:
    """The URL we redirect the user's browser to so they can log in to
    Instagram and grant our app permissions. `state` is a CSRF token the
    caller generates and verifies on the callback."""
    if not settings.instagram_configured:
        raise InstagramError("Instagram app credentials not configured")

    params = {
        "client_id": settings.instagram_app_id,
        "redirect_uri": settings.instagram_redirect_uri,
        "response_type": "code",
        "scope": ",".join(OAUTH_SCOPES),
        "state": state,
    }
    query = "&".join(f"{k}={httpx.QueryParams({k: v})[k]}" for k, v in params.items())
    return f"{AUTHORIZE_URL}?{query}"


async def exchange_code_for_account(code: str) -> InstagramAccount:
    """Run the full token-exchange flow and upsert an InstagramAccount row.
    Strips the trailing '#_' that Instagram appends to the code if present."""
    code = code.split("#_")[0]

    # 1. Short-lived token (1 hour).
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            TOKEN_URL,
            data={
                "client_id": settings.instagram_app_id,
                "client_secret": settings.instagram_app_secret,
                "grant_type": "authorization_code",
                "redirect_uri": settings.instagram_redirect_uri,
                "code": code,
            },
        )
        if resp.status_code != 200:
            raise InstagramError(
                "Failed to exchange auth code for short-lived token",
                status_code=resp.status_code,
                body=resp.text,
            )
        short = resp.json()
        short_token = short["access_token"]
        ig_user_id = str(short.get("user_id") or short.get("user", {}).get("id"))

    # 2. Trade for long-lived (60d) token.
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(
            LONG_LIVED_TOKEN_URL,
            params={
                "grant_type": "ig_exchange_token",
                "client_secret": settings.instagram_app_secret,
                "access_token": short_token,
            },
        )
        if resp.status_code != 200:
            raise InstagramError(
                "Failed to upgrade to long-lived token",
                status_code=resp.status_code,
                body=resp.text,
            )
        long_data = resp.json()
        long_token = long_data["access_token"]
        expires_in = int(long_data.get("expires_in", 60 * 24 * 3600))

    # 3. Fetch username for display.
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(
            f"{GRAPH_BASE}/me",
            params={"fields": "id,username", "access_token": long_token},
        )
        if resp.status_code != 200:
            raise InstagramError(
                "Failed to fetch account profile",
                status_code=resp.status_code,
                body=resp.text,
            )
        profile = resp.json()
        username = profile.get("username", "")
        # Some endpoints return the ID under "id"; prefer that over the
        # one from the token exchange if both are present.
        ig_user_id = str(profile.get("id") or ig_user_id)

    expires_at = datetime.now(timezone.utc) + timedelta(seconds=expires_in)

    with Session(engine) as session:
        existing = session.exec(
            select(InstagramAccount).where(InstagramAccount.ig_user_id == ig_user_id)
        ).first()
        if existing:
            existing.access_token = long_token
            existing.token_expires_at = expires_at
            existing.username = username
            existing.updated_at = utcnow()
            session.add(existing)
            session.commit()
            session.refresh(existing)
            return existing

        account = InstagramAccount(
            ig_user_id=ig_user_id,
            username=username,
            access_token=long_token,
            token_expires_at=expires_at,
        )
        session.add(account)
        session.commit()
        session.refresh(account)
        return account


async def refresh_token_if_needed(account: InstagramAccount, threshold_days: int = 7) -> bool:
    """Refresh a long-lived token if it's within `threshold_days` of expiring.
    Returns True if a refresh happened. Tokens that are already expired
    can't be refreshed via this endpoint — the user has to re-link."""
    now = datetime.now(timezone.utc)
    expires_at = account.token_expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at - now > timedelta(days=threshold_days):
        return False

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(
            f"https://graph.instagram.com/refresh_access_token",
            params={
                "grant_type": "ig_refresh_token",
                "access_token": account.access_token,
            },
        )
        if resp.status_code != 200:
            raise InstagramError(
                "Token refresh failed", status_code=resp.status_code, body=resp.text
            )
        data = resp.json()

    expires_in = int(data.get("expires_in", 60 * 24 * 3600))
    with Session(engine) as session:
        fresh = session.get(InstagramAccount, account.id)
        if not fresh:
            return False
        fresh.access_token = data["access_token"]
        fresh.token_expires_at = datetime.now(timezone.utc) + timedelta(seconds=expires_in)
        fresh.updated_at = utcnow()
        session.add(fresh)
        session.commit()
    return True


# -------------------------------------------------------------- publish flow


def _public_image_url(image_id: str) -> str:
    """The URL Instagram's servers will fetch when we hand off image_url.
    Must be reachable from the public internet (S3 public URL works; a
    pure localhost backend URL would not)."""
    url = storage_service.get_image_presigned_url(image_id)
    if not url:
        raise InstagramError(
            "Image is on local disk — Instagram can't fetch it. Enable S3 mode "
            "or expose the backend via a public URL before publishing."
        )
    return url


async def publish_feed_post(
    post: FeedPost,
    account: InstagramAccount,
    caption_text: str | None = None,
    hashtags: list[str] | None = None,
) -> str:
    """End-to-end publish: build caption, create container, wait for FINISHED,
    publish, return the IG media id. Raises InstagramError on any step.
    The caller is responsible for persisting `ig_media_id` and `posted_at`.

    Caption / hashtags are provided per publish call now — the FeedPost
    columns are no longer the source of truth. Passing both as None
    publishes with an empty caption.
    """
    image_url = _public_image_url(post.image_id)
    caption = _compose_caption(caption_text, hashtags)

    # 1. Create media container.
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"{GRAPH_BASE}/{account.ig_user_id}/media",
            data={
                "image_url": image_url,
                "caption": caption,
                "access_token": account.access_token,
            },
        )
        if resp.status_code != 200:
            raise InstagramError(
                "Failed to create media container",
                status_code=resp.status_code,
                body=resp.text,
            )
        container_id = resp.json().get("id")
        if not container_id:
            raise InstagramError("Media container response missing id", body=resp.text)

    # 2. Poll container until FINISHED. IG typically takes 2-10s for image
    # posts but specs allow up to a minute.
    deadline = time.monotonic() + CONTAINER_POLL_MAX_SECONDS
    async with httpx.AsyncClient(timeout=30) as client:
        while time.monotonic() < deadline:
            resp = await client.get(
                f"{GRAPH_BASE}/{container_id}",
                params={
                    "fields": "status_code",
                    "access_token": account.access_token,
                },
            )
            if resp.status_code != 200:
                raise InstagramError(
                    "Failed polling container status",
                    status_code=resp.status_code,
                    body=resp.text,
                )
            status = resp.json().get("status_code")
            if status == "FINISHED":
                break
            if status == "ERROR" or status == "EXPIRED":
                raise InstagramError(f"Container ended in status {status}", body=resp.text)
            time.sleep(CONTAINER_POLL_INTERVAL_SECONDS)
        else:
            raise InstagramError("Container never reached FINISHED state")

    # 3. Publish.
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"{GRAPH_BASE}/{account.ig_user_id}/media_publish",
            data={
                "creation_id": container_id,
                "access_token": account.access_token,
            },
        )
        if resp.status_code != 200:
            raise InstagramError(
                "Failed to publish media container",
                status_code=resp.status_code,
                body=resp.text,
            )
        ig_media_id = resp.json().get("id")
        if not ig_media_id:
            raise InstagramError("Publish response missing id", body=resp.text)

    return ig_media_id


async def publish_carousel(
    posts: list[FeedPost],
    account: InstagramAccount,
    caption_text: str | None,
    hashtags: list[str] | None,
) -> str:
    """Publish a carousel post (2–10 images) to Instagram.

    Flow per Meta docs:
      1. For each image: POST /{ig-user-id}/media with is_carousel_item=true
         to get a child container id.
      2. POST /{ig-user-id}/media with media_type=CAROUSEL and
         children=<comma-separated child ids> to get the carousel container.
      3. Poll carousel container until FINISHED.
      4. POST /{ig-user-id}/media_publish to publish.

    Returns the IG media id of the published carousel. Caller persists
    that id on every FeedPost in the batch.
    """
    if len(posts) < 2 or len(posts) > 10:
        raise InstagramError(
            f"Carousel requires 2–10 images, got {len(posts)}"
        )

    caption = _compose_caption(caption_text, hashtags)
    image_urls = [_public_image_url(p.image_id) for p in posts]

    # 1. Create child containers in parallel-ish (sequential is fine; the
    # API isn't rate-limited at this scale).
    child_ids: list[str] = []
    async with httpx.AsyncClient(timeout=30) as client:
        for image_url in image_urls:
            resp = await client.post(
                f"{GRAPH_BASE}/{account.ig_user_id}/media",
                data={
                    "image_url": image_url,
                    "is_carousel_item": "true",
                    "access_token": account.access_token,
                },
            )
            if resp.status_code != 200:
                raise InstagramError(
                    "Failed to create carousel child container",
                    status_code=resp.status_code,
                    body=resp.text,
                )
            child_id = resp.json().get("id")
            if not child_id:
                raise InstagramError(
                    "Child container response missing id", body=resp.text
                )
            child_ids.append(child_id)

    # 2. Create the carousel container that references the children.
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"{GRAPH_BASE}/{account.ig_user_id}/media",
            data={
                "media_type": "CAROUSEL",
                "caption": caption,
                "children": ",".join(child_ids),
                "access_token": account.access_token,
            },
        )
        if resp.status_code != 200:
            raise InstagramError(
                "Failed to create carousel container",
                status_code=resp.status_code,
                body=resp.text,
            )
        carousel_id = resp.json().get("id")
        if not carousel_id:
            raise InstagramError(
                "Carousel container response missing id", body=resp.text
            )

    # 3. Poll carousel container until ready. Carousels take longer than
    # single images because IG fetches and processes each child first.
    deadline = time.monotonic() + CONTAINER_POLL_MAX_SECONDS
    async with httpx.AsyncClient(timeout=30) as client:
        while time.monotonic() < deadline:
            resp = await client.get(
                f"{GRAPH_BASE}/{carousel_id}",
                params={
                    "fields": "status_code",
                    "access_token": account.access_token,
                },
            )
            if resp.status_code != 200:
                raise InstagramError(
                    "Failed polling carousel status",
                    status_code=resp.status_code,
                    body=resp.text,
                )
            status = resp.json().get("status_code")
            if status == "FINISHED":
                break
            if status in ("ERROR", "EXPIRED"):
                raise InstagramError(
                    f"Carousel ended in status {status}", body=resp.text
                )
            time.sleep(CONTAINER_POLL_INTERVAL_SECONDS)
        else:
            raise InstagramError("Carousel never reached FINISHED state")

    # 4. Publish.
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"{GRAPH_BASE}/{account.ig_user_id}/media_publish",
            data={
                "creation_id": carousel_id,
                "access_token": account.access_token,
            },
        )
        if resp.status_code != 200:
            raise InstagramError(
                "Failed to publish carousel",
                status_code=resp.status_code,
                body=resp.text,
            )
        ig_media_id = resp.json().get("id")
        if not ig_media_id:
            raise InstagramError("Carousel publish response missing id", body=resp.text)

    return ig_media_id


def _compose_caption(caption: Optional[str], hashtags: Optional[list]) -> str:
    """Caption + hashtag tail. IG accepts up to 2200 chars / 30 hashtags."""
    body = caption.strip() if caption else ""
    tag_line = ""
    if hashtags:
        cleaned = [t.lstrip("#").strip() for t in hashtags if t and t.strip()]
        cleaned = cleaned[:30]
        tag_line = " ".join(f"#{t}" for t in cleaned)
    if body and tag_line:
        return f"{body}\n\n{tag_line}"
    return body or tag_line
