"""Smoke tests — wire-up only, no real provider / IG calls.

The goal is to catch the cheap-to-make breakages: missing imports,
syntax errors in any router, model schema typos, broken route
registration. These run in CI on every push.
"""
from fastapi.testclient import TestClient

from app.main import app


def test_health_endpoint_responds():
    # The `with` block triggers FastAPI lifespan, which runs
    # create_db_and_tables() — so a passing call also proves every
    # model can be issued to SQLite without schema errors.
    with TestClient(app) as client:
        r = client.get("/api/health")
        assert r.status_code == 200
        body = r.json()
        assert body["status"] in ("ok", "degraded")
        assert body["db"] == "ok"


def test_known_routes_registered():
    # Drift check: if someone renames a router prefix without updating
    # the FE, this test still flags the missing endpoint.
    paths = {getattr(route, "path", None) for route in app.routes}
    for required in (
        "/api/health",
        "/api/feed",
        "/api/compose",
        "/api/compose-mood",
        "/api/instagram/publish-stories",
        "/api/instagram/publish-carousel",
        "/api/characters",
        "/api/wardrobe",
        "/api/mood",
        "/api/world",
    ):
        assert required in paths, f"missing route: {required}"


def test_mcp_server_mounted():
    # The MCP sub-app is mounted at /mcp. Its single Streamable HTTP
    # route appears as a Mount on the parent app's route table.
    mounts = [r for r in app.routes if getattr(r, "path", "") == "/mcp"]
    assert mounts, "MCP sub-app is not mounted at /mcp"


def test_mcp_tools_registered():
    # Catch accidental deletion / rename of any MCP tool — these are
    # the public surface area agents call.
    import asyncio
    from app.mcp_server import mcp

    tool_names = {t.name for t in asyncio.run(mcp.list_tools())}
    for required in (
        "list_characters",
        "list_wardrobe",
        "list_world_locations",
        "list_moods",
        "list_instagram_accounts",
        "list_feed_posts",
        "get_compose_job",
        "compose_look",
        "compose_mood",
        "publish_single",
        "publish_carousel",
        "publish_stories",
    ):
        assert required in tool_names, f"missing MCP tool: {required}"


def test_feed_list_empty_db():
    with TestClient(app) as client:
        r = client.get("/api/feed")
        assert r.status_code == 200
        body = r.json()
        assert body["total"] == 0
        assert body["posts"] == []
