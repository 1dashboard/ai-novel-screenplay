"""Pydantic request / response schemas for conversion."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


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


class UpdateScreenplayRequest(BaseModel):
    yaml_content: str = Field(..., min_length=1, description="Edited YAML content")


class UpdateScreenplayResponse(BaseModel):
    title: str
    character_count: int
    act_count: int
    scene_count: int


class ChatMessage(BaseModel):
    role: str  # "user" | "assistant"
    content: str


class ChatEditRequest(BaseModel):
    instruction: str = Field(..., min_length=1, description="Natural language editing instruction")
    current_yaml: str = Field(..., min_length=1, description="Current screenplay YAML content")
    conversation_history: list[ChatMessage] | None = Field(None, description="Prior conversation messages")


class ChangeItem(BaseModel):
    type: str  # "modify" | "add" | "delete"
    target: str
    description: str


class ChatEditResponse(BaseModel):
    modified_yaml: str
    change_summary: str
    changes: list[ChangeItem] = []
