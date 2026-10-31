from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    model_path: str = "yolov8n.pt"
    confidence_threshold: float = Field(default=0.4, ge=0.1, le=0.9)
    cors_origins: list[str] = ["*"]
    max_upload_bytes: int = Field(default=10 * 1024 * 1024, gt=0)
    max_image_pixels: int = Field(default=25_000_000, gt=0)
