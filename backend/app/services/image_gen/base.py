from abc import ABC, abstractmethod
from dataclasses import dataclass, field

from app.models import ImageAsset


@dataclass
class ImageGenRequest:
    prompt: str
    references: list[dict] = field(default_factory=list)  # [{role, image_id}]
    aspect_ratio: str = "4:5"  # "1:1" | "4:5" | "2:3"
    quality: str = "medium"  # "low" | "medium" | "high"
    count: int = 1


@dataclass
class ImageGenResult:
    image_assets: list[ImageAsset]
    cost_estimate_usd: float
    raw_response: dict
    duration_ms: int


class ImageGenProvider(ABC):
    @abstractmethod
    async def generate(self, req: ImageGenRequest) -> ImageGenResult:
        ...
