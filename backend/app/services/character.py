import logging

from sqlmodel import Session, select

from app.database import engine
from app.models import Character, CharacterReference, GenerationJob, utcnow
from app.services.cost_guard import assert_daily_budget_available
from app.services.image_gen.base import ImageGenRequest
from app.services.image_gen.factory import get_provider
from app.services.storage import storage_service


logger = logging.getLogger(__name__)


REFERENCE_ROLES_BY_PRIORITY = [
    "FULL_BODY",
    "HALF_BODY",
    "EXPRESSION_SMILE",
    "FACE_SIDE_L",
    "FACE_SIDE_R",
    "EXPRESSION_CALM",
    "FACE_PROFILE",
]

# Character creation must produce a usable result quickly. Extra reference
# expansion should be a separate job, not part of the first-create request.
INITIAL_REFERENCE_ROLE = "FACE_FRONT"


def _build_base_prompt(persona: dict, has_anchor: bool = False) -> str:
    if has_anchor:
        intro = (
            "Generate a photorealistic portrait of the SAME person shown in the reference images. "
            "Maintain exact same face, skin tone, hair color, hair style, and features."
        )
    else:
        intro = "Generate a photorealistic portrait of a virtual influencer."
    parts = [
        intro,
        f"Age: {persona.get('age', '20s')}.",
        f"Heritage/ethnicity: {persona.get('heritage', '')}.",
        f"Appearance: {persona.get('appearance', '')}.",
        f"Body type: {persona.get('body_type', 'slim')}.",
        f"Style: {persona.get('style', 'modern casual')}.",
        f"Color palette preference: {persona.get('color_palette', 'neutral')}.",
        "Clean background. Front-facing. Shoulders up.",
        "High quality, editorial magazine style photo.",
    ]
    return " ".join(p for p in parts if p)


def _load_anchor_references(anchor_character_id: str | None) -> list[dict]:
    """Return reference dicts (role, image_id) for the anchor character's
    base + saved references, de-duped. Empty list if no anchor."""
    if not anchor_character_id:
        return []
    with Session(engine) as session:
        anchor = session.get(Character, anchor_character_id)
        if not anchor:
            return []
        refs: list[dict] = [
            {"role": "anchor_BASE", "image_id": anchor.base_image_id}
        ]
        seen = {anchor.base_image_id}
        for ref in anchor.references:
            if ref.image_id in seen:
                continue
            refs.append({"role": f"anchor_{ref.role}", "image_id": ref.image_id})
            seen.add(ref.image_id)
        # Cap at 8 — providers limit total refs per call.
        return refs[:8]


def _build_reference_prompt(persona: dict, role: str) -> str:
    base = (
        "Generate another view of the SAME person from the reference image. "
        "Maintain exact same face, skin tone, hair color, hair style, and features. "
    )

    role_instructions = {
        "FACE_FRONT": "Front-facing portrait, shoulders up, neutral expression.",
        "FACE_SIDE_L": "Left 3/4 view portrait, showing left side of face.",
        "FACE_SIDE_R": "Right 3/4 view portrait, showing right side of face.",
        "FACE_PROFILE": "Full side profile view, 90 degrees.",
        "EXPRESSION_SMILE": "Front-facing portrait with a warm, natural smile.",
        "EXPRESSION_CALM": "Front-facing portrait with a calm, serene expression.",
        "HALF_BODY": "Half-body shot from waist up, casual pose, clean background.",
        "FULL_BODY": "Full-body standing shot, relaxed pose, clean background.",
    }

    instruction = role_instructions.get(role, "Front-facing portrait.")
    return f"{base}{instruction} Style: {persona.get('style', 'modern casual')}."


def _clamp_reference_count(reference_count: int) -> int:
    return max(1, min(reference_count, 8))


def _aspect_ratio_for_role(role: str) -> str:
    return "1:1" if "FACE" in role or "EXPRESSION" in role else "2:3"


async def _generate_and_persist_reference(
    provider,
    persona: dict,
    base_image_id: str,
    role: str,
    character_id: str,
) -> tuple[str, float]:
    """Generate one CharacterReference image off the base, persist the row,
    and return (image_id, cost_estimate_usd). Used by both initial create
    and the later expansion flow."""
    prompt = _build_reference_prompt(persona, role)
    result = await provider.generate(
        ImageGenRequest(
            prompt=prompt,
            references=[{"role": "base", "image_id": base_image_id}],
            aspect_ratio=_aspect_ratio_for_role(role),
            quality="low",
        )
    )
    ref_asset = result.image_assets[0]
    with Session(engine) as session:
        session.add(
            CharacterReference(
                character_id=character_id,
                role=role,
                image_id=ref_asset.id,
            )
        )
        session.commit()
    return ref_asset.id, result.cost_estimate_usd


def enqueue_character_creation(
    name: str,
    persona: dict,
    provider_name: str,
    reference_count: int = 1,
    anchor_character_id: str | None = None,
) -> str:
    reference_count = _clamp_reference_count(reference_count)
    assert_daily_budget_available(reference_count * 0.02)
    with Session(engine) as session:
        job = GenerationJob(
            type="character_create",
            inputs={
                "name": name,
                "persona": persona,
                "reference_count": reference_count,
                "anchor_character_id": anchor_character_id,
            },
            provider=provider_name,
            model=f"{provider_name}-image",
            status="pending",
        )
        session.add(job)
        session.commit()
        session.refresh(job)
        return job.id


async def create_character(
    name: str,
    persona: dict,
    provider_name: str,
    job_id: str | None = None,
    reference_count: int = 1,
    anchor_character_id: str | None = None,
) -> dict | None:
    reference_count = _clamp_reference_count(reference_count)
    provider = get_provider(provider_name)
    started_at = utcnow()

    def update_job(**fields) -> None:
        if not job_id:
            return
        with Session(engine) as session:
            job = session.get(GenerationJob, job_id)
            if not job:
                return
            for key, value in fields.items():
                setattr(job, key, value)
            session.commit()

    try:
        # Step 1: Generate base image. With an anchor, we use the anchor's
        # existing images as references so the new image stays the same person.
        anchor_refs = _load_anchor_references(anchor_character_id)
        base_prompt = _build_base_prompt(persona, has_anchor=bool(anchor_refs))
        base_result = await provider.generate(
            ImageGenRequest(
                prompt=base_prompt,
                references=anchor_refs,
                aspect_ratio="1:1",
                quality="low",
            )
        )
        base_asset = base_result.image_assets[0]

        # Create character record
        with Session(engine) as session:
            character = Character(
                name=name,
                persona=persona,
                base_image_id=base_asset.id,
                is_active=False,
            )
            session.add(character)
            session.commit()
            session.refresh(character)
            char_id = character.id

        with Session(engine) as session:
            ref = CharacterReference(
                character_id=char_id,
                role=INITIAL_REFERENCE_ROLE,
                image_id=base_asset.id,
            )
            session.add(ref)
            session.commit()

        output_image_ids = [base_asset.id]
        total_cost = base_result.cost_estimate_usd
        update_job(
            character_id=char_id,
            output_image_ids=output_image_ids,
        )

        extra_roles = REFERENCE_ROLES_BY_PRIORITY[: reference_count - 1]
        for role in extra_roles:
            ref_image_id, cost = await _generate_and_persist_reference(
                provider, persona, base_asset.id, role, char_id
            )
            output_image_ids.append(ref_image_id)
            total_cost += cost
            update_job(output_image_ids=output_image_ids, cost_estimate_usd=total_cost)

        duration_ms = int((utcnow() - started_at).total_seconds() * 1000)
        update_job(
            character_id=char_id,
            status="success",
            output_image_ids=output_image_ids,
            duration_ms=duration_ms,
            cost_estimate_usd=total_cost,
        )
        return get_character(char_id)
    except Exception as e:
        logger.exception("character_create job %s failed", job_id)
        duration_ms = int((utcnow() - started_at).total_seconds() * 1000)
        update_job(status="failed", error_message=str(e), duration_ms=duration_ms)
        raise


def list_characters() -> list[dict]:
    with Session(engine) as session:
        stmt = select(Character).order_by(Character.created_at.desc())
        chars = list(session.exec(stmt).all())
        return [_char_to_dict(session, c) for c in chars]


def get_character(character_id: str) -> dict | None:
    with Session(engine) as session:
        character = session.get(Character, character_id)
        if not character:
            return None
        return _char_to_dict(session, character)


def activate_character(character_id: str) -> dict:
    with Session(engine) as session:
        all_chars = session.exec(select(Character)).all()
        for c in all_chars:
            c.is_active = False
        character = session.get(Character, character_id)
        if not character:
            raise ValueError(f"Character {character_id} not found")
        character.is_active = True
        character.updated_at = utcnow()
        session.commit()
        return _char_to_dict(session, character)


def _missing_roles(existing_roles: set[str], target_count: int) -> list[str]:
    """Roles to generate (in priority order) to bring the character up to
    `target_count` total references. FACE_FRONT is treated as already present
    because it aliases the base image."""
    candidates = [r for r in REFERENCE_ROLES_BY_PRIORITY if r not in existing_roles]
    needed = max(0, target_count - len(existing_roles))
    return candidates[:needed]


def enqueue_character_reference_expansion(
    character_id: str,
    target_count: int,
    provider_name: str,
) -> tuple[str, list[str]]:
    """Enqueue a job to expand the character to `target_count` references.

    Returns (job_id, missing_roles). Raises ValueError if there is nothing to
    do, if a pending expansion job for the same character already exists, or
    if the daily budget would be exceeded.
    """
    target_count = _clamp_reference_count(target_count)
    with Session(engine) as session:
        character = session.get(Character, character_id)
        if not character:
            raise ValueError(f"Character {character_id} not found")

        existing_roles = {ref.role for ref in character.references}
        missing = _missing_roles(existing_roles, target_count)
        if not missing:
            raise ValueError(
                f"Character already has {len(existing_roles)} reference(s); "
                f"nothing to add to reach {target_count}."
            )

        in_flight = session.exec(
            select(GenerationJob).where(
                GenerationJob.type == "character_reference_expansion",
                GenerationJob.character_id == character_id,
                GenerationJob.status == "pending",
            )
        ).first()
        if in_flight:
            raise ValueError("A reference expansion is already in progress for this character.")

    assert_daily_budget_available(len(missing) * 0.02)

    with Session(engine) as session:
        job = GenerationJob(
            type="character_reference_expansion",
            character_id=character_id,
            inputs={
                "target_count": target_count,
                "missing_roles": missing,
            },
            provider=provider_name,
            model=f"{provider_name}-image",
            status="pending",
        )
        session.add(job)
        session.commit()
        session.refresh(job)
        return job.id, missing


async def expand_character_references(
    character_id: str,
    job_id: str,
    provider_name: str,
) -> None:
    """Background task: generate the `missing_roles` recorded in the job's
    inputs, persisting each CharacterReference as it succeeds so partial
    progress is visible if the job fails midway."""
    provider = get_provider(provider_name)
    started_at = utcnow()

    def update_job(**fields) -> None:
        with Session(engine) as session:
            job = session.get(GenerationJob, job_id)
            if not job:
                return
            for key, value in fields.items():
                setattr(job, key, value)
            session.commit()

    try:
        with Session(engine) as session:
            character = session.get(Character, character_id)
            if not character:
                raise ValueError(f"Character {character_id} not found")
            persona = character.persona or {}
            base_image_id = character.base_image_id

            job = session.get(GenerationJob, job_id)
            missing = list(job.inputs.get("missing_roles", [])) if job else []
            if not missing:
                raise ValueError("No missing roles recorded on the expansion job.")

        output_image_ids: list[str] = []
        total_cost = 0.0

        for role in missing:
            ref_image_id, cost = await _generate_and_persist_reference(
                provider, persona, base_image_id, role, character_id
            )
            output_image_ids.append(ref_image_id)
            total_cost += cost
            update_job(output_image_ids=output_image_ids, cost_estimate_usd=total_cost)

        duration_ms = int((utcnow() - started_at).total_seconds() * 1000)
        update_job(
            status="success",
            output_image_ids=output_image_ids,
            duration_ms=duration_ms,
            cost_estimate_usd=total_cost,
        )
    except Exception as e:
        logger.exception("character_reference_expansion job %s failed", job_id)
        duration_ms = int((utcnow() - started_at).total_seconds() * 1000)
        update_job(status="failed", error_message=str(e), duration_ms=duration_ms)
        raise


def delete_character(character_id: str) -> None:
    with Session(engine) as session:
        character = session.get(Character, character_id)
        if not character:
            return

        refs = list(session.exec(
            select(CharacterReference).where(CharacterReference.character_id == character_id)
        ).all())
        image_ids = list(dict.fromkeys([character.base_image_id, *[ref.image_id for ref in refs]]))

        for ref in refs:
            session.delete(ref)
        session.delete(character)
        session.flush()

        for img_id in image_ids:
            storage_service.delete_asset_if_unreferenced(session, img_id)

        session.commit()


def _char_to_dict(session: Session, c: Character) -> dict:
    refs = list(session.exec(
        select(CharacterReference).where(CharacterReference.character_id == c.id)
    ).all())
    return {
        "id": c.id,
        "name": c.name,
        "persona": c.persona,
        "base_image_id": c.base_image_id,
        "is_active": c.is_active,
        "created_at": c.created_at.isoformat(),
        "updated_at": c.updated_at.isoformat(),
        "references": [
            {"id": r.id, "role": r.role, "image_id": r.image_id}
            for r in refs
        ],
    }
