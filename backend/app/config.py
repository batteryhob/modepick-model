from pathlib import Path
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # API Keys
    openai_api_key: str = ""
    gemini_api_key: str = ""
    # Local storage (used as fallback when S3 isn't configured)
    storage_dir: str = "./storage/images"
    database_url: str = "sqlite:///./data/app.db"

    # S3-compatible object storage. When all four of bucket/region/access/
    # secret are set, the StorageService switches to S3 mode: uploads go
    # to the bucket and image URLs are presigned. Leave empty to keep
    # using the local disk.
    s3_bucket_name: str = ""
    s3_bucket_region: str = "ap-northeast-2"
    s3_access_key: str = ""
    s3_secret_key: str = ""
    # Optional explicit endpoint URL — only needed for non-AWS
    # S3-compatible services (DigitalOcean Spaces, MinIO, R2, Wasabi).
    # Leave empty for AWS S3 / Lightsail Object Storage.
    s3_endpoint_url: str = ""
    # All keys are prefixed with this folder so the bucket can be shared
    # with other data without collision. Set to "" to write at the root.
    s3_key_prefix: str = "modepic-model"
    # Presigned URL TTL — long enough for a browser tab session, short
    # enough that leaked URLs don't stay valid forever.
    s3_presigned_expires_seconds: int = 3600

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

    @property
    def s3_enabled(self) -> bool:
        return bool(
            self.s3_bucket_name and self.s3_access_key and self.s3_secret_key
        )


settings = Settings()
