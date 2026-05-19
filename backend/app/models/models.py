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


class WorldLocation(SQLModel, table=True):
    """A recurring place in the character's world — their home, regular
    cafe, frequented street, etc. Each location has 1..N reference images
    so the model can render the SAME place consistently across feed posts.
    """

    __tablename__ = "world_location"

    id: str = Field(default_factory=gen_uuid, primary_key=True)
    name: str
    notes: Optional[str] = None
    created_at: datetime = Field(default_factory=utcnow)

    images: list["WorldLocationImage"] = Relationship(
        back_populates="location",
        sa_relationship_kwargs={
            "cascade": "all, delete-orphan",
            "order_by": "WorldLocationImage.sort_order",
        },
    )


class WorldLocationImage(SQLModel, table=True):
    __tablename__ = "world_location_image"
    __table_args__ = (
        Index("ix_worldlocationimage_loc_order", "location_id", "sort_order"),
    )

    id: str = Field(default_factory=gen_uuid, primary_key=True)
    location_id: str = Field(foreign_key="world_location.id")
    image_id: str = Field(foreign_key="image_asset.id")
    sort_order: int = Field(default=0)
    created_at: datetime = Field(default_factory=utcnow)

    location: WorldLocation = Relationship(back_populates="images")


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
    scene: str = ""  # the free-form compose prompt the user entered
    # Snapshot of the non-FeedPost-column compose params at save time:
    # character_reference_ids, view, capture_style, weather, season,
    # time_of_day, anchor_image_id, quality. Used to re-load the exact
    # compose state ("이 설정으로 다시 합성") later.
    compose_params: dict = Field(default_factory=dict, sa_column=Column(JSON))
    caption: Optional[str] = None  # IG caption draft
    hashtags: list = Field(default_factory=list, sa_column=Column(JSON))
    # When set, the user has marked this post as already published on
    # Instagram. Null = still a draft / unposted.
    posted_at: Optional[datetime] = None
    # Set when the post is actually published via the Instagram Graph API.
    # This is the IG media id Meta returns; lets us link back to the live
    # post and avoid double-publishing.
    ig_media_id: Optional[str] = None
    ig_account_id: Optional[str] = Field(default=None, foreign_key="instagram_account.id")
    created_at: datetime = Field(default_factory=utcnow, index=True)


class InstagramAccount(SQLModel, table=True):
    """One row per connected IG Business/Creator account. The user can link
    multiple accounts (multi-account workflow). access_token is the long-lived
    token (60 days) — refresh it lazily before expiry."""

    __tablename__ = "instagram_account"

    id: str = Field(default_factory=gen_uuid, primary_key=True)
    # The ID Meta assigns to the IG professional account. Used as the path
    # parameter in publish API calls. Unique across the table.
    ig_user_id: str = Field(unique=True, index=True)
    username: str  # display only; mutable on IG side, so we re-fetch sometimes
    access_token: str  # long-lived (60d)
    token_expires_at: datetime
    # Free-form note the user can attach ("메인 계정", "스토어용" 등).
    label: Optional[str] = None
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)
