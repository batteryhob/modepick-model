from pathlib import Path
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # API Keys
    openai_api_key: str = ""
    gemini_api_key: str = ""
    # Storage
    storage_dir: str = "./storage/images"
    database_url: str = "sqlite:///./data/app.db"

    # Server
    host: str = "0.0.0.0"
    port: int = 8000
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,http://127.0.0.1:4173"

    # Defaults
    default_provider: str = "openai"
    default_quality: str = "medium"

    # Cost limits
    max_cost_per_day_usd: float = 20.0
    max_references_per_call: int = 12

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}

    @property
    def storage_path(self) -> Path:
        path = Path(self.storage_dir)
        path.mkdir(parents=True, exist_ok=True)
        return path

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",")]


settings = Settings()
