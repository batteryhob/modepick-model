from pydantic import BaseModel


class CharacterCreateRequest(BaseModel):
    name: str
    persona: dict  # {age, heritage, appearance, body_type, style, color_palette, location, personality}
    provider: str = "openai"  # openai | gemini
    reference_count: int = 1


class CharacterResponse(BaseModel):
    id: str
    name: str
    persona: dict
    base_image_id: str
    is_active: bool
    created_at: str
    updated_at: str
    references: list[dict]  # [{id, role, image_id}]

    class Config:
        from_attributes = True
