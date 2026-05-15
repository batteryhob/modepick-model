import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.database import create_db_and_tables
from app.routers import characters, compose, feed, health, images, jobs, mood, wardrobe
from app.services.storage import storage_service


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-7s %(name)s | %(message)s",
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    create_db_and_tables()
    storage_service.cleanup_orphan_files()
    yield


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
app.include_router(compose.router)
app.include_router(feed.router)
app.include_router(jobs.router)
