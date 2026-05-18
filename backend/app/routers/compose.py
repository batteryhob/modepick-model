from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel

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
