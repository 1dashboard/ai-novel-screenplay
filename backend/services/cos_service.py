"""Tencent Cloud COS object storage service."""

from __future__ import annotations

import logging
import uuid
from pathlib import Path
from typing import Optional

import yaml
from qcloud_cos import CosConfig, CosS3Client

logger = logging.getLogger(__name__)

_client: Optional[CosS3Client] = None
_config: dict = {}


def _load_config() -> dict:
    """Load COS config from config.yaml."""
    global _config
    if _config:
        return _config
    try:
        with open("config.yaml", encoding="utf-8") as f:
            raw = yaml.safe_load(f) or {}
        _config = raw.get("cos", {}).get("client", {})
    except Exception:
        _config = {}
    return _config


def get_client() -> CosS3Client:
    """Return the singleton COS client, initializing it on first call."""
    global _client
    if _client is not None:
        return _client

    cfg = _load_config()
    cos_cfg = CosConfig(
        Region=cfg.get("region", ""),
        SecretId=cfg.get("secretId", ""),
        SecretKey=cfg.get("secretKey", ""),
    )
    _client = CosS3Client(cos_cfg)
    return _client


def get_bucket() -> str:
    cfg = _load_config()
    return cfg.get("bucket", "")


def get_host() -> str:
    cfg = _load_config()
    return cfg.get("host", "")


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def generate_source_key(user_id: int, filename: str) -> str:
    """Generate a unique COS object key for an uploaded source file."""
    ext = Path(filename).suffix
    uid = uuid.uuid4().hex[:12]
    return f"uploads/{user_id}/{uid}_{filename}"


def generate_result_key(user_id: int, task_id: int, suffix: str = ".yaml") -> str:
    """Generate a COS object key for a result file (YAML / eval)."""
    return f"results/{user_id}/{task_id}/screenplay{suffix}"


def generate_presigned_upload(key: str, expires: int = 300) -> str:
    """Generate a presigned URL for client-side upload."""
    client = get_client()
    bucket = get_bucket()
    return client.get_presigned_url(
        Method="PUT",
        Bucket=bucket,
        Key=key,
        Expired=expires,
    )


def generate_presigned_download(key: str, expires: int = 3600) -> str:
    """Generate a presigned URL for downloading a file."""
    client = get_client()
    bucket = get_bucket()
    return client.get_presigned_url(
        Method="GET",
        Bucket=bucket,
        Key=key,
        Expired=expires,
    )


def upload_object(key: str, data: bytes, content_type: str = "application/octet-stream") -> None:
    """Upload an object to COS from server-side."""
    client = get_client()
    bucket = get_bucket()
    client.put_object(
        Bucket=bucket,
        Key=key,
        Body=data,
        ContentType=content_type,
    )


def download_object(key: str) -> bytes:
    """Download an object from COS. Raises on error."""
    client = get_client()
    bucket = get_bucket()
    response = client.get_object(Bucket=bucket, Key=key)
    return response["Body"].get_raw_stream().read()


def download_object_to_file(key: str, local_path: str) -> None:
    """Download a COS object to a local file."""
    data = download_object(key)
    Path(local_path).write_bytes(data)


def delete_object(key: str) -> None:
    """Delete an object from COS."""
    try:
        client = get_client()
        bucket = get_bucket()
        client.delete_object(Bucket=bucket, Key=key)
    except Exception as e:
        logger.warning("Failed to delete COS object %s: %s", key, e)


def get_download_url(key: str) -> str:
    """Return the public or presigned download URL for an object."""
    host = get_host()
    if host:
        return f"{host.rstrip('/')}/{key}"
    return generate_presigned_download(key)
