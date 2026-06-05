"""Application settings loaded from environment variables with sensible defaults."""

from __future__ import annotations

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "mysql+pymysql://root:123456@localhost:3306/novel2script"
    jwt_secret: str = "novel2script-dev-secret-change-in-production"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 30
    refresh_token_expire_days: int = 7
    upload_dir: str = "./uploads"
    max_upload_size_mb: int = 50
    config_path: str = "./config.yaml"

    model_config = {"env_prefix": "N2S_", "env_file": ".env", "extra": "ignore"}


settings = Settings()
