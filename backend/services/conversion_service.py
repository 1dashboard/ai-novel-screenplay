"""Conversion service: progress-tracking LLM wrapper + background task orchestration."""

from __future__ import annotations

import asyncio
import logging
import os
import traceback
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

from sqlalchemy.orm import Session

from ..config import settings
from ..database import SessionLocal
from ..models.task import ConversionTask
from ..models.screenplay import ScreenplayRecord
from . import cos_service as cos
from .stream import push as stream_push

logger = logging.getLogger(__name__)


class TaskDeletedError(Exception):
    """Raised when a task is deleted during conversion — stops processing."""


def _cleanup_temp_file(file_path: str) -> None:
    """Safely remove a temporary file, ignoring errors."""
    try:
        if file_path and os.path.exists(file_path):
            os.remove(file_path)
    except OSError:
        pass


# ---------------------------------------------------------------------------
# Progress-tracked LLM client wrapper
# ---------------------------------------------------------------------------

class ProgressTrackedLLMClient:
    """Wraps the existing LLMClient to report progress after each chapter analysis.

    Uses composition instead of inheritance to avoid issues with the existing
    LLMClient's provider selection logic.
    """

    def __init__(self, chapter_count: int, progress_callback: Callable[[int, str], None]):
        self._total = chapter_count
        self._done = 0
        self._callback = progress_callback

    def wrap(self, original_client) -> ProgressTrackedLLMClient:
        """Store a reference to the real LLMClient and return self."""
        self._original = original_client
        return self

    @property
    def model(self):
        return getattr(self._original, "model", "")

    @model.setter
    def model(self, value):
        self._original.model = value

    def analyze_chapter(self, chapter_number: int, chapter_title: str, chapter_text: str, known_characters=None):
        self._callback(
            10 + int(80 * self._done / max(self._total, 1)),
            f"正在分析第 {self._done + 1}/{self._total} 章：{chapter_title}",
        )
        result = self._original.analyze_chapter(chapter_number, chapter_title, chapter_text, known_characters)
        self._done += 1
        percent = 10 + int(80 * self._done / max(self._total, 1))
        self._callback(percent, f"第 {self._done}/{self._total} 章分析完成")
        return result


# ---------------------------------------------------------------------------
# Background conversion runner
# ---------------------------------------------------------------------------

def _sync_run_conversion(task_id: int, file_path: str, output_path: str, config_path: str):
    """Run the full conversion in a synchronous thread, updating DB progress."""
    from src.parsers.base import BaseParser
    from src.converter import NovelToScriptConverter

    db: Session = SessionLocal()
    try:
        task = db.query(ConversionTask).filter(ConversionTask.id == task_id).first()
        if not task:
            return

        # --- Parse file to count chapters (fast, no LLM) ---
        parser = BaseParser.get_parser_for(file_path)
        novel = parser.parse(file_path)
        chapter_count = len(novel.chapters)

        def progress_callback(percent: int, message: str):
            """Update progress in DB from the worker thread."""
            task_db: Session = SessionLocal()
            try:
                t = task_db.query(ConversionTask).filter(ConversionTask.id == task_id).first()
                if t is None:
                    raise TaskDeletedError("Task was deleted during conversion")
                t.status = "processing"
                t.progress = percent
                t.progress_message = message
                task_db.commit()
            finally:
                task_db.close()
            stream_push(task_id, "progress", progress=percent, message=message)
            stream_push(task_id, "log", text=f"[分析阶段] {message}\n")

        # --- Phase 1 complete ---
        task.status = "processing"
        task.progress = 5
        task.progress_message = f"解析完成，检测到 {chapter_count} 章"
        task.chapter_count = chapter_count
        db.commit()
        stream_push(task_id, "progress", progress=5, message=f"解析完成，检测到 {chapter_count} 章", chapter_count=chapter_count)
        stream_push(task_id, "log", text=f"[解析阶段] 文件解析完成，共 {chapter_count} 章\n")

        # --- Create converter and inject progress-tracked LLM client ---
        converter = NovelToScriptConverter(config_path=config_path)

        if converter.llm is not None:
            tracked = ProgressTrackedLLMClient(chapter_count, progress_callback)
            tracked.wrap(converter.llm)
            converter.llm = tracked
            # Apply custom prompt if the task has one
            if task.custom_prompt:
                converter.llm._original.custom_system_prompt = task.custom_prompt
            task.llm_provider = getattr(tracked, "_original", None) and getattr(
                tracked._original, "provider", None
            )
            task.llm_model = getattr(converter.llm, "model", "")
            db.commit()

        # --- Run conversion ---
        screenplay = converter.convert(file_path, output_path, use_llm=(converter.llm is not None))
        progress_callback(92, "正在组装剧本结构...")
        stream_push(task_id, "log", text="[组装阶段] 正在合并角色、分配场景编号、划分幕结构...\n")
        progress_callback(96, "正在评估剧本质量...")
        stream_push(task_id, "log", text="[评估阶段] 正在对剧本进行质量评估...\n")

        # --- Parse evaluation result ---
        eval_path = Path(output_path).with_suffix(".eval.txt")
        eval_summary = ""
        score = None
        if eval_path.exists():
            eval_summary = eval_path.read_text(encoding="utf-8")
            # Replace temp file path with original filename in the report
            eval_summary = eval_summary.replace(
                str(Path(output_path).resolve()),
                task.original_filename,
            )
            for line in eval_summary.splitlines():
                if "综合评分" in line:
                    try:
                        score = int(line.split("：")[1].split("/")[0])
                    except (IndexError, ValueError):
                        pass
                    break

        # --- Store screenplay record ---
        yaml_content = Path(output_path).read_text(encoding="utf-8")
        record = ScreenplayRecord(
            task_id=task_id,
            user_id=task.user_id,
            title=screenplay.meta.title,
            character_count=len(screenplay.characters),
            act_count=screenplay.meta.total_acts,
            scene_count=screenplay.meta.total_scenes,
            score=score,
            yaml_content=yaml_content,
            eval_summary=eval_summary,
        )
        db.add(record)

        # --- Mark completed ---
        task.status = "completed"
        task.progress = 100
        task.progress_message = "转换完成"
        task.screenplay_yaml_path = output_path
        task.eval_report_path = str(eval_path) if eval_path.exists() else None
        task.completed_at = datetime.now(timezone.utc)
        db.commit()

        # --- Upload YAML result to COS ---
        yaml_key = cos.generate_result_key(task.user_id, task_id, ".yaml")
        try:
            cos.upload_object(yaml_key, yaml_content.encode("utf-8"), "application/x-yaml")
            task.yaml_file_key = yaml_key
            db.commit()
        except Exception as e:
            logger.warning("Failed to upload YAML to COS: %s", e)

        stream_push(task_id, "log", text="\n[完成] 剧本转换完毕！\n")
        stream_push(task_id, "yaml_chunk", text=yaml_content)
        stream_push(task_id, "complete",
            progress=100, message="转换完成",
            screenplay_id=record.id,
            score=score,
            chapter_count=chapter_count,
            character_count=len(screenplay.characters),
            scene_count=screenplay.meta.total_scenes,
        )

        # Clean up temp files
        _cleanup_temp_file(file_path)
        _cleanup_temp_file(output_path)
        if eval_path.exists():
            _cleanup_temp_file(str(eval_path))

    except TaskDeletedError:
        logger.info("Conversion task %d was deleted during processing — aborting", task_id)
        _cleanup_temp_file(file_path)
        _cleanup_temp_file(output_path)
    except Exception as e:
        logger.exception("Conversion task %d failed", task_id)
        err_msg = traceback.format_exc()
        stream_push(task_id, "log", text=f"\n[错误] 转换失败：{str(e)}\n")
        stream_push(task_id, "error", message=str(e))
        try:
            task = db.query(ConversionTask).filter(ConversionTask.id == task_id).first()
            if task:
                task.status = "failed"
                task.progress = 0
                task.error_message = err_msg
                task.completed_at = datetime.now(timezone.utc)
                db.commit()
        except Exception:
            pass
    finally:
        db.close()


async def enqueue_conversion(task: ConversionTask, model_override: str | None = None) -> None:
    """Kick off a background conversion task."""
    output_path = str(Path(task.file_path).with_suffix(".yaml"))
    if model_override:
        task.llm_model = model_override
        db = SessionLocal()
        try:
            db.merge(task)
            db.commit()
        finally:
            db.close()

    await asyncio.to_thread(
        _sync_run_conversion,
        task.id,
        task.file_path,
        output_path,
        settings.config_path,
    )
