"""MCP server mounted at /mcp on the main FastAPI app.

Lets local agents (Claude Desktop, Codex, etc.) read the user's curated
library — characters, wardrobe, world locations, mood references — then
kick off compose jobs and publish to Instagram on the user's behalf.

Transport: Streamable HTTP, stateless (each request is independent —
no per-session state to track). Tools call the existing service layer
directly since we're in the same process as FastAPI.

Design intent:
  - Reads are cheap; agents should call them freely to understand what's
    available before composing.
  - Composes are asynchronous: the tool enqueues the job and returns a
    job_id immediately. The agent polls get_compose_job until done, then
    finds the resulting feed posts via list_feed_posts.
  - Publishes are destructive (post goes live on IG). The MCP `readOnlyHint`
    annotation marks reads so well-behaved clients can auto-approve them
    while still gating writes.
"""

from __future__ import annotations

import asyncio
from typing import Optional

from mcp.server.fastmcp import FastMCP
from sqlmodel import Session, select

from app.database import engine
from app.models import (
    FeedPost,
    GenerationJob,
    InstagramAccount,
    MoodReference,
    WardrobeItem,
    WorldLocation,
)
from app.services.character import list_characters as svc_list_characters
from app.services.compose import (
    enqueue_compose_look,
    enqueue_compose_mood_shot,
    run_compose_job,
)
from app.services.instagram import (
    InstagramError,
    MissingResourceError,
    publish_carousel_by_ids,
    publish_feed_post_by_id,
    publish_stories_by_ids,
)


mcp = FastMCP(
    name="modepick",
    instructions=(
        "Tools for planning and publishing Instagram feed posts from a "
        "curated persona library. Workflow:\n"
        "  1. Call list_characters / list_wardrobe / list_world_locations / "
        "list_moods to understand what's available. Read the persona, "
        "notes, and tags fields to decide what fits.\n"
        "  2. To make a posed shot of the persona, call compose_look with "
        "a character_id plus wardrobe / location / mood ids. To make a "
        "people-less ambient shot of the persona's world, call "
        "compose_mood instead.\n"
        "  3. Both compose tools return immediately with a job_id. Poll "
        "get_compose_job(job_id) until status == 'success', then call "
        "list_feed_posts to find the new posts (filter by created_at).\n"
        "  4. After human review, publish via publish_single / "
        "publish_carousel / publish_stories. ALWAYS confirm with the "
        "human before publishing — these are visible on a real account."
    ),
    stateless_http=True,
    # Mounted at /mcp on the FastAPI app; this puts the protocol endpoint
    # at the mount root rather than /mcp/mcp.
    streamable_http_path="/",
)


# ---------------------------------------------------------------------------
# Read tools
# ---------------------------------------------------------------------------


@mcp.tool(annotations={"readOnlyHint": True})
def list_characters(active_only: bool = False) -> list[dict]:
    """List personas. Each entry includes the free-form `persona` dict
    the user filled in (description, age, style, etc.) — read it to
    decide which persona fits the post idea.

    The user typically has ONE active persona at a time; that's the
    one whose feed they're maintaining. When in doubt, pick the entry
    with `is_active: true` — or call with active_only=true to get just
    that one."""
    chars = svc_list_characters()
    # Strip references and base_image_id; an agent only needs identity
    # for picking. The compose tools use the persona's stored references
    # by default.
    result = [
        {
            "id": c["id"],
            "name": c["name"],
            "persona": c["persona"],
            "is_active": c["is_active"],
        }
        for c in chars
    ]
    if active_only:
        result = [c for c in result if c["is_active"]]
    return result


@mcp.tool(annotations={"readOnlyHint": True})
def list_wardrobe(category: Optional[str] = None) -> list[dict]:
    """List wardrobe items the persona can wear. Optionally filter by
    `category` — one of: hat, top, bottom, outerwear, dress, bag, shoes.
    Use the `notes` field (free-form description) to judge style fit."""
    with Session(engine) as session:
        stmt = select(WardrobeItem).order_by(WardrobeItem.created_at.desc())
        if category:
            stmt = stmt.where(WardrobeItem.category == category)
        items = list(session.exec(stmt).all())
        return [
            {
                "id": i.id,
                "name": i.name,
                "category": i.category,
                "notes": i.notes,
                "size": i.size,
            }
            for i in items
        ]


@mcp.tool(annotations={"readOnlyHint": True})
def list_world_locations() -> list[dict]:
    """List recurring locations the persona lives in (home, cafe, street,
    workplace, etc.). `notes` describes the place. Pair with compose_look
    or compose_mood by passing the location id."""
    with Session(engine) as session:
        stmt = select(WorldLocation).order_by(WorldLocation.created_at.desc())
        items = list(session.exec(stmt).all())
        return [
            {"id": i.id, "name": i.name, "notes": i.notes}
            for i in items
        ]


@mcp.tool(annotations={"readOnlyHint": True})
def list_moods() -> list[dict]:
    """List mood / lighting reference images. `tags` is a free-form
    comma-separated description ('warm, golden hour, soft'). Pass the
    mood id to compose to bias the rendered atmosphere."""
    with Session(engine) as session:
        stmt = select(MoodReference).order_by(MoodReference.created_at.desc())
        items = list(session.exec(stmt).all())
        return [
            {"id": i.id, "name": i.name, "tags": i.tags}
            for i in items
        ]


@mcp.tool(annotations={"readOnlyHint": True})
def list_instagram_accounts() -> list[dict]:
    """Connected Instagram accounts available for publishing. Pick one
    by id when calling publish_* tools."""
    with Session(engine) as session:
        items = list(
            session.exec(
                select(InstagramAccount).order_by(InstagramAccount.created_at)
            ).all()
        )
        return [
            {
                "id": a.id,
                "username": a.username,
                "label": a.label,
            }
            for a in items
        ]


@mcp.tool(annotations={"readOnlyHint": True})
def list_feed_posts(
    limit: int = 27,
    only_unposted: bool = False,
    character_id: Optional[str] = None,
) -> list[dict]:
    """List generated feed posts (newest first). `only_unposted=True`
    returns just drafts that haven't been published yet — these are
    candidates for publish_single / publish_carousel / publish_stories.
    Filter by character_id to narrow to one persona's feed."""
    with Session(engine) as session:
        stmt = select(FeedPost).order_by(FeedPost.created_at.desc()).limit(limit)
        if only_unposted:
            stmt = stmt.where(FeedPost.posted_at.is_(None))
        if character_id:
            stmt = stmt.where(FeedPost.character_id == character_id)
        posts = list(session.exec(stmt).all())
        return [
            {
                "id": p.id,
                "character_id": p.character_id,
                "image_id": p.image_id,
                "scene": p.scene,
                "slots": p.slots,
                "caption": p.caption,
                "hashtags": p.hashtags or [],
                "posted_at": p.posted_at.isoformat() if p.posted_at else None,
                "ig_media_id": p.ig_media_id,
                "created_at": p.created_at.isoformat(),
            }
            for p in posts
        ]


@mcp.tool(annotations={"readOnlyHint": True})
def get_compose_job(job_id: str) -> dict:
    """Poll a compose job's status. Returns {status, output_image_ids,
    error_message, duration_ms}. status is one of: pending, success,
    failed, missing."""
    with Session(engine) as session:
        job = session.get(GenerationJob, job_id)
        if not job:
            return {"status": "missing", "id": job_id}
        return {
            "id": job.id,
            "type": job.type,
            "status": job.status,
            "output_image_ids": job.output_image_ids or [],
            "error_message": job.error_message,
            "duration_ms": job.duration_ms,
        }


# ---------------------------------------------------------------------------
# Compose tools
# ---------------------------------------------------------------------------


# Bounds for count, mirroring the HTTP router's Pydantic Field(ge=1, le=4).
# Each variant multiplies provider cost, so this is a hard agent-safety
# clamp — if the agent asks for more we reject rather than silently cap.
MAX_VARIANTS_PER_CALL = 4


def _validate_count(count: int) -> Optional[dict]:
    if not isinstance(count, int) or count < 1 or count > MAX_VARIANTS_PER_CALL:
        return {
            "error": "bad_request",
            "message": (
                f"count must be an integer 1–{MAX_VARIANTS_PER_CALL}; "
                f"got {count!r}"
            ),
        }
    return None


# The event loop only keeps weak references to tasks created via
# create_task. If we don't hold a strong reference, the compose job can
# be garbage-collected mid-run. Pin them here and drop on completion.
_pending_compose_tasks: set[asyncio.Task] = set()


def _spawn_compose_job(job_id: str) -> None:
    task = asyncio.create_task(_run_job_safely(job_id))
    _pending_compose_tasks.add(task)
    task.add_done_callback(_pending_compose_tasks.discard)


async def _run_job_safely(job_id: str) -> None:
    """Fire-and-forget wrapper around run_compose_job. The job persists
    its own success/failure state, so we just need to keep the task
    alive long enough to finish and swallow exceptions to keep them out
    of the event-loop unhandled exception log."""
    try:
        await run_compose_job(job_id)
    except Exception:  # noqa: BLE001 — already recorded as job.error_message
        pass


@mcp.tool()
def compose_look(
    character_id: str,
    scene: str = "",
    wardrobe_slots: Optional[dict[str, str]] = None,
    location_id: Optional[str] = None,
    mood_id: Optional[str] = None,
    character_reference_ids: Optional[list[str]] = None,
    view: str = "RANDOM",
    capture_style: str = "AUTO",
    weather: str = "AUTO",
    season: str = "AUTO",
    time_of_day: str = "AUTO",
    count: int = 1,
    provider: str = "openai",
    quality: str = "medium",
) -> dict:
    """Start a 'look' compose job — the persona wearing wardrobe items
    in a scene. Returns {job_id, status: 'pending'} immediately; poll
    get_compose_job until status == 'success'.

    wardrobe_slots: maps slot name to wardrobe item id, e.g.
        {"top": "<id>", "bottom": "<id>", "shoes": "<id>"}
        Valid slot names: hat, top, bottom, outerwear, dress, bag, shoes.

    location_id / mood_id: optional ids from list_world_locations /
        list_moods to anchor the place and atmosphere.

    scene: free-form prompt addition ("walking out of the cafe with the
        umbrella half-open"). Use this for moment / action.

    count: 1–4 variants in one call. Higher counts multiply cost.
    """
    bad = _validate_count(count)
    if bad:
        return bad

    slots = dict(wardrobe_slots or {})
    if location_id:
        slots["location"] = location_id
    if mood_id:
        slots["mood"] = mood_id

    try:
        job_id = enqueue_compose_look(
            character_id=character_id,
            slots=slots,
            scene=scene,
            provider_name=provider,
            quality=quality,
            character_reference_ids=character_reference_ids or [],
            view=view,
            capture_style=capture_style,
            weather=weather,
            season=season,
            time_of_day=time_of_day,
            count=count,
            anchor_image_id=None,
        )
    except ValueError as e:
        return {"error": "bad_request", "message": str(e)}

    _spawn_compose_job(job_id)
    return {"job_id": job_id, "status": "pending"}


@mcp.tool()
def compose_mood(
    character_id: str,
    scene: str = "",
    location_id: Optional[str] = None,
    mood_id: Optional[str] = None,
    count: int = 1,
    provider: str = "openai",
    quality: str = "medium",
) -> dict:
    """Start a 'mood shot' compose job — no people in the frame, an
    ambient / still-life / lifestyle photo of the persona's world (a
    coffee on the cafe table, a window detail, an empty street). Used
    to vary the feed beyond posed-character shots.

    character_id is still required because every feed post is owned by
    a persona, but they won't appear in the image.

    Returns {job_id, status: 'pending'}; poll get_compose_job.
    """
    bad = _validate_count(count)
    if bad:
        return bad

    try:
        job_id = enqueue_compose_mood_shot(
            character_id=character_id,
            scene=scene,
            location_id=location_id,
            mood_id=mood_id,
            provider_name=provider,
            quality=quality,
            count=count,
        )
    except ValueError as e:
        return {"error": "bad_request", "message": str(e)}

    _spawn_compose_job(job_id)
    return {"job_id": job_id, "status": "pending"}


# ---------------------------------------------------------------------------
# Publish tools
# ---------------------------------------------------------------------------


def _ig_error_dict(e: InstagramError) -> dict:
    body = e.body[:500] if e.body else None
    return {"error": "instagram_api", "message": str(e), "response": body}


@mcp.tool(annotations={"destructiveHint": True})
async def publish_single(
    feed_post_id: str,
    account_id: str,
    caption: Optional[str] = None,
    hashtags: Optional[list[str]] = None,
) -> dict:
    """Publish ONE feed post to Instagram as a single feed image.
    Returns {ig_media_id, posted_at} on success.

    DESTRUCTIVE: this post goes live on the real IG account. Get
    explicit human confirmation first."""
    try:
        result = await publish_feed_post_by_id(
            feed_post_id, account_id, caption, hashtags
        )
    except MissingResourceError as e:
        return {"error": "not_found", "message": str(e)}
    except InstagramError as e:
        return _ig_error_dict(e)
    return {
        "ig_media_id": result["ig_media_id"],
        "posted_at": result["posted_at"].isoformat(),
    }


@mcp.tool(annotations={"destructiveHint": True})
async def publish_carousel(
    feed_post_ids: list[str],
    account_id: str,
    caption: Optional[str] = None,
    hashtags: Optional[list[str]] = None,
) -> dict:
    """Publish 2–10 feed posts as a single IG carousel (one swipeable
    post). The same caption applies to the whole carousel.

    DESTRUCTIVE — confirm with human first."""
    try:
        result = await publish_carousel_by_ids(
            feed_post_ids, account_id, caption, hashtags
        )
    except ValueError as e:
        return {"error": "bad_request", "message": str(e)}
    except MissingResourceError as e:
        return {"error": "not_found", "message": str(e)}
    except InstagramError as e:
        return _ig_error_dict(e)
    return {
        "ig_media_id": result["ig_media_id"],
        "posted_at": result["posted_at"].isoformat(),
        "count": result["count"],
    }


@mcp.tool(annotations={"destructiveHint": True})
async def publish_stories(
    feed_post_ids: list[str],
    account_id: str,
) -> dict:
    """Publish 1–10 feed posts as sequential Instagram Stories. Stories
    have no caption/hashtag support via the Graph API. Stories are
    published one-at-a-time and committed individually — on partial
    failure, the ones that already posted are saved.

    DESTRUCTIVE — confirm with human first."""
    try:
        result = await publish_stories_by_ids(feed_post_ids, account_id)
    except ValueError as e:
        return {"error": "bad_request", "message": str(e)}
    except MissingResourceError as e:
        return {"error": "not_found", "message": str(e)}
    except InstagramError as e:
        return _ig_error_dict(e)
    return result
