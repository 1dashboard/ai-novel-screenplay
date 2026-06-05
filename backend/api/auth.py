"""Authentication routes: register, login, refresh, logout, me."""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.user import RefreshToken, User
from ..schemas.auth import (
    AuthResponse,
    ForgotPasswordRequest,
    LoginRequest,
    LogoutRequest,
    RefreshRequest,
    RegisterRequest,
    ResetPasswordRequest,
    TokenResponse,
    UserResponse,
)
from ..services import auth_service

from .deps import get_current_user

router = APIRouter(tags=["auth"])


@router.post("/register", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
def register(body: RegisterRequest, db: Session = Depends(get_db)):
    # Uniqueness checks
    if db.query(User).filter(User.username == body.username).first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Username already taken")
    if db.query(User).filter(User.email == body.email).first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")

    user = User(
        username=body.username,
        email=body.email,
        password_hash=auth_service.hash_password(body.password),
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    access = auth_service.create_access_token(user.id, user.role)
    refresh = auth_service.create_refresh_token(user.id)
    auth_service.store_refresh_token(db, user.id, refresh)

    return AuthResponse(
        user=UserResponse.model_validate(user),
        tokens=TokenResponse(access_token=access, refresh_token=refresh),
    )


@router.post("/login", response_model=AuthResponse)
def login(body: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == body.username).first()
    if not user or not auth_service.verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid username or password")
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account is deactivated")

    access = auth_service.create_access_token(user.id, user.role)
    refresh = auth_service.create_refresh_token(user.id)
    auth_service.store_refresh_token(db, user.id, refresh)

    return AuthResponse(
        user=UserResponse.model_validate(user),
        tokens=TokenResponse(access_token=access, refresh_token=refresh),
    )


@router.post("/refresh", response_model=TokenResponse)
def refresh_token(body: RefreshRequest, db: Session = Depends(get_db)):
    result = auth_service.verify_and_rotate_refresh_token(db, body.refresh_token)
    if not result:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired refresh token")

    rt, user = result
    access = auth_service.create_access_token(user.id, user.role)
    refresh = auth_service.create_refresh_token(user.id)
    auth_service.store_refresh_token(db, user.id, refresh)

    return TokenResponse(access_token=access, refresh_token=refresh)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(body: LogoutRequest, db: Session = Depends(get_db)):
    rt = db.query(RefreshToken).filter(RefreshToken.token == body.refresh_token).first()
    if rt:
        rt.revoked = True
        db.commit()
    # Always return 204 even if token not found (idempotent)


@router.get("/me", response_model=UserResponse)
def me(current_user: User = Depends(get_current_user)):
    return UserResponse.model_validate(current_user)


@router.post("/forgot-password", status_code=status.HTTP_200_OK)
def forgot_password(body: ForgotPasswordRequest, db: Session = Depends(get_db)):
    """Request a password reset. In production the token would be emailed."""
    user = db.query(User).filter(User.email == body.email).first()
    if not user:
        # Return 200 even if email not found to prevent email enumeration
        return {"detail": "If that email is registered, a reset token has been dispatched."}

    token = auth_service.create_reset_token(user.id)
    auth_service.store_reset_token(db, user.id, token)

    return {"detail": "If that email is registered, a reset token has been dispatched.", "token": token}


@router.post("/reset-password", status_code=status.HTTP_200_OK)
def reset_password(body: ResetPasswordRequest, db: Session = Depends(get_db)):
    """Reset password using a valid reset token."""
    user = auth_service.verify_reset_token(db, body.token)
    if not user:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired reset token")

    user.password_hash = auth_service.hash_password(body.new_password)
    user.updated_at = datetime.now(timezone.utc)  # noqa: F821
    db.commit()

    # Revoke all existing refresh tokens for security
    auth_service.revoke_user_refresh_tokens(db, user.id)

    return {"detail": "Password has been reset successfully. Please log in with your new password."}
