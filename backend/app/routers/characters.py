from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel

from app.schemas.character import CharacterCreateRequest
from app.services.character import (
    activate_character,
    create_character,
    delete_character,
    enqueue_character_creation,
    enqueue_character_reference_expansion,
    expand_character_references,
    get_character,
    list_characters,
)


class ExpandReferencesRequest(BaseModel):
    target_count: int = 8
    provider: str = "openai"

router = APIRouter(prefix="/api/characters", tags=["characters"])


@router.get("")
def list_all():
    return list_characters()


@router.get("/{character_id}")
def get_one(character_id: str):
    c = get_character(character_id)
    if not c:
        raise HTTPException(404, "Character not found")
    return c


@router.post("", status_code=202)
def create(req: CharacterCreateRequest, background_tasks: BackgroundTasks):
    try:
        job_id = enqueue_character_creation(
            req.name,
            req.persona,
            req.provider,
            req.reference_count,
            anchor_character_id=req.anchor_character_id,
        )
        background_tasks.add_task(
            create_character,
            req.name,
            req.persona,
            req.provider,
            job_id,
            req.reference_count,
            req.anchor_character_id,
        )
        return {"job_id": job_id, "status": "pending"}
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.patch("/{character_id}/activate")
def activate(character_id: str):
    try:
        return activate_character(character_id)
    except ValueError as e:
        raise HTTPException(404, str(e))


@router.post("/{character_id}/expand-references", status_code=202)
def expand_references(
    character_id: str,
    req: ExpandReferencesRequest,
    background_tasks: BackgroundTasks,
):
    try:
        job_id, missing = enqueue_character_reference_expansion(
            character_id, req.target_count, req.provider
        )
    except ValueError as e:
        raise HTTPException(400, str(e))

    background_tasks.add_task(
        expand_character_references, character_id, job_id, req.provider
    )
    return {"job_id": job_id, "status": "pending", "missing_roles": missing}


@router.delete("/{character_id}", status_code=204)
def delete(character_id: str):
    delete_character(character_id)
