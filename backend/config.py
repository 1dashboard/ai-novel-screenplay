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

    # Tencent COS object storage
    cos_host: str = ""
    cos_secret_id: str = ""
    cos_secret_key: str = ""
    cos_region: str = ""
    cos_bucket: str = ""

    # Redis — chat memory cache (optional)
    redis_enabled: bool = True
    redis_host: str = "localhost"
    redis_port: int = 6379
    redis_database: int = 3
    redis_password: str = ""
    redis_ttl_seconds: int = 3600

    model_config = {"env_prefix": "N2S_", "env_file": ".env", "extra": "ignore"}


settings = Settings()
