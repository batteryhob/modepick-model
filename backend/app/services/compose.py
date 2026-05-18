import logging
import random
import time

from sqlmodel import Session, select

from app.database import engine
from app.models import (
    Character,
    CharacterReference,
    GenerationJob,
    MoodReference,
    WardrobeItem,
)
from app.services.cost_guard import assert_daily_budget_available
from app.services.image_gen.base import ImageGenRequest
from app.services.image_gen.factory import get_provider


logger = logging.getLogger(__name__)


REFERENCE_LIMITS = {"openai": 16, "gemini": 14}

SLOT_CATEGORIES = ["top", "bottom", "outerwear", "dress", "bag", "shoes"]

# Order mirrors character.py — identity refs first (face from multiple
# angles + expressions), body shots last. This means picking N character
# refs for a compose call gives the model the strongest possible identity
# signal at any N, with body coverage layered in once N reaches 6+.
COMPOSE_ROLES_BY_PRIORITY = [
    "FACE_FRONT",
    "FACE_SIDE_L",
    "FACE_SIDE_R",
    "EXPRESSION_SMILE",
    "EXPRESSION_CALM",
    "FACE_PROFILE",
    "HALF_BODY",
    "FULL_BODY",
]

# Camera framing / shot type the user can choose for the compose result.
# Each value maps to a prompt fragment that instructs the model on framing.
VIEW_PROMPTS: dict[str, str] = {
    "FULL_BODY": (
        "Full-body shot, entire figure visible from head to feet, "
        "natural standing pose, vertical composition."
    ),
    "HALF_BODY": (
        "Half-body shot from waist up, medium framing, natural pose."
    ),
    "THREE_QUARTER": (
        "Three-quarter shot from knees up, dynamic body angle, slight body turn."
    ),
    "CLOSE_UP": (
        "Close-up portrait, head and shoulders only, intimate editorial framing."
    ),
    "PROFILE": (
        "Side profile view, subject facing 90 degrees away from camera, "
        "showcasing silhouette and outfit from the side."
    ),
    "BACK": (
        "Back view, subject facing away from camera, "
        "highlighting outfit details from behind."
    ),
    "HIGH_ANGLE": (
        "High angle shot, camera positioned above the subject looking down, "
        "subject looking up or slightly sideways."
    ),
    "LOW_ANGLE": (
        "Low angle shot, camera positioned below the subject looking up, "
        "dramatic perspective emphasizing height."
    ),
}
DEFAULT_VIEW = "FULL_BODY"
RANDOM_VIEW = "RANDOM"


def _resolve_view(view: str | None) -> str:
    if view == RANDOM_VIEW:
        return random.choice(list(VIEW_PROMPTS.keys()))
    if view and view in VIEW_PROMPTS:
        return view
    return DEFAULT_VIEW


def _build_compose_prompt(
    character: Character,
    filled_slots: dict[str, WardrobeItem],
    empty_slots: list[str],
    mood: MoodReference | None,
    scene: str,
    char_ref_positions: list[int],
    product_ref_positions: dict[str, list[int]],
    mood_ref_position: int | None,
    view: str,
) -> str:
    lines = []

    if char_ref_positions:
        ref_nums = ", ".join(str(n) for n in char_ref_positions)
        lines.append(
            f"Generate a photorealistic image of the SAME person shown in reference images {ref_nums}. "
            "Maintain exact same face, skin tone, hair color, hair style."
        )

    for cat, item in filled_slots.items():
        positions = product_ref_positions.get(cat, [])
        if not positions:
            continue
        # Only the bag slot currently surfaces a `size` hint in the prompt.
        size_hint = f" ({item.size})" if cat == "bag" and item.size else ""
        if len(positions) == 1:
            lines.append(
                f"For the {cat}{size_hint}: use the exact product from reference image {positions[0]}. "
                "Preserve color, pattern, logo, and fabric texture precisely."
            )
        else:
            ref_nums = ", ".join(str(n) for n in positions)
            lines.append(
                f"For the {cat}{size_hint}: use the exact product shown in reference images {ref_nums} "
                "(multiple views/angles of the same product). "
                "Preserve color, pattern, logo, and fabric texture precisely."
            )

    if empty_slots:
        persona = character.persona or {}
        style = persona.get("style", "modern casual")
        palette = persona.get("color_palette", "neutral")
        slot_list = ", ".join(empty_slots)
        lines.append(
            f"For unselected items ({slot_list}): generate them naturally to match "
            f"the overall aesthetic. Style: {style}. Color palette: {palette}."
        )

    if mood and mood_ref_position is not None:
        lines.append(
            f"Apply the lighting, color grading, and atmosphere from reference image {mood_ref_position}. "
            "Do NOT copy the people or objects from this reference, only the mood/lighting."
        )

    if scene:
        # Free-form prompt addition from the user (scene description, extra
        # styling directives, accessories, mood notes — anything they type).
        lines.append(scene)

    lines.append(VIEW_PROMPTS[view])
    lines.append("4:5 aspect ratio, editorial quality, professional photography.")

    return "\n".join(lines)


def _prepare_compose_inputs(
    session: Session,
    character_id: str,
    slots: dict,
    scene: str,
    provider_name: str,
    quality: str,
    character_reference_count: int = 1,
    view: str = DEFAULT_VIEW,
) -> dict:
    view = _resolve_view(view)
    # 1. Load character + references
    character = session.get(Character, character_id)
    if not character:
        raise ValueError(f"Character {character_id} not found")

    character_reference_count = max(1, min(character_reference_count, 8))

    char_refs = session.exec(
        select(CharacterReference).where(
            CharacterReference.character_id == character_id,
        )
    ).all()
    refs_by_role = {r.role: r for r in char_refs}
    selected_char_refs = [
        refs_by_role[role]
        for role in COMPOSE_ROLES_BY_PRIORITY
        if role in refs_by_role
    ][:character_reference_count]

    # 2. Build reference list with indexed positions
    references: list[dict] = []
    char_ref_positions: list[int] = []
    product_ref_positions: dict[str, list[int]] = {}
    mood_ref_position: int | None = None

    # Character references
    for ref in selected_char_refs:
        pos = len(references) + 1
        references.append({"role": f"character_{ref.role}", "image_id": ref.image_id})
        char_ref_positions.append(pos)

    # 3. Collect filled slots — each wardrobe item contributes all its images
    filled_slots: dict[str, WardrobeItem] = {}
    empty_slots: list[str] = []

    for cat in SLOT_CATEGORIES:
        item_id = slots.get(cat)
        if not item_id:
            empty_slots.append(cat)
            continue
        item = session.get(WardrobeItem, item_id)
        if not item or not item.images:
            empty_slots.append(cat)
            continue
        filled_slots[cat] = item
        positions = []
        for img in item.images:
            pos = len(references) + 1
            references.append(
                {"role": f"product_{cat}_{img.sort_order}", "image_id": img.image_id}
            )
            positions.append(pos)
        product_ref_positions[cat] = positions

    # 4. Mood reference
    mood: MoodReference | None = None
    mood_id = slots.get("mood")
    if mood_id:
        mood = session.get(MoodReference, mood_id)
        if mood:
            mood_ref_position = len(references) + 1
            references.append({"role": "mood", "image_id": mood.image_id})

    # 5. Check reference limit
    limit = REFERENCE_LIMITS.get(provider_name, 16)
    if len(references) > limit:
        raise ValueError(
            f"Too many references ({len(references)}). "
            f"Max for {provider_name}: {limit}. "
            "Reduce character reference count or pick fewer items."
        )

    assert_daily_budget_available(estimate_cost(provider_name, quality, len(references)))

    prompt = _build_compose_prompt(
        character,
        filled_slots,
        empty_slots,
        mood,
        scene,
        char_ref_positions,
        product_ref_positions,
        mood_ref_position,
        view,
    )

    return {
        "prompt": prompt,
        "references": references,
        "selected_char_refs": selected_char_refs,
        "view": view,
    }


def enqueue_compose_look(
    character_id: str,
    slots: dict,
    scene: str,
    provider_name: str,
    quality: str,
    character_reference_count: int = 1,
    view: str = DEFAULT_VIEW,
) -> str:
    with Session(engine) as session:
        prepared = _prepare_compose_inputs(
            session,
            character_id,
            slots,
            scene,
            provider_name,
            quality,
            character_reference_count,
            view,
        )
        references = prepared["references"]
        prompt = prepared["prompt"]
        selected_char_refs = prepared["selected_char_refs"]
        resolved_view = prepared["view"]

        job = GenerationJob(
            type="compose_look",
            character_id=character_id,
            inputs={
                "prompt": prompt,
                "reference_image_ids": [
                    {"role": r["role"], "image_id": r["image_id"]} for r in references
                ],
                "character_reference_count": len(selected_char_refs),
                "slots": slots,
                "scene": scene,
                "quality": quality,
                "view": resolved_view,
            },
            provider=provider_name,
            model=f"{provider_name}-image",
            status="pending",
        )
        session.add(job)
        session.commit()
        session.refresh(job)
        return job.id


async def run_compose_job(job_id: str) -> None:
    with Session(engine) as session:
        job = session.get(GenerationJob, job_id)
        if not job:
            return
        prompt = job.inputs.get("prompt", "")
        references = job.inputs.get("reference_image_ids", [])
        quality = job.inputs.get("quality", "medium")
        provider_name = job.provider

    start = time.monotonic()
    try:
        provider = get_provider(provider_name)
        result = await provider.generate(
            ImageGenRequest(
                prompt=prompt,
                references=references,
                aspect_ratio="4:5",
                quality=quality,
            )
        )

        duration_ms = int((time.monotonic() - start) * 1000)
        with Session(engine) as session:
            job = session.get(GenerationJob, job_id)
            if not job:
                return
            job.status = "success"
            job.output_image_ids = [a.id for a in result.image_assets]
            job.cost_estimate_usd = result.cost_estimate_usd
            job.duration_ms = duration_ms
            session.commit()
    except Exception as e:
        logger.exception("compose job %s failed", job_id)
        duration_ms = int((time.monotonic() - start) * 1000)
        with Session(engine) as session:
            job = session.get(GenerationJob, job_id)
            if not job:
                return
            job.status = "failed"
            job.error_message = str(e)
            job.duration_ms = duration_ms
            session.commit()


def estimate_cost(provider: str, quality: str, ref_count: int) -> float:
    base_costs = {
        "openai": {"low": 0.02, "medium": 0.07, "high": 0.19},
        "gemini": {"low": 0.01, "medium": 0.04, "high": 0.10},
    }
    base = base_costs.get(provider, {}).get(quality, 0.07)
    ref_cost = 0.01 * ref_count
    return round(base + ref_cost, 3)
