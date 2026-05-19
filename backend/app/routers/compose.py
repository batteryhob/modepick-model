from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel, Field

from app.services.compose import enqueue_compose_look, estimate_cost, run_compose_job

router = APIRouter(prefix="/api", tags=["compose"])


class ComposeRequest(BaseModel):
    character_id: str
    slots: dict = {}
    scene: str = ""
    provider: str = "openai"
    quality: str = "medium"
    character_reference_ids: list[str] = []
    view: str = "RANDOM"
    capture_style: str = "AUTO"
    weather: str = "AUTO"
    season: str = "AUTO"
    time_of_day: str = "AUTO"
    # Generate 1–4 variants in one call so the user can pick the best.
    # Higher values multiply cost proportionally. Capped at 4 to keep
    # latency and per-click cost predictable.
    count: int = Field(default=1, ge=1, le=4)
    # When set, this is a previously-generated image (typically a result the
    # user wants to use as the basis for a variation series — same person /
    # outfit / styling, different view or scene).
    anchor_image_id: str | None = None


@router.post("/compose", status_code=202)
def compose(req: ComposeRequest, background_tasks: BackgroundTasks):
    try:
        job_id = enqueue_compose_look(
            character_id=req.character_id,
            slots=req.slots,
            scene=req.scene,
            provider_name=req.provider,
            quality=req.quality,
            character_reference_ids=req.character_reference_ids,
            view=req.view,
            capture_style=req.capture_style,
            weather=req.weather,
            season=req.season,
            time_of_day=req.time_of_day,
            count=req.count,
            anchor_image_id=req.anchor_image_id,
        )
        background_tasks.add_task(run_compose_job, job_id)

        return {"job_id": job_id, "status": "pending"}

    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(500, f"Generation failed: {e}")


@router.get("/compose/estimate")
def cost_estimate(provider: str = "openai", quality: str = "medium", ref_count: int = 6):
    return {"cost_estimate_usd": estimate_cost(provider, quality, ref_count)}
