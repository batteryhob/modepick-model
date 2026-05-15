from app.services.image_gen.base import ImageGenProvider, ImageGenRequest, ImageGenResult


class GeminiProvider(ImageGenProvider):
    def __init__(self):
        pass

    async def generate(self, req: ImageGenRequest) -> ImageGenResult:
        raise NotImplementedError("Gemini provider not yet implemented")
