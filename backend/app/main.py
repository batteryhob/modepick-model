import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.database import create_db_and_tables
from app.mcp_server import mcp as mcp_server
from app.routers import (
    characters,
    compose,
    feed,
    health,
    images,
    instagram,
    instagram_auth,
    jobs,
    mood,
    wardrobe,
    world,
)
from app.services.storage import storage_service


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-7s %(name)s | %(message)s",
)


# Built once at import so we can both mount it AND keep a reference to
# its lifespan (FastAPI doesn't propagate sub-app lifespans to mounted
# routes, so we chain it into our own lifespan below).
_mcp_inner_app = mcp_server.streamable_http_app()


# Localhost-only guard for MCP. The MCP server has NO authentication —
# any caller that can reach the URL can invoke compose / publish. If the
# user runs uvicorn with --host 0.0.0.0 (also the default config), the
# rest of the API needs to be LAN-reachable but MCP must not be. We
# refuse any /mcp request whose ASGI client.host isn't loopback.
_LOOPBACK_HOSTS = {"127.0.0.1", "::1", "localhost"}


async def mcp_loopback_guard(scope, receive, send):
    if scope["type"] in ("http", "websocket"):
        client = scope.get("client")
        host = client[0] if client else None
        if host not in _LOOPBACK_HOSTS:
            await send({
                "type": "http.response.start",
                "status": 403,
                "headers": [(b"content-type", b"application/json")],
            })
            await send({
                "type": "http.response.body",
                "body": b'{"error":"mcp is restricted to localhost"}',
            })
            return
    await _mcp_inner_app(scope, receive, send)


@asynccontextmanager
async def lifespan(app: FastAPI):
    create_db_and_tables()
    storage_service.cleanup_orphan_files()
    # MCP's StreamableHTTPSessionManager needs its task group started
    # before it can serve requests. Entering its lifespan kicks that off.
    #
    # The manager is one-shot — if a TestClient re-enters this lifespan
    # over the same process (smoke tests open several TestClient blocks
    # in a row), a second .run() will raise. We swallow that here so
    # tests don't fail; the manager from the first entry is already
    # torn down, but tests don't call /mcp endpoints so they don't care.
    # Production processes enter lifespan exactly once.
    mcp_cm = mcp_server.session_manager.run()
    try:
        await mcp_cm.__aenter__()
    except RuntimeError as e:
        if "can only be called once" not in str(e):
            raise
        mcp_cm = None
    try:
        yield
    finally:
        if mcp_cm is not None:
            await mcp_cm.__aexit__(None, None, None)


app = FastAPI(
    title="ModePick",
    description="Virtual Influencer Feed Generator",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(images.router)
app.include_router(characters.router)
app.include_router(wardrobe.router)
app.include_router(mood.router)
app.include_router(world.router)
app.include_router(compose.router)
app.include_router(feed.router)
app.include_router(jobs.router)
app.include_router(instagram_auth.router)
app.include_router(instagram.router)

# MCP server — local agents (Claude Desktop / Codex) connect to /mcp via
# Streamable HTTP. Mounted as a sub-app so it shares the uvicorn process
# and lifecycle: backend up = MCP up. The loopback guard wraps the real
# MCP ASGI app to reject any non-localhost caller (no MCP auth otherwise).
app.mount("/mcp", mcp_loopback_guard)
