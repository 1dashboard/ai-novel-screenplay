"""Pydantic request / response schemas for conversion."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class UploadResponse(BaseModel):
    task_id: int
    status: str
    message: str = "文件已上传，转换任务已启动"


class TaskResponse(BaseModel):
    id: int
    original_filename: str
    file_size: int | None
    status: str
    progress: int
    progress_message: str | None
    chapter_count: int | None
    llm_provider: str | None
    llm_model: str | None
    error_message: str | None
    screenplay_id: int | None = None
    score: int | None = None
    created_at: datetime
    updated_at: datetime
    completed_at: datetime | None

    model_config = {"from_attributes": True}


class TaskListResponse(BaseModel):
    items: list[TaskResponse]
    total: int
    limit: int
    offset: int


class ScreenplayResponse(BaseModel):
    meta: dict
    characters: list[dict]
    acts: list[dict]


class EvaluationResponse(BaseModel):
    score: int | None
    summary: str
    details: dict | None = None
