"""Admin service: system stats and user management queries."""

from __future__ import annotations

from sqlalchemy import func
from sqlalchemy.orm import Session

from ..models.task import ConversionTask
from ..models.user import User


def get_system_stats(db: Session) -> dict:
    total_users = db.query(func.count(User.id)).scalar()
    total_tasks = db.query(func.count(ConversionTask.id)).scalar()
    completed = db.query(func.count(ConversionTask.id)).filter(ConversionTask.status == "completed").scalar()
    failed = db.query(func.count(ConversionTask.id)).filter(ConversionTask.status == "failed").scalar()
    processing = db.query(func.count(ConversionTask.id)).filter(
        ConversionTask.status.in_(["pending", "processing"])
    ).scalar()

    success_rate = round(completed / total_tasks * 100, 1) if total_tasks else 0.0

    recent = (
        db.query(ConversionTask)
        .order_by(ConversionTask.created_at.desc())
        .limit(10)
        .all()
    )

    return {
        "total_users": total_users,
        "total_tasks": total_tasks,
        "completed_tasks": completed,
        "failed_tasks": failed,
        "processing_tasks": processing,
        "success_rate": success_rate,
        "recent_tasks": [
            {
                "id": t.id,
                "username": t.user.username if t.user else "N/A",
                "original_filename": t.original_filename,
                "status": t.status,
                "created_at": t.created_at.isoformat(),
            }
            for t in recent
        ],
    }


def get_users_list(db: Session, search: str = "", role: str = "", limit: int = 20, offset: int = 0) -> dict:
    q = db.query(User)
    if search:
        q = q.filter(
            (User.username.contains(search)) | (User.email.contains(search))
        )
    if role:
        q = q.filter(User.role == role)

    total = q.count()
    users = q.order_by(User.created_at.desc()).offset(offset).limit(limit).all()

    return {
        "items": [
            {
                "id": u.id,
                "username": u.username,
                "email": u.email,
                "role": u.role,
                "is_active": u.is_active,
                "task_count": len(u.tasks),
                "created_at": u.created_at,
            }
            for u in users
        ],
        "total": total,
        "limit": limit,
        "offset": offset,
    }
