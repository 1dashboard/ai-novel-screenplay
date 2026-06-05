"""Conversion routes: upload, tasks, screenplay preview, YAML download, evaluation, SSE stream."""

from __future__ import annotations

import asyncio
import json
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, Form, HTTPException, Query, Request, UploadFile, status
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..models.task import ConversionTask
from ..models.screenplay import ScreenplayRecord
from ..models.user import User
from ..schemas.conversion import (
    EvaluationResponse,
    ScreenplayResponse,
    TaskListResponse,
    TaskResponse,
    UploadResponse,
)
from ..services import conversion_service as svc
from ..services.stream import register as stream_register, unregister as stream_unregister

from .deps import get_current_user

router = APIRouter(tags=["conversion"])

VALID_EXTENSIONS = {".txt", ".md", ".markdown", ".docx", ".doc", ".pdf"}
MAX_UPLOAD_BYTES = settings.max_upload_size_mb * 1024 * 1024


def _save_upload(user: User, file: UploadFile) -> tuple[str, str, int]:
    """Save uploaded file to disk. Returns (original_name, disk_path, size)."""
    ext = Path(file.filename or "unknown").suffix.lower()
    if ext not in VALID_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"不支持的文件格式 '{ext}'。支持：{', '.join(sorted(VALID_EXTENSIONS))}",
        )

    user_dir = Path(settings.upload_dir) / str(user.id)
    user_dir.mkdir(parents=True, exist_ok=True)

    safe_name = f"{uuid.uuid4().hex[:12]}_{file.filename}"
    disk_path = user_dir / safe_name

    content = file.file.read()
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"文件大小不能超过 {settings.max_upload_size_mb} MB",
        )

    disk_path.write_bytes(content)
    return file.filename or "unknown", str(disk_path), len(content)


@router.post("/upload", response_model=UploadResponse, status_code=status.HTTP_201_CREATED)
async def upload(
    file: UploadFile,
    model: str = Form("", description="Optional LLM model override"),
    prompt: str = Form("", description="Optional custom system prompt"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    original_name, disk_path, size = _save_upload(current_user, file)

    task = ConversionTask(
        user_id=current_user.id,
        original_filename=original_name,
        file_path=disk_path,
        file_size=size,
        custom_prompt=prompt or None,
    )
    db.add(task)
    db.commit()
    db.refresh(task)

    await svc.enqueue_conversion(task, model_override=model or None)

    return UploadResponse(task_id=task.id, status=task.status)


@router.get("/tasks", response_model=TaskListResponse)
def list_tasks(
    status: str = "",
    limit: int = 20,
    offset: int = 0,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = db.query(ConversionTask).filter(ConversionTask.user_id == current_user.id)
    if status:
        q = q.filter(ConversionTask.status == status)
    total = q.count()
    items = q.order_by(ConversionTask.created_at.desc()).offset(offset).limit(limit).all()

    # Inject screenplay_id if one exists
    result = []
    for t in items:
        d = TaskResponse.model_validate(t).model_dump()
        d["screenplay_id"] = t.screenplay.id if t.screenplay else None
        d["score"] = t.screenplay.score if t.screenplay else None
        result.append(d)

    return TaskListResponse(items=result, total=total, limit=limit, offset=offset)


@router.get("/tasks/{task_id}/stream")
async def stream_task(
    task_id: int,
    request: Request,
    token: str = Query(default="", description="JWT for SSE (query param fallback for EventSource)"),
    db: Session = Depends(get_db),
):
    """SSE endpoint: stream conversion progress events in real-time.

    Accepts JWT via Authorization: Bearer header or ?token= query param (fallback).
    """
    from ..api.deps import decode_token

    user_id: int | None = None

    # 1) Try Authorization header first
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        payload = decode_token(auth_header[7:])
        if payload:
            user_id = int(payload.get("sub", 0))

    # 2) Fall back to ?token= query param (for EventSource which can't set headers)
    if user_id is None and token:
        payload = decode_token(token)
        if payload:
            user_id = int(payload.get("sub", 0))

    if user_id is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or missing token")

    task = db.query(ConversionTask).filter(
        ConversionTask.id == task_id,
        ConversionTask.user_id == user_id,
    ).first()
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")

    queue: asyncio.Queue = asyncio.Queue(maxsize=200)
    stream_register(task_id, queue)

    async def event_stream():
        try:
            # Send initial snapshot
            t_dict = TaskResponse.model_validate(task).model_dump()
            t_dict["screenplay_id"] = task.screenplay.id if task.screenplay else None
            t_dict["score"] = task.screenplay.score if task.screenplay else None
            yield f"data: {json.dumps({'type': 'snapshot', 'task': t_dict}, ensure_ascii=False, default=str)}\n\n"

            # If task is already completed or failed, replay final events immediately
            if task.status == "completed" and task.screenplay:
                yield f"data: {json.dumps({'type': 'log', 'text': '[完成] 剧本转换完毕！\\n'}, ensure_ascii=False)}\n\n"
                if task.screenplay.yaml_content:
                    yield f"data: {json.dumps({'type': 'yaml_chunk', 'text': task.screenplay.yaml_content}, ensure_ascii=False)}\n\n"
                yield f"data: {json.dumps({'type': 'complete', 'progress': 100, 'message': '转换完成', 'screenplay_id': task.screenplay.id, 'score': task.screenplay.score, 'chapter_count': task.chapter_count, 'character_count': task.screenplay.character_count, 'scene_count': task.screenplay.scene_count}, ensure_ascii=False)}\n\n"
                yield f"data: {json.dumps({'type': 'heartbeat'})}\n\n"
                return
            elif task.status == "failed":
                yield f"data: {json.dumps({'type': 'error', 'message': task.error_message or '转换失败'}, ensure_ascii=False)}\n\n"
                return

            while True:
                try:
                    payload = await asyncio.wait_for(queue.get(), timeout=30)
                    yield f"data: {payload}\n\n"
                    if '"type": "complete"' in payload or '"type": "error"' in payload:
                        break
                except asyncio.TimeoutError:
                    yield f"data: {json.dumps({'type': 'heartbeat'})}\n\n"
        finally:
            stream_unregister(task_id, queue)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/tasks/{task_id}", response_model=TaskResponse)
def get_task(
    task_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    task = db.query(ConversionTask).filter(
        ConversionTask.id == task_id,
        ConversionTask.user_id == current_user.id,
    ).first()
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")

    d = TaskResponse.model_validate(task).model_dump()
    d["screenplay_id"] = task.screenplay.id if task.screenplay else None
    d["score"] = task.screenplay.score if task.screenplay else None
    return d


@router.get("/tasks/{task_id}/screenplay", response_model=ScreenplayResponse)
def get_screenplay(
    task_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    task = db.query(ConversionTask).filter(
        ConversionTask.id == task_id,
        ConversionTask.user_id == current_user.id,
    ).first()
    if not task or task.status != "completed":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Screenplay not available")

    if not task.screenplay:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Screenplay data not found")

    from src.schema import ScreenplayYAML
    sp = ScreenplayYAML.parse_yaml(task.screenplay.yaml_content)
    return ScreenplayResponse(
        meta=sp.meta.model_dump(mode="json"),
        characters=[c.model_dump(mode="json") for c in sp.characters],
        acts=[a.model_dump(mode="json") for a in sp.acts],
    )


@router.get("/tasks/{task_id}/yaml")
def download_yaml(
    task_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    task = db.query(ConversionTask).filter(
        ConversionTask.id == task_id,
        ConversionTask.user_id == current_user.id,
    ).first()
    if not task or not task.screenplay_yaml_path:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="YAML not available")

    file_path = Path(task.screenplay_yaml_path)
    if not file_path.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="YAML file not found on disk")

    safe_name = Path(task.original_filename).stem + "_screenplay.yaml"
    return FileResponse(
        path=str(file_path),
        filename=safe_name,
        media_type="application/x-yaml",
    )


@router.get("/tasks/{task_id}/evaluation", response_model=EvaluationResponse)
def get_evaluation(
    task_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    task = db.query(ConversionTask).filter(
        ConversionTask.id == task_id,
        ConversionTask.user_id == current_user.id,
    ).first()
    if not task or not task.screenplay:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Evaluation not available")

    return EvaluationResponse(
        score=task.screenplay.score,
        summary=task.screenplay.eval_summary or "",
    )


@router.delete("/tasks/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_task(
    task_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    task = db.query(ConversionTask).filter(
        ConversionTask.id == task_id,
        ConversionTask.user_id == current_user.id,
    ).first()
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")

    # Delete files
    for p in [task.file_path, task.screenplay_yaml_path, task.eval_report_path]:
        if p:
            try:
                Path(p).unlink(missing_ok=True)
            except OSError:
                pass

    db.delete(task)
    db.commit()
