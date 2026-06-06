"""Chat memory cache — Redis write-through + DB fallback.

Redis 结构:
  chat:session:{id}:messages  → JSON 数组，最多 12 条消息
  chat:session:{id}:meta      → Hash, session 元数据

TTL: 3600 秒（可配置）
Redis 不可用时自动降级为纯 DB 模式，不影响功能。
"""

from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Any

import redis

from ..config import settings

logger = logging.getLogger(__name__)

_redis_client: redis.Redis | None = None
_redis_available: bool | None = None  # None = 未检测, True/False = 已知状态

MESSAGE_KEY = "chat:session:{sid}:messages"
META_KEY = "chat:session:{sid}:meta"
MAX_CACHED_MESSAGES = 12


def _get_client() -> redis.Redis | None:
    """获取 Redis 客户端（懒加载），不可用时返回 None。"""
    global _redis_client, _redis_available

    if not settings.redis_enabled:
        return None

    if _redis_available is False:
        return None

    if _redis_client is not None:
        return _redis_client

    try:
        _redis_client = redis.Redis(
            host=settings.redis_host,
            port=settings.redis_port,
            db=settings.redis_database,
            password=settings.redis_password or None,
            socket_connect_timeout=2,
            socket_timeout=2,
            decode_responses=True,
            protocol=2,  # RESP2 协议，兼容旧版 Redis (Windows)
        )
        _redis_client.ping()
        _redis_available = True
        logger.info("Redis 连接成功: %s:%d db=%d", settings.redis_host, settings.redis_port, settings.redis_database)
        return _redis_client
    except Exception as e:
        _redis_available = False
        _redis_client = None
        logger.warning("Redis 不可用，降级为纯 DB 模式: %s", e)
        return None


# ---------------------------------------------------------------------------
# 消息缓存
# ---------------------------------------------------------------------------

def cache_messages(session_id: int, messages: list[dict[str, Any]]) -> None:
    """将消息列表写入 Redis 缓存。"""
    r = _get_client()
    if not r:
        return

    key = MESSAGE_KEY.format(sid=session_id)
    try:
        # 只缓存最近 N 条
        to_cache = messages[-MAX_CACHED_MESSAGES:]
        payload = json.dumps(to_cache, ensure_ascii=False, default=str)
        r.setex(key, settings.redis_ttl_seconds, payload)
    except Exception as e:
        logger.debug("Redis 写入消息缓存失败: %s", e)


def get_cached_messages(session_id: int) -> list[dict[str, Any]] | None:
    """从 Redis 读取消息缓存，未命中返回 None。"""
    r = _get_client()
    if not r:
        return None

    key = MESSAGE_KEY.format(sid=session_id)
    try:
        raw = r.get(key)
        if raw:
            return json.loads(raw)
    except Exception as e:
        logger.debug("Redis 读取消息缓存失败: %s", e)
    return None


def append_cached_message(session_id: int, message: dict[str, Any]) -> None:
    """向 Redis 缓存的末尾追加一条消息，并裁剪到最大数量。"""
    r = _get_client()
    if not r:
        return

    key = MESSAGE_KEY.format(sid=session_id)
    try:
        # 先读取已有缓存
        existing_raw = r.get(key)
        if existing_raw:
            messages = json.loads(existing_raw)
        else:
            messages = []

        messages.append(message)
        messages = messages[-MAX_CACHED_MESSAGES:]
        payload = json.dumps(messages, ensure_ascii=False, default=str)
        r.setex(key, settings.redis_ttl_seconds, payload)
    except Exception as e:
        logger.debug("Redis 追加消息缓存失败: %s", e)


def invalidate_session(session_id: int) -> None:
    """删除指定 session 的全部 Redis 缓存。"""
    r = _get_client()
    if not r:
        return

    try:
        r.delete(
            MESSAGE_KEY.format(sid=session_id),
            META_KEY.format(sid=session_id),
        )
    except Exception as e:
        logger.debug("Redis 删除缓存失败: %s", e)


# ---------------------------------------------------------------------------
# Session 元数据缓存
# ---------------------------------------------------------------------------

def cache_session_meta(session_id: int, meta: dict[str, Any]) -> None:
    """缓存 session 元数据。"""
    r = _get_client()
    if not r:
        return

    key = META_KEY.format(sid=session_id)
    try:
        r.hset(key, mapping={k: str(v) for k, v in meta.items() if v is not None})
        r.expire(key, settings.redis_ttl_seconds)
    except Exception as e:
        logger.debug("Redis 写入 meta 缓存失败: %s", e)


def get_cached_session_meta(session_id: int) -> dict[str, str] | None:
    """从 Redis 读取 session 元数据，未命中返回 None。"""
    r = _get_client()
    if not r:
        return None

    key = META_KEY.format(sid=session_id)
    try:
        data = r.hgetall(key)
        if data:
            return data
    except Exception as e:
        logger.debug("Redis 读取 meta 缓存失败: %s", e)
    return None


# ---------------------------------------------------------------------------
# 消息对象转换工具
# ---------------------------------------------------------------------------

def message_to_dict(msg: Any) -> dict[str, Any]:
    """将 ChatMessage ORM 对象转为可缓存的字典。"""
    return {
        "id": msg.id,
        "role": msg.role,
        "content": msg.content,
        "change_summary": msg.change_summary,
        "changes_json": msg.changes_json,
        "accepted": msg.accepted,
        "rejected": msg.rejected,
        "token_count": msg.token_count,
        "created_at": msg.created_at.isoformat() if isinstance(msg.created_at, datetime) else str(msg.created_at),
    }
