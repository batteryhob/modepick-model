from datetime import UTC, datetime
from typing import Optional
from uuid import uuid4

from sqlalchemy import Column, Index
from sqlmodel import JSON, Field, Relationship, SQLModel


def gen_uuid() -> str:
    return str(uuid4())


def utcnow() -> datetime:
    return datetime.now(UTC)


class ImageAsset(SQLModel, table=True):
    __tablename__ = "image_asset"

    id: str = Field(default_factory=gen_uuid, primary_key=True)
    storage_path: str
    width: int
    height: int
    mime_type: str
    file_size: int = 0
    source: str  # "generated" | "uploaded"
    created_at: datetime = Field(default_factory=utcnow)


class Character(SQLModel, table=True):
    __tablename__ = "character"

    id: str = Field(default_factory=gen_uuid, primary_key=True)
    name: str
    persona: dict = Field(default_factory=dict, sa_column=Column(JSON))
    base_image_id: str = Field(foreign_key="image_asset.id")
    is_active: bool = Field(default=False, index=True)
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)

    references: list["CharacterReference"] = Relationship(
        back_populates="character",
        sa_relationship_kwargs={"cascade": "all, delete-orphan"},
    )


class CharacterReference(SQLModel, table=True):
    __tablename__ = "character_reference"
    __table_args__ = (
        Index("ix_charref_char_role", "character_id", "role"),
    )

    id: str = Field(default_factory=gen_uuid, primary_key=True)
    character_id: str = Field(foreign_key="character.id")
    role: str
    image_id: str = Field(foreign_key="image_asset.id")
    created_at: datetime = Field(default_factory=utcnow)

    character: Character = Relationship(back_populates="references")


class WardrobeItem(SQLModel, table=True):
    __tablename__ = "wardrobe_item"

    id: str = Field(default_factory=gen_uuid, primary_key=True)
    name: str
    category: str = Field(index=True)
    notes: Optional[str] = None
    # Currently only surfaced in the UI for `category == "bag"`, but stored as
    # a generic free-text field so any category can adopt sizing later.
    size: Optional[str] = None
    created_at: datetime = Field(default_factory=utcnow)

    images: list["WardrobeItemImage"] = Relationship(
        back_populates="item",
        sa_relationship_kwargs={
            "cascade": "all, delete-orphan",
            "order_by": "WardrobeItemImage.sort_order",
        },
    )


class WardrobeItemImage(SQLModel, table=True):
    __tablename__ = "wardrobe_item_image"
    __table_args__ = (
        Index("ix_wardrobeitemimage_item_order", "item_id", "sort_order"),
    )

    id: str = Field(default_factory=gen_uuid, primary_key=True)
    item_id: str = Field(foreign_key="wardrobe_item.id")
    image_id: str = Field(foreign_key="image_asset.id")
    sort_order: int = Field(default=0)
    created_at: datetime = Field(default_factory=utcnow)

    item: WardrobeItem = Relationship(back_populates="images")


class MoodReference(SQLModel, table=True):
    __tablename__ = "mood_reference"

    id: str = Field(default_factory=gen_uuid, primary_key=True)
    name: str
    tags: str = ""  # comma-separated
    image_id: str = Field(foreign_key="image_asset.id")
    created_at: datetime = Field(default_factory=utcnow)


class GenerationJob(SQLModel, table=True):
    __tablename__ = "generation_job"

    id: str = Field(default_factory=gen_uuid, primary_key=True)
    type: str  # character_base | reference_expansion | compose_look
    character_id: Optional[str] = Field(default=None, foreign_key="character.id")
    inputs: dict = Field(default_factory=dict, sa_column=Column(JSON))
    output_image_ids: list = Field(default_factory=list, sa_column=Column(JSON))
    provider: str
    model: str
    cost_estimate_usd: float = 0.0
    status: str = "pending"  # pending | success | failed
    error_message: Optional[str] = None
    duration_ms: Optional[int] = None
    created_at: datetime = Field(default_factory=utcnow, index=True)


class FeedPost(SQLModel, table=True):
    __tablename__ = "feed_post"

    id: str = Field(default_factory=gen_uuid, primary_key=True)
    character_id: str = Field(foreign_key="character.id")
    image_id: str = Field(foreign_key="image_asset.id")
    slots: dict = Field(default_factory=dict, sa_column=Column(JSON))
    scene: str = ""
    created_at: datetime = Field(default_factory=utcnow, index=True)
