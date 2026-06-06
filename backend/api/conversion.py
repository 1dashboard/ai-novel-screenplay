"""Conversion routes: upload, tasks, screenplay preview, YAML download, evaluation, SSE stream."""

from __future__ import annotations

import asyncio
import json
import logging
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Body, Depends, Form, HTTPException, Query, Request, status
from fastapi.responses import FileResponse, RedirectResponse, StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..models.task import ConversionTask
from ..models.screenplay import ScreenplayRecord
from ..models.user import User
from ..models.chat import ChatSession
from ..schemas.conversion import (
    ChatEditRequest,
    ChatEditResponse,
    ChatSessionResponse,
    ChatMessageResponse,
    EvaluationResponse,
    ScreenplayResponse,
    TaskListResponse,
    TaskResponse,
    UpdateScreenplayRequest,
    UpdateScreenplayResponse,
    UploadResponse,
)
from ..services import conversion_service as svc
from ..services import cos_service as cos
from ..services import chat_service as chat_svc
from ..services.stream import register as stream_register, unregister as stream_unregister

from .deps import get_current_user

router = APIRouter(tags=["conversion"])

logger = logging.getLogger(__name__)

VALID_EXTENSIONS = {".txt", ".md", ".markdown", ".docx", ".doc", ".pdf"}
MAX_UPLOAD_BYTES = settings.max_upload_size_mb * 1024 * 1024


# ---------------------------------------------------------------------------
# Presign — get a temporary upload URL for COS direct upload
# ---------------------------------------------------------------------------

class PresignRequest(BaseModel):
    filename: str = Field(..., min_length=1, max_length=255)


@router.post("/presign", status_code=status.HTTP_200_OK)
def presign_upload(
    body: PresignRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    ext = Path(body.filename).suffix.lower()
    if ext not in VALID_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"不支持的文件格式 '{ext}'。支持：{', '.join(sorted(VALID_EXTENSIONS))}",
        )

    key = cos.generate_source_key(current_user.id, body.filename)
    upload_url = cos.generate_presigned_upload(key)

    return {"upload_url": upload_url, "key": key}


# ---------------------------------------------------------------------------
# Upload — create a conversion task from a COS key
# ---------------------------------------------------------------------------

@router.post("/upload", response_model=UploadResponse, status_code=status.HTTP_201_CREATED)
async def create_task_from_cos(
    key: str = Form(..., description="COS object key of the uploaded file"),
    filename: str = Form(..., description="Original filename"),
    size: int = Form(0, description="File size in bytes"),
    model: str = Form("", description="Optional LLM model override"),
    prompt: str = Form("", description="Optional custom system prompt"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    ext = Path(filename).suffix.lower()
    if ext not in VALID_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"不支持的文件格式 '{ext}'。",
        )

    if size > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"文件大小不能超过 {settings.max_upload_size_mb} MB",
        )

    # Download from COS to a temp file for the parser
    tmp = tempfile.NamedTemporaryFile(suffix=ext, delete=False)
    try:
        cos.download_object_to_file(key, tmp.name)
    except Exception:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="无法从对象存储读取文件")

    task = ConversionTask(
        user_id=current_user.id,
        original_filename=filename,
        file_path=tmp.name,
        file_size=size,
        source_file_key=key,
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


@router.put("/tasks/{task_id}/screenplay", response_model=UpdateScreenplayResponse)
def update_screenplay(
    task_id: int,
    body: UpdateScreenplayRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Save edited screenplay YAML and re-parse to update statistics."""
    task = db.query(ConversionTask).filter(
        ConversionTask.id == task_id,
        ConversionTask.user_id == current_user.id,
    ).first()
    if not task or task.status != "completed":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Screenplay not available")

    if not task.screenplay:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Screenplay data not found")

    # Validate YAML by parsing it
    from src.schema import ScreenplayYAML
    try:
        sp = ScreenplayYAML.parse_yaml(body.yaml_content)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"YAML 格式无效: {str(e)}",
        )

    # Update stats from parsed YAML
    record = task.screenplay
    record.yaml_content = body.yaml_content
    record.title = sp.meta.title
    record.character_count = len(sp.characters)
    record.act_count = sp.meta.total_acts
    record.scene_count = sp.meta.total_scenes
    db.commit()

    # Re-upload to COS
    if task.yaml_file_key:
        try:
            cos.upload_object(task.yaml_file_key, body.yaml_content.encode("utf-8"), "application/x-yaml")
        except Exception as e:
            logger.warning("Failed to update YAML in COS: %s", e)

    return UpdateScreenplayResponse(
        title=record.title,
        character_count=record.character_count,
        act_count=record.act_count,
        scene_count=record.scene_count,
    )


@router.post("/tasks/{task_id}/chat", response_model=ChatEditResponse)
async def chat_edit(
    task_id: int,
    body: ChatEditRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """AI chat assistant — natural language screenplay editing with persistent memory.

    Messages are saved to DB and recent context (last 12) is sent to the LLM.
    The modified YAML is NOT saved automatically — use PUT /screenplay to confirm.
    """
    task = db.query(ConversionTask).filter(
        ConversionTask.id == task_id,
        ConversionTask.user_id == current_user.id,
    ).first()
    if not task or task.status != "completed":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found or not completed")

    history = None
    if body.conversation_history:
        history = [{"role": m.role, "content": m.content} for m in body.conversation_history]

    try:
        result = await chat_svc.chat_edit(
            current_yaml=body.current_yaml,
            instruction=body.instruction,
            db=db,
            user_id=current_user.id,
            task_id=task_id,
            session_id=body.session_id,
            conversation_history=history,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e))
    except Exception as e:
        logger.exception("Chat edit failed for task %d", task_id)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"AI 编辑失败: {str(e)}")

    return ChatEditResponse(
        modified_yaml=result["modified_yaml"],
        change_summary=result["change_summary"],
        changes=result.get("changes", []),
        session_id=result.get("session_id"),
    )


# ---------------------------------------------------------------------------
# Chat session — history persistence
# ---------------------------------------------------------------------------

@router.get("/tasks/{task_id}/chat/session", response_model=ChatSessionResponse)
def get_chat_session(
    task_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get or create the chat session for a task, with full message history."""
    task = db.query(ConversionTask).filter(
        ConversionTask.id == task_id,
        ConversionTask.user_id == current_user.id,
    ).first()
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")

    session = chat_svc.get_or_create_session(db, current_user.id, task_id)
    messages = chat_svc.get_all_messages(db, session.id)

    # Build message responses with parsed changes
    msg_responses: list[ChatMessageResponse] = []
    for m in messages:
        changes = None
        if m.changes_json:
            try:
                changes = json.loads(m.changes_json)
            except (json.JSONDecodeError, TypeError):
                pass

        msg_responses.append(ChatMessageResponse(
            id=m.id,
            role=m.role,
            content=m.content,
            change_summary=m.change_summary,
            changes=changes,
            accepted=m.accepted,
            rejected=m.rejected,
            created_at=m.created_at,
        ))

    return ChatSessionResponse(
        session_id=session.id,
        title=session.title,
        message_count=session.message_count or 0,
        messages=msg_responses,
        created_at=session.created_at,
        updated_at=session.updated_at,
    )


@router.delete("/tasks/{task_id}/chat/session", status_code=status.HTTP_204_NO_CONTENT)
def delete_chat_session(
    task_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Delete the chat session and all messages for a task."""
    session = db.query(ChatSession).filter(
        ChatSession.user_id == current_user.id,
        ChatSession.task_id == task_id,
    ).first()
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")

    chat_svc.delete_session(db, session.id)


@router.get("/tasks/{task_id}/chat/session/export")
def export_chat_session(
    task_id: int,
    format: str = Query("json", regex="^(json|markdown)$"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """导出对话历史为 JSON 或 Markdown 文件。"""
    from fastapi.responses import Response

    session = db.query(ChatSession).filter(
        ChatSession.user_id == current_user.id,
        ChatSession.task_id == task_id,
    ).first()
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")

    messages = chat_svc.get_all_messages(db, session.id)

    # 获取任务名称用于文件名
    task = db.query(ConversionTask).filter(ConversionTask.id == task_id).first()
    safe_name = Path(task.original_filename).stem if task else f"chat_task{task_id}"

    if format == "markdown":
        content = _export_markdown(session, messages)
        filename = f"{safe_name}_chat.md"
        media_type = "text/markdown; charset=utf-8"
    else:
        content = _export_json(session, messages)
        filename = f"{safe_name}_chat.json"
        media_type = "application/json; charset=utf-8"

    return Response(
        content=content.encode("utf-8"),
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _export_json(session: ChatSession, messages: list) -> str:
    """导出为 JSON 格式。"""
    items = []
    for m in messages:
        item = {
            "id": m.id,
            "role": m.role,
            "content": m.content,
            "created_at": m.created_at.isoformat() if m.created_at else None,
        }
        if m.role == "assistant":
            item["change_summary"] = m.change_summary
            if m.changes_json:
                try:
                    item["changes"] = json.loads(m.changes_json)
                except (json.JSONDecodeError, TypeError):
                    pass
            item["accepted"] = m.accepted
            item["rejected"] = m.rejected
        items.append(item)

    result = {
        "session_id": session.id,
        "title": session.title,
        "task_id": session.task_id,
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "messages": items,
    }
    return json.dumps(result, ensure_ascii=False, indent=2)


def _export_markdown(session: ChatSession, messages: list) -> str:
    """导出为 Markdown 对话记录。"""
    lines = [
        f"# 对话记录 — {session.title or '未命名'}",
        "",
        f"- Session ID: {session.id}",
        f"- 消息总数: {len(messages)}",
        f"- 导出时间: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')}",
        "",
        "---",
        "",
    ]

    for m in messages:
        role_label = {"user": "**用户**", "assistant": "**AI 编剧助理**", "system": "**系统**"}.get(m.role, m.role)
        time_str = m.created_at.strftime("%Y-%m-%d %H:%M:%S") if m.created_at else ""
        lines.append(f"### {role_label} ({time_str})")
        lines.append("")
        lines.append(m.content)
        lines.append("")

        if m.role == "assistant":
            if m.change_summary:
                lines.append(f"> 修改摘要: {m.change_summary}")
                lines.append("")
            if m.changes_json:
                try:
                    changes = json.loads(m.changes_json)
                    for ch in changes:
                        ch_type = {"modify": "修改", "add": "新增", "delete": "删除"}.get(ch.get("type", ""), ch.get("type", ""))
                        lines.append(f"- [{ch_type}] {ch.get('target', '')}: {ch.get('description', '')}")
                    lines.append("")
                except (json.JSONDecodeError, TypeError):
                    pass
            if m.accepted:
                lines.append("> 状态: 已接受")
                lines.append("")
            elif m.rejected:
                lines.append("> 状态: 已拒绝")
                lines.append("")

        lines.append("---")
        lines.append("")

    return "\n".join(lines)
def download_yaml(
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

    # Prefer COS redirect
    if task.yaml_file_key:
        return RedirectResponse(url=cos.generate_presigned_download(task.yaml_file_key))

    # Fallback: serve from DB
    if task.screenplay and task.screenplay.yaml_content:
        from fastapi.responses import Response
        safe_name = Path(task.original_filename).stem + "_screenplay.yaml"
        return Response(
            content=task.screenplay.yaml_content.encode("utf-8"),
            media_type="application/x-yaml",
            headers={"Content-Disposition": f'attachment; filename="{safe_name}"'},
        )

    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="YAML not available")


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

    # Delete COS objects
    if task.source_file_key:
        cos.delete_object(task.source_file_key)
    if task.yaml_file_key:
        cos.delete_object(task.yaml_file_key)

    # Delete local temp files (if any remain)
    for p in [task.file_path]:
        if p:
            try:
                Path(p).unlink(missing_ok=True)
            except OSError:
                pass

    db.delete(task)
    db.commit()
