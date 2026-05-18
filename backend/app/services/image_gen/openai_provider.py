import base64
import io
import logging
import time
from typing import Any

import httpx
from PIL import Image

from app.config import settings
from app.services.image_gen.base import ImageGenProvider, ImageGenRequest, ImageGenResult
from app.services.storage import storage_service


logger = logging.getLogger(__name__)


class OpenAIProviderError(Exception):
    """Raised when OpenAI image API returns a non-2xx. Carries the parsed
    error so downstream layers can surface a useful message to the user
    (especially for moderation_blocked, which is policy not bug)."""

    def __init__(self, status_code: int, body: str):
        self.status_code = status_code
        self.body = body
        message = body
        # OpenAI returns structured JSON for errors; pull the human message
        # out if present so the job's error_message is readable.
        try:
            import json

            parsed = json.loads(body)
            err = parsed.get("error") if isinstance(parsed, dict) else None
            if err:
                code = err.get("code") or err.get("type") or ""
                msg = err.get("message") or ""
                message = f"[{code}] {msg}" if code else msg
        except Exception:
            pass
        super().__init__(f"OpenAI {status_code}: {message}")


# GPT Image models return b64_json by default and use output_format for file type.

OPENAI_IMAGE_MODEL = "gpt-image-2"

QUALITY_MAP = {
    "low": "low",
    "medium": "medium",
    "high": "high",
}

# OpenAI only renders these sizes; 4:5 portrait must be requested as 1024x1536
# and post-cropped, because 1024x1280 isn't a supported direct output.
SIZE_MAP = {
    "1:1": "1024x1024",
    "4:5": "1024x1536",
    "2:3": "1024x1536",
}

# What we actually persist after post-crop. Keys mirror SIZE_MAP.
ASPECT_RATIOS: dict[str, tuple[int, int] | None] = {
    "1:1": (1, 1),
    "4:5": (4, 5),
    "2:3": (2, 3),
}


def _normalize_to_target_aspect(img_bytes: bytes, requested_aspect: str) -> bytes:
    """Center-crop image bytes to match the requested aspect ratio.

    OpenAI returns 1024x1536 for any portrait request, but "4:5" callers want
    1024x1280 (Instagram portrait). We let the model compose into the taller
    canvas and crop the excess top/bottom so the final asset matches what the
    rest of the app (UI containers, Instagram export) expects.
    """
    target = ASPECT_RATIOS.get(requested_aspect)
    if not target:
        return img_bytes
    tw, th = target
    target_ratio = tw / th

    img = Image.open(io.BytesIO(img_bytes))
    w, h = img.size
    current_ratio = w / h
    if abs(current_ratio - target_ratio) < 0.01:
        return img_bytes

    if current_ratio > target_ratio:
        new_w = round(h * target_ratio)
        left = (w - new_w) // 2
        cropped = img.crop((left, 0, left + new_w, h))
    else:
        new_h = round(w / target_ratio)
        top = (h - new_h) // 2
        cropped = img.crop((0, top, w, top + new_h))

    out = io.BytesIO()
    cropped.save(out, format=img.format or "PNG")
    return out.getvalue()

COST_PER_IMAGE = {
    "low": 0.02,
    "medium": 0.07,
    "high": 0.19,
}

HTTP_TIMEOUT = httpx.Timeout(300.0, connect=30.0)


class OpenAIProvider(ImageGenProvider):
    def __init__(self):
        self.api_key = settings.openai_api_key
        if not self.api_key:
            raise ValueError("OPENAI_API_KEY is not set")

    async def generate(self, req: ImageGenRequest) -> ImageGenResult:
        start = time.monotonic()

        if req.references:
            result = await self._generate_with_references(req)
        else:
            result = await self._generate_text_only(req)

        duration_ms = int((time.monotonic() - start) * 1000)
        result.duration_ms = duration_ms
        return result

    async def _generate_text_only(self, req: ImageGenRequest) -> ImageGenResult:
        size = SIZE_MAP.get(req.aspect_ratio, "1024x1024")
        quality = QUALITY_MAP.get(req.quality, "medium")

        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
            resp = await client.post(
                "https://api.openai.com/v1/images/generations",
                headers={"Authorization": f"Bearer {self.api_key}"},
                json={
                    "model": OPENAI_IMAGE_MODEL,
                    "prompt": req.prompt,
                    "n": req.count,
                    "size": size,
                    "quality": quality,
                    "output_format": "png",
                },
            )
            if resp.status_code != 200:
                logger.error("OpenAI generations error %s: %s", resp.status_code, resp.text)
                raise OpenAIProviderError(resp.status_code, resp.text)
            data = resp.json()

        assets = []
        for item in data["data"]:
            img_bytes = base64.b64decode(item["b64_json"])
            img_bytes = _normalize_to_target_aspect(img_bytes, req.aspect_ratio)
            asset = storage_service.save_image(
                img_bytes, "image/png", "generated"
            )
            assets.append(asset)

        cost = COST_PER_IMAGE.get(req.quality, 0.07) * len(assets)
        return ImageGenResult(
            image_assets=assets,
            cost_estimate_usd=cost,
            raw_response=data,
            duration_ms=0,
        )

    async def _generate_with_references(self, req: ImageGenRequest) -> ImageGenResult:
        size = SIZE_MAP.get(req.aspect_ratio, "1024x1024")
        quality = QUALITY_MAP.get(req.quality, "medium")

        # OpenAI requires `image` for a single reference, `image[]` (repeated)
        # for multiple references — using `image` twice fails with
        # `duplicate_parameter`.
        field_name = "image" if len(req.references) == 1 else "image[]"
        files: list[tuple[str, tuple[str, Any, str]]] = []
        for i, ref in enumerate(req.references):
            img_bytes = storage_service.load_image_bytes(ref["image_id"])
            files.append(
                (field_name, (f"ref_{i}.png", io.BytesIO(img_bytes), "image/png"))
            )

        form_data = {
            "model": OPENAI_IMAGE_MODEL,
            "prompt": req.prompt,
            "n": str(req.count),
            "size": size,
            "quality": quality,
            "output_format": "png",
        }

        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
            resp = await client.post(
                "https://api.openai.com/v1/images/edits",
                headers={"Authorization": f"Bearer {self.api_key}"},
                data=form_data,
                files=files,
            )
            if resp.status_code != 200:
                logger.error("OpenAI edits error %s: %s", resp.status_code, resp.text)
                raise OpenAIProviderError(resp.status_code, resp.text)
            data = resp.json()

        assets = []
        for item in data["data"]:
            img_bytes = base64.b64decode(item["b64_json"])
            img_bytes = _normalize_to_target_aspect(img_bytes, req.aspect_ratio)
            asset = storage_service.save_image(
                img_bytes, "image/png", "generated"
            )
            assets.append(asset)

        base_cost = COST_PER_IMAGE.get(req.quality, 0.07)
        ref_cost = 0.01 * len(req.references)
        cost = (base_cost + ref_cost) * len(assets)

        return ImageGenResult(
            image_assets=assets,
            cost_estimate_usd=cost,
            raw_response=data,
            duration_ms=0,
        )
