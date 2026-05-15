from app.services.image_gen.base import ImageGenProvider


def get_provider(name: str) -> ImageGenProvider:
    if name == "openai":
        from app.services.image_gen.openai_provider import OpenAIProvider
        return OpenAIProvider()
    elif name == "gemini":
        from app.services.image_gen.gemini_provider import GeminiProvider
        return GeminiProvider()
    else:
        raise ValueError(f"Unknown provider: {name}")
