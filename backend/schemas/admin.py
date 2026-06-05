"""Pydantic schemas for admin endpoints."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class SystemStats(BaseModel):
    total_users: int
    total_tasks: int
    completed_tasks: int
    failed_tasks: int
    processing_tasks: int
    success_rate: float
    recent_tasks: list[dict]


class UserAdminResponse(BaseModel):
    id: int
    username: str
    email: str
    role: str
    is_active: bool
    task_count: int
    created_at: datetime

    model_config = {"from_attributes": True}


class UserAdminListResponse(BaseModel):
    items: list[UserAdminResponse]
    total: int
    limit: int
    offset: int


class UserUpdateRequest(BaseModel):
    role: str | None = None
    is_active: bool | None = None
