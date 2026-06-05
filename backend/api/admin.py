"""Admin routes: stats, user management."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.user import User
from ..schemas.admin import SystemStats, UserAdminListResponse, UserAdminResponse, UserUpdateRequest
from ..services import admin_service

from .deps import get_current_admin, get_current_user

router = APIRouter(tags=["admin"])


@router.get("/stats", response_model=SystemStats)
def get_stats(db: Session = Depends(get_db), _admin: User = Depends(get_current_admin)):
    return admin_service.get_system_stats(db)


@router.get("/users", response_model=UserAdminListResponse)
def list_users(
    search: str = "",
    role: str = "",
    limit: int = 20,
    offset: int = 0,
    db: Session = Depends(get_db),
    _admin: User = Depends(get_current_admin),
):
    result = admin_service.get_users_list(db, search=search, role=role, limit=limit, offset=offset)
    return result


@router.get("/users/{user_id}", response_model=UserAdminResponse)
def get_user(user_id: int, db: Session = Depends(get_db), _admin: User = Depends(get_current_admin)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return {
        "id": user.id,
        "username": user.username,
        "email": user.email,
        "role": user.role,
        "is_active": user.is_active,
        "task_count": len(user.tasks),
        "created_at": user.created_at,
    }


@router.put("/users/{user_id}", response_model=UserAdminResponse)
def update_user(
    user_id: int,
    body: UserUpdateRequest,
    db: Session = Depends(get_db),
    _admin: User = Depends(get_current_admin),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if user_id == _admin.id and body.role is not None and body.role != "admin":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot demote yourself")

    if body.role is not None:
        if body.role not in ("user", "admin"):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid role")
        user.role = body.role
    if body.is_active is not None:
        user.is_active = body.is_active

    db.commit()
    db.refresh(user)
    return {
        "id": user.id,
        "username": user.username,
        "email": user.email,
        "role": user.role,
        "is_active": user.is_active,
        "task_count": len(user.tasks),
        "created_at": user.created_at,
    }


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    _admin: User = Depends(get_current_admin),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if user.id == _admin.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot delete yourself")

    db.delete(user)
    db.commit()
