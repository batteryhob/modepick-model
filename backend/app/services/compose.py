import logging
import random
import time

from sqlmodel import Session, select

from app.database import engine
from app.models import (
    Character,
    CharacterReference,
    GenerationJob,
    ImageAsset,
    MoodReference,
    WardrobeItem,
    WorldLocation,
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


# Weather — environmental condition that affects lighting, ground texture,
# wardrobe context, and mood. AUTO leaves it to the model + scene.
WEATHER_PROMPTS: dict[str, str] = {
    "SUNNY": "Bright clear sunny day with hard directional light and sharp shadows.",
    "CLOUDY": "Overcast cloudy sky, soft diffused light, no harsh shadows, slight cool color cast.",
    "RAINY": "Rainy day, wet pavement and reflections, light drizzle in the air, muted desaturated palette.",
    "SNOWING": "Snow falling, snow on the ground and surfaces, soft cool white light, winter mood.",
    "FOG": "Foggy misty atmosphere, low visibility, soft hazy diffused light, quiet mysterious mood.",
    "GOLDEN_SUNSET": "Golden hour at sunset, warm orange light pouring in from a low angle, long soft shadows.",
    "BLUE_HOUR": "Blue hour twilight, mixed warm artificial lights and cool ambient sky.",
}
DEFAULT_WEATHER = "AUTO"


def _resolve_weather(weather: str | None) -> str:
    if weather and weather in WEATHER_PROMPTS:
        return weather
    return DEFAULT_WEATHER


# Season — affects foliage, clothing context, light quality, ground state.
SEASON_PROMPTS: dict[str, str] = {
    "SPRING": "Spring season — cherry blossoms or fresh light-green foliage, soft pastel light, mild temperature, light layers.",
    "SUMMER": "Summer season — deep green foliage, strong direct sun, warm vibrant colors, summer clothing context.",
    "AUTUMN": "Autumn season — fallen leaves in warm orange/red/yellow tones, cooler temperature, sweater and jacket weather.",
    "WINTER": "Winter season — bare trees, cold quality of light, frost or snow on surfaces, heavy coat and scarf context.",
}
DEFAULT_SEASON = "AUTO"


def _resolve_season(season: str | None) -> str:
    if season and season in SEASON_PROMPTS:
        return season
    return DEFAULT_SEASON


# Time of day — affects light direction, color temperature, ambient mood.
# Overlaps somewhat with the realism lighting pool but exposed explicitly
# so the user can lock a consistent time across a feed series.
TIME_OF_DAY_PROMPTS: dict[str, str] = {
    "DAWN": "Just after dawn — very early morning soft cold light, quiet empty streets, mist still in the air.",
    "MORNING": "Mid-morning — fresh natural light, daytime energy, crisp colors.",
    "AFTERNOON": "Afternoon — full daylight, casual midday atmosphere.",
    "EVENING": "Early evening — low warm light, end-of-day mood, lengthening shadows.",
    "NIGHT": "Night — dark sky, streetlights and practical interior lights, urban evening vibe.",
}
DEFAULT_TIME_OF_DAY = "AUTO"


def _resolve_time_of_day(value: str | None) -> str:
    if value and value in TIME_OF_DAY_PROMPTS:
        return value
    return DEFAULT_TIME_OF_DAY


# Capture style — independent of view/framing. Tells the model WHO is
# holding the camera and what (if any) device is visible in the shot.
# Combined freely with any view: e.g. MIRROR_SELFIE + FULL_BODY = the
# classic Instagram OOTD mirror shot showing the whole outfit.
CAPTURE_STYLE_PROMPTS: dict[str, str] = {
    "SELFIE": (
        "Self-portrait selfie — the subject is taking the photo themselves "
        "with a smartphone front camera at arm's length. Subject's arm or "
        "hand holding the phone may be partly visible in frame. Intimate, "
        "everyday phone-photo feel."
    ),
    "MIRROR_SELFIE": (
        "Mirror selfie — the subject is photographing themselves in a mirror "
        "while holding up a smartphone, which IS visible in the mirror "
        "reflection in their hand. Casual setting (bedroom, hallway, fitting "
        "room). Outfit clearly visible in the mirror. Subject's actual face "
        "may be partly obscured by the phone, or visible above/beside it."
    ),
    "BY_OTHER": (
        "Photo taken by another person — not a selfie. No phone visible in "
        "the frame. Candid third-person perspective, subject being observed "
        "naturally."
    ),
}
DEFAULT_CAPTURE_STYLE = "AUTO"  # no specific directive — let view + scene decide


def _resolve_capture_style(style: str | None) -> str:
    if style and style in CAPTURE_STYLE_PROMPTS:
        return style
    return DEFAULT_CAPTURE_STYLE


def _camera_signature(capture_style: str) -> str:
    """The opening photo-realism directive shifts depending on capture style.
    Phone-camera language for selfies/mirror; DSLR language otherwise."""
    if capture_style == "SELFIE":
        return (
            "Captured with a smartphone front camera (selfie lens) — "
            "wide-angle, all-in-focus, slight characteristic phone-camera "
            "perspective distortion at close range."
        )
    if capture_style == "MIRROR_SELFIE":
        return (
            "Captured with a smartphone rear camera held by the subject, "
            "photographing the mirror reflection — wide-angle phone lens, "
            "all-in-focus, real phone-photo look."
        )
    return (
        "Shot on a 35mm full-frame camera, 50mm lens at f/2.8 — natural "
        "shallow depth of field with soft background separation."
    )


# ----------------------------------------------------------------------------
# Photo-realism prompt engineering.
#
# Strategy: rather than a single static block of directives (which the model
# learns to render in a recognizable way), we keep multiple specific options
# for each axis — lighting / pose / composition / film stock / photographer
# reference — and sample one of each per compose call. Three benefits:
#   1. Specificity beats genericity for image gen.
#   2. Per-call variation: "다시 생성" yields different vibes, same identity.
#   3. Photographer-style references nudge the model toward learned looks.
# Selfie modes use a separate lighter "phone" block.
# ----------------------------------------------------------------------------

OPENER_EDITORIAL = (
    "Hyperrealistic candid photograph that looks like a frame pulled from real "
    "life, not a posed photoshoot and absolutely not a generated image."
)
OPENER_PHONE = (
    "Real phone snapshot — casual, slightly imperfect, the kind of photo "
    "people actually take in everyday life and post on social media."
)

LIGHTING_POOL = [
    "Late afternoon window light from one side — directional and uneven, sculpting cheekbone and jawline, deep shadow on the opposite half of the face, no fill light, slightly underexposed on the shadow side.",
    "Overcast daylight from above — visible shadow under brows and chin, slight under-eye darkness, cool neutral cast, no symmetric fill light.",
    "Golden hour low warm sun from one side — strong directional warm key light, hard shadow on the opposite cheek, slight rim glow on hair, real outdoor exposure (not lifted).",
    "Mixed indoor practical lighting — warm tungsten lamp on one side and cool daylight from a window on the other, color-temperature split across the face, naturalistic uneven exposure.",
    "Morning side light through a tall window — directional cool key, micro-shadows defining the nose bridge and jaw, no symmetric beauty fill.",
    "Blue hour twilight with mixed warm street lights — atmospheric uneven face shadows, low overall light level, color contrast across the features.",
    "Single overhead practical (pendant lamp or ceiling fixture) — top-down light with deep shadow pockets under brows and chin, dramatic but real indoor lighting.",
    "Bounced indoor afternoon light, slightly under-lit overall — mid-tone face with low overall contrast, no harsh fill, the honestly imperfect exposure of a real grabbed phone moment.",
]

# Permanent face-lighting directive — included in every editorial realism
# block. The single biggest AI tell on portraits is "beauty-box" perfectly
# even, symmetric face lighting that lifts every shadow for flattery.
# Real cameras don't do that; pushing the model away from it is one of
# the highest-leverage anti-AI cues available.
FACE_LIGHTING_DIRECTIVE = (
    "Face lighting: directional and uneven. Accept harder shadows on one "
    "side of the face, visible micro-shadows under the brows / nose bridge "
    "/ jaw / chin / lower lip, and a slightly under-lit shadow side. Do "
    "NOT use beauty-box even illumination. Do NOT lift shadows for "
    "flattering symmetry. Do NOT add fill light to even out the face. "
    "Real cameras don't render HDR-flat face exposure — embrace honest "
    "directional light with visible shadow detail."
)

POSE_POOL = [
    "Weight shifted to one hip in natural contrapposto, hands in relaxed unposed positions (not clasped, not on hips), head tilted a few degrees off-axis, gaze slightly off-camera as if at something just past the lens.",
    "Standing slightly off-balance with weight on one leg, shoulders subtly asymmetric, one hand in motion (adjusting hair, strap, or pocket), soft natural micro-expression.",
    "Mid-step or just paused walking - body subtly twisted, hands moving naturally rather than placed, candid moment caught between actions.",
    "Leaning casually against an unseen wall or surface, one shoulder dropped, body angled to camera, gaze relaxed and unfocused.",
    "Subtle gesture mid-motion - brushing hair back, adjusting clothing, looking down briefly - the kind of frame caught between takes.",
    "Sitting or perched casually, one elbow resting on something, weight distributed asymmetrically, expression unposed and present in the moment.",
]

COMPOSITION_POOL = [
    "Off-center composition placing the subject around the rule-of-thirds line with natural negative space, slight intentional asymmetry as if not framed perfectly.",
    "Tight crop that doesn't include the full body - some part of the subject extends past the frame edge, like a real candid grabbed in the moment.",
    "Subject placed slightly low in the frame with environment occupying upper third, cinematic widescreen-feel even within 4:5.",
    "Foreground element slightly out of focus near the edge of frame (a hand, doorway, piece of furniture), giving depth and accidental-real composition.",
]

SKIN_AND_TEXTURE_DIRECTIVE = (
    "Skin: real human texture with visible pores, subtle natural blemishes, "
    "slight redness in cheeks, faint asymmetry between left and right side of "
    "face. Skin tone varies slightly between face, neck, and hands. Absolutely "
    "no beauty retouching, no smoothing filter, no airbrushed plastic skin."
)

FILM_STOCK_POOL = [
    "Kodak Portra 400 film aesthetic - muted natural tones, warm shadows, true-to-life skin, subtle organic grain.",
    "Fujifilm Pro 400H film look - soft pastel highlights, gentle cool cast in shadows, slightly desaturated greens.",
    "Cinestill 800T film cast - warm tungsten tones, slight halation glow around bright lights, mood of late-night indoor.",
    "Kodak Gold 200 everyday-snapshot palette - warm sun-baked tones, light grain, slightly saturated reds and yellows.",
    "Fujifilm Superia 400 - slight green/teal lean in shadows, natural mid-range, the look of everyday film photos.",
]

# Aesthetic style references — phrased as descriptive directions rather
# than named people. OpenAI's image API blocks requests that reference
# real living photographers / celebrities ("moderation_blocked"), so we
# describe the LOOK directly instead of naming the artist behind it.
STYLE_REFS = [
    "dreamy candid intimacy, soft pastel color palette, youthful naturalism, slightly hazy soft focus",
    "youthful editorial naturalism — soft natural light, relaxed authentic posture, fashion-aware but unforced",
    "observational street portraiture style — real-life moments caught without performance, documentary feel",
    "cinematic documentary stillness — quiet contemplative mood, environmental context, painterly composition",
    "street fashion editorial style — fashion-aware but candid, slightly imperfect framing, real",
    "Korean indie editorial style — soft minimalism, restrained muted palette, quiet emotion",
    "environmental portrait style — telling a story with the setting, distinctive directional lighting, the subject feels like a real person not a model",
    "lo-fi indie zine style — slightly grainy, intimate, casual everyday glamour without polish",
]

NEGATIVE_DIRECTIVE_EDITORIAL = (
    "Avoid: AI-generated look, plastic skin, perfectly symmetric features, "
    "glamour-shot pose, influencer-perfect smile, photoshopped retouching, "
    "stock-photo composition, oversaturated digital colors, dead-center "
    "passport-photo framing."
)
NEGATIVE_DIRECTIVE_PHONE = (
    "Avoid: glossy editorial polish, professional studio look, perfect skin "
    "retouching, model-photoshoot pose - this should look like a casual phone "
    "photo, not a magazine cover."
)

PHONE_LIGHTING_POOL = [
    "Soft natural light from a window, the kind of light you actually have at home in the late afternoon.",
    "Mixed indoor practical light - warm overhead lamp and a window, slight color temperature mismatch.",
    "Outdoor daylight, slightly cloudy, even and unflattering in the real way phone photos are.",
    "Late evening warm indoor lighting, soft shadows, moody phone shot people take before going out.",
]

PHONE_POSE_POOL = [
    "Body slightly turned to angle in the mirror/camera, free hand relaxed or on hip, weight shifted casually, head tilted just enough to be flattering without looking posed.",
    "Mid-pose check-in expression - looking at own reflection or screen with a slightly self-aware micro-smile, not a posed glamour smile.",
    "Casual stance with one hand holding the phone, the other hand naturally at side or adjusting something, body language unaware-of-audience.",
]


def _photorealism_directives(capture_style: str) -> tuple[list[str], dict]:
    """Build a fresh layered realism block. Returns (directives, picks)
    where picks records which pool items were sampled (so callers can
    record them in job inputs for traceability and post-hoc tuning)."""
    is_phone = capture_style in ("SELFIE", "MIRROR_SELFIE")

    if is_phone:
        lighting = random.choice(PHONE_LIGHTING_POOL)
        pose = random.choice(PHONE_POSE_POOL)
        return (
            [
                OPENER_PHONE,
                _camera_signature(capture_style),
                lighting,
                FACE_LIGHTING_DIRECTIVE,
                pose,
                SKIN_AND_TEXTURE_DIRECTIVE,
                NEGATIVE_DIRECTIVE_PHONE,
            ],
            {"mode": "phone", "lighting": lighting, "pose": pose},
        )

    lighting = random.choice(LIGHTING_POOL)
    pose = random.choice(POSE_POOL)
    composition = random.choice(COMPOSITION_POOL)
    film = random.choice(FILM_STOCK_POOL)
    style_ref = random.choice(STYLE_REFS)
    return (
        [
            OPENER_EDITORIAL,
            _camera_signature(capture_style),
            lighting,
            FACE_LIGHTING_DIRECTIVE,
            pose,
            composition,
            SKIN_AND_TEXTURE_DIRECTIVE,
            film,
            style_ref,
            NEGATIVE_DIRECTIVE_EDITORIAL,
        ],
        {
            "mode": "editorial",
            "lighting": lighting,
            "pose": pose,
            "composition": composition,
            "film": film,
            "style_ref": style_ref,
        },
    )


def _build_compose_prompt(
    character: Character,
    filled_slots: dict[str, WardrobeItem],
    empty_slots: list[str],
    mood: MoodReference | None,
    scene: str,
    char_ref_positions: list[int],
    product_ref_positions: dict[str, list[int]],
    mood_ref_position: int | None,
    location: WorldLocation | None,
    location_ref_positions: list[int],
    view: str,
    capture_style: str,
    weather: str,
    season: str,
    time_of_day: str,
    anchor_ref_position: int | None,
) -> str:
    lines = []

    if char_ref_positions:
        ref_nums = ", ".join(str(n) for n in char_ref_positions)
        lines.append(
            f"Generate a photorealistic image of the SAME person shown in reference images {ref_nums}. "
            "Maintain exact same face, skin tone, hair color, hair style."
        )

    if anchor_ref_position is not None:
        # The anchor is a previously-generated shot of this same compose
        # setup. It locks in the rendered look (hair styling, makeup, outfit
        # presentation, body language) so variations stay visually
        # consistent across a series of feed posts.
        lines.append(
            f"Reference image {anchor_ref_position} is a previously-generated shot of "
            "this exact look. Keep the person's hair styling, makeup, outfit details, "
            "and overall styling consistent with that anchor image — this should look "
            "like another frame of the same scene/setup, only the framing or scene "
            "context may differ."
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

    # Mood is the dominant aesthetic signal when present — it carries the
    # complete visual vibe (lighting, color, time-of-day feel, framing,
    # film look). When the user picks a mood reference, we lean fully on
    # it and skip the parametric knobs (view / capture / weather / season
    # / time / photo-realism pool) so they don't fight the mood. Skin
    # texture + anti-AI negatives still apply at the end.
    mood_active = mood is not None and mood_ref_position is not None
    if mood_active:
        lines.append(
            f"Apply the COMPLETE visual aesthetic from reference image {mood_ref_position} "
            "— lighting, color grading, atmosphere, framing and composition, time-of-day "
            "quality, film look, and overall mood. Match the reference's visual style "
            "exactly. Do NOT copy the people or objects from this reference, only its "
            "aesthetic."
        )

    if location and location_ref_positions:
        if len(location_ref_positions) == 1:
            lines.append(
                f"Setting: the scene takes place at the location shown in reference image "
                f"{location_ref_positions[0]} — render this exact place (architecture, "
                "room features, wall colors, environmental details) consistently."
            )
        else:
            ref_nums = ", ".join(str(n) for n in location_ref_positions)
            lines.append(
                f"Setting: the scene takes place at the location shown in reference images "
                f"{ref_nums} (same physical place from multiple angles). Render the same "
                "architecture, room features, wall colors, lighting, and environmental "
                "details consistently — this is a recurring place the subject frequents."
            )

    # Environment + parametric knobs only apply when mood isn't dominating.
    if not mood_active:
        if weather in WEATHER_PROMPTS:
            lines.append(WEATHER_PROMPTS[weather])
        if season in SEASON_PROMPTS:
            lines.append(SEASON_PROMPTS[season])
        if time_of_day in TIME_OF_DAY_PROMPTS:
            lines.append(TIME_OF_DAY_PROMPTS[time_of_day])

    if scene:
        # Free-form prompt addition from the user, always honored.
        lines.append(scene)

    if not mood_active:
        lines.append(VIEW_PROMPTS[view])
        if capture_style in CAPTURE_STYLE_PROMPTS:
            lines.append(CAPTURE_STYLE_PROMPTS[capture_style])
        # Full randomized photo-realism block (lighting/pose/film/style_ref).
        realism_lines, _picks = _photorealism_directives(capture_style)
        lines.extend(realism_lines)
        final_look = (
            "indistinguishable from a real phone photo"
            if capture_style in ("SELFIE", "MIRROR_SELFIE")
            else "indistinguishable from a real DSLR photograph"
        )
    else:
        # Mood-dominant: keep only the universal anti-AI cues that don't
        # impose lighting/composition/film of their own. Face-lighting
        # directive stays — it's about REJECTING beauty-box flat light,
        # which is universally beneficial and doesn't conflict with the
        # mood ref's color/atmosphere choices.
        lines.append(FACE_LIGHTING_DIRECTIVE)
        lines.append(SKIN_AND_TEXTURE_DIRECTIVE)
        lines.append(NEGATIVE_DIRECTIVE_EDITORIAL)
        final_look = "photorealistic, matching the mood reference's overall look"

    lines.append(f"4:5 aspect ratio, {final_look}.")

    return "\n".join(lines)


def _prepare_compose_inputs(
    session: Session,
    character_id: str,
    slots: dict,
    scene: str,
    provider_name: str,
    quality: str,
    character_reference_ids: list[str] | None = None,
    view: str = DEFAULT_VIEW,
    capture_style: str = DEFAULT_CAPTURE_STYLE,
    weather: str = DEFAULT_WEATHER,
    season: str = DEFAULT_SEASON,
    time_of_day: str = DEFAULT_TIME_OF_DAY,
    anchor_image_id: str | None = None,
) -> dict:
    view = _resolve_view(view)
    capture_style = _resolve_capture_style(capture_style)
    weather = _resolve_weather(weather)
    season = _resolve_season(season)
    time_of_day = _resolve_time_of_day(time_of_day)
    # 1. Load character + references
    character = session.get(Character, character_id)
    if not character:
        raise ValueError(f"Character {character_id} not found")

    all_char_refs = session.exec(
        select(CharacterReference).where(
            CharacterReference.character_id == character_id,
        )
    ).all()
    refs_by_id = {r.id: r for r in all_char_refs}
    refs_by_role = {r.role: r for r in all_char_refs}

    # User explicitly picks which references to send. Empty list falls back
    # to the FACE_FRONT (base) reference so compose never goes refless.
    requested_ids = list(character_reference_ids or [])
    chosen: list[CharacterReference] = []
    seen: set[str] = set()
    for rid in requested_ids:
        ref = refs_by_id.get(rid)
        if ref and ref.id not in seen:
            chosen.append(ref)
            seen.add(ref.id)
    if not chosen and "FACE_FRONT" in refs_by_role:
        chosen.append(refs_by_role["FACE_FRONT"])

    # Order chosen refs by COMPOSE_ROLES_BY_PRIORITY so the prompt's numbered
    # references line up with our identity-first convention regardless of the
    # order the user clicked.
    priority_index = {role: i for i, role in enumerate(COMPOSE_ROLES_BY_PRIORITY)}
    selected_char_refs = sorted(
        chosen, key=lambda r: priority_index.get(r.role, len(COMPOSE_ROLES_BY_PRIORITY))
    )

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

    # 4.5. World location reference — one location contributes all its images
    location: WorldLocation | None = None
    location_ref_positions: list[int] = []
    location_id = slots.get("location")
    if location_id:
        location = session.get(WorldLocation, location_id)
        if location and location.images:
            for img in location.images:
                pos = len(references) + 1
                references.append(
                    {"role": f"location_{img.sort_order}", "image_id": img.image_id}
                )
                location_ref_positions.append(pos)

    # 4.6. Anchor image — a previously-generated shot the user pinned
    # to lock the rendered look across a variation series.
    anchor_ref_position: int | None = None
    if anchor_image_id:
        asset = session.get(ImageAsset, anchor_image_id)
        if asset:
            anchor_ref_position = len(references) + 1
            references.append({"role": "anchor", "image_id": asset.id})

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
        location,
        location_ref_positions,
        view,
        capture_style,
        weather,
        season,
        time_of_day,
        anchor_ref_position,
    )

    return {
        "prompt": prompt,
        "references": references,
        "selected_char_refs": selected_char_refs,
        "view": view,
        "capture_style": capture_style,
        "weather": weather,
        "season": season,
        "time_of_day": time_of_day,
        "anchor_image_id": anchor_image_id if anchor_ref_position else None,
    }


def enqueue_compose_look(
    character_id: str,
    slots: dict,
    scene: str,
    provider_name: str,
    quality: str,
    character_reference_ids: list[str] | None = None,
    view: str = DEFAULT_VIEW,
    capture_style: str = DEFAULT_CAPTURE_STYLE,
    weather: str = DEFAULT_WEATHER,
    season: str = DEFAULT_SEASON,
    time_of_day: str = DEFAULT_TIME_OF_DAY,
    anchor_image_id: str | None = None,
) -> str:
    with Session(engine) as session:
        prepared = _prepare_compose_inputs(
            session,
            character_id,
            slots,
            scene,
            provider_name,
            quality,
            character_reference_ids,
            view,
            capture_style,
            weather,
            season,
            time_of_day,
            anchor_image_id,
        )
        references = prepared["references"]
        prompt = prepared["prompt"]
        selected_char_refs = prepared["selected_char_refs"]
        resolved_view = prepared["view"]
        resolved_capture_style = prepared["capture_style"]

        job = GenerationJob(
            type="compose_look",
            character_id=character_id,
            inputs={
                "prompt": prompt,
                "reference_image_ids": [
                    {"role": r["role"], "image_id": r["image_id"]} for r in references
                ],
                "character_reference_count": len(selected_char_refs),
                "character_reference_ids": [r.id for r in selected_char_refs],
                "slots": slots,
                "scene": scene,
                "quality": quality,
                "view": resolved_view,
                "capture_style": resolved_capture_style,
                "weather": prepared["weather"],
                "season": prepared["season"],
                "time_of_day": prepared["time_of_day"],
                "anchor_image_id": prepared["anchor_image_id"],
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
