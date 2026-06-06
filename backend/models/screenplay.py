"""Screenplay record ORM model — stores structured metadata for fast API access."""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..database import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class ScreenplayRecord(Base):
    __tablename__ = "screenplays"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    task_id: Mapped[int] = mapped_column(Integer, ForeignKey("conversion_tasks.id"), unique=True, nullable=False)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    character_count: Mapped[int] = mapped_column(Integer, nullable=False)
    act_count: Mapped[int] = mapped_column(Integer, nullable=False)
    scene_count: Mapped[int] = mapped_column(Integer, nullable=False)
    score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    yaml_content: Mapped[str] = mapped_column(Text(16777215), nullable=False)  # MEDIUMTEXT
    eval_summary: Mapped[str | None] = mapped_column(Text(16777215), nullable=True)  # MEDIUMTEXT
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=_utcnow)

    task = relationship("ConversionTask", back_populates="screenplay")
