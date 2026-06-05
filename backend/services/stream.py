"""Thread-safe SSE event stream registry for real-time conversion progress."""

from __future__ import annotations

import asyncio
import json
import logging
from collections import defaultdict

logger = logging.getLogger(__name__)

_streams: dict[int, list[asyncio.Queue]] = defaultdict(list)


def register(task_id: int, queue: asyncio.Queue) -> None:
    _streams[task_id].append(queue)


def unregister(task_id: int, queue: asyncio.Queue) -> None:
    try:
        _streams[task_id].remove(queue)
        if not _streams[task_id]:
            del _streams[task_id]
    except (KeyError, ValueError):
        pass


def push(task_id: int, event_type: str, **kwargs) -> None:
    """Thread-safe: push an event to all queues registered for a task."""
    payload = json.dumps({"type": event_type, **kwargs}, ensure_ascii=False)
    for q in _streams.get(task_id, []):
        try:
            q.put_nowait(payload)
        except asyncio.QueueFull:
            logger.debug("Stream queue full for task %d, dropping event", task_id)
