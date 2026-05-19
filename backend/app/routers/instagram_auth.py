"""OAuth callback handlers for Instagram API with Instagram Login.

Flow:
  GET /api/auth/instagram/start  → returns the authorize URL the frontend
                                    redirects the browser to. We don't 302
                                    here because the frontend wants to set
                                    a CSRF state in sessionStorage first.
  GET /api/auth/instagram/callback?code=&state= → exchanges the code, upserts
                                    InstagramAccount, returns the connected
                                    account so the frontend can confirm.
"""

import secrets
from urllib.parse import urlencode

from fastapi import APIRouter, HTTPException, Query

from app.config import settings
from app.services.instagram import (
    AUTHORIZE_URL,
    OAUTH_SCOPES,
    InstagramError,
    exchange_code_for_account,
)

router = APIRouter(prefix="/api/auth/instagram", tags=["instagram-auth"])


@router.get("/start")
def start_oauth():
    """Return the Instagram authorize URL the frontend should redirect to.
    The frontend generates and tracks a `state` value separately to defend
    against CSRF — we don't manage it server-side since the whole app is
    single-user / localhost-only."""
    if not settings.instagram_configured:
        raise HTTPException(
            500,
            "Instagram app credentials missing — set INSTAGRAM_APP_ID and "
            "INSTAGRAM_APP_SECRET in .env",
        )
    state = secrets.token_urlsafe(16)
    params = {
        "client_id": settings.instagram_app_id,
        "redirect_uri": settings.instagram_redirect_uri,
        "response_type": "code",
        "scope": ",".join(OAUTH_SCOPES),
        "state": state,
    }
    return {"url": f"{AUTHORIZE_URL}?{urlencode(params)}", "state": state}


@router.get("/callback")
async def oauth_callback(
    code: str | None = Query(default=None),
    error: str | None = Query(default=None),
    error_description: str | None = Query(default=None),
):
    """The frontend's /auth/instagram/callback page calls this endpoint with
    the `code` query param it received from Instagram. We exchange the
    code for a long-lived token and persist an InstagramAccount row."""
    if error:
        raise HTTPException(400, f"Instagram returned error: {error} — {error_description}")
    if not code:
        raise HTTPException(400, "Missing authorization code")

    try:
        account = await exchange_code_for_account(code)
    except InstagramError as e:
        # Surface the body so the user can see why Meta rejected us.
        detail = str(e)
        if e.body:
            detail += f"\n\nResponse: {e.body[:500]}"
        raise HTTPException(400, detail)

    return {
        "id": account.id,
        "ig_user_id": account.ig_user_id,
        "username": account.username,
        "token_expires_at": account.token_expires_at,
    }
