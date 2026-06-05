"""Authentication service: JWT tokens, password hashing, token rotation."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy.orm import Session

from ..config import settings
from ..models.user import RefreshToken, User

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


# ---------------------------------------------------------------------------
# Password helpers
# ---------------------------------------------------------------------------

def hash_password(plain: str) -> str:
    return pwd_context.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


# ---------------------------------------------------------------------------
# JWT helpers
# ---------------------------------------------------------------------------

def create_access_token(user_id: int, role: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.access_token_expire_minutes)
    payload = {"sub": str(user_id), "role": role, "type": "access", "exp": expire}
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def create_refresh_token(user_id: int) -> str:
    expire = datetime.now(timezone.utc) + timedelta(days=settings.refresh_token_expire_days)
    payload = {"sub": str(user_id), "type": "refresh", "exp": expire}
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_token(token: str) -> dict | None:
    try:
        return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except JWTError:
        return None


# ---------------------------------------------------------------------------
# Token persistence (single-use rotation)
# ---------------------------------------------------------------------------

def store_refresh_token(db: Session, user_id: int, token: str) -> RefreshToken:
    payload = decode_token(token)
    expires_at = datetime.fromtimestamp(payload["exp"], tz=timezone.utc) if payload else None
    rt = RefreshToken(user_id=user_id, token=token, expires_at=expires_at)
    db.add(rt)
    db.commit()
    return rt


def verify_and_rotate_refresh_token(db: Session, raw_token: str) -> tuple[RefreshToken, User] | None:
    """Validate a refresh token, revoke it, and return the associated user."""
    payload = decode_token(raw_token)
    if not payload or payload.get("type") != "refresh":
        return None

    rt = db.query(RefreshToken).filter(
        RefreshToken.token == raw_token,
        RefreshToken.revoked == False,
    ).first()

    if not rt:
        return None

    # Check expiry
    if rt.expires_at and rt.expires_at < datetime.now(timezone.utc):
        rt.revoked = True
        db.commit()
        return None

    # Single-use: revoke the used token
    rt.revoked = True
    db.commit()

    return rt.user


def revoke_user_refresh_tokens(db: Session, user_id: int) -> None:
    db.query(RefreshToken).filter(
        RefreshToken.user_id == user_id,
        RefreshToken.revoked == False,
    ).update({"revoked": True})
    db.commit()


# ---------------------------------------------------------------------------
# Password reset
# ---------------------------------------------------------------------------

def create_reset_token(user_id: int) -> str:
    """Create a short-lived JWT for password reset (1 hour)."""
    expire = datetime.now(timezone.utc) + timedelta(hours=1)
    payload = {"sub": str(user_id), "type": "reset", "exp": expire}
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def store_reset_token(db: Session, user_id: int, token: str) -> "PasswordResetToken":
    from ..models.user import PasswordResetToken

    payload = decode_token(token)
    expires_at = datetime.fromtimestamp(payload["exp"], tz=timezone.utc) if payload else None
    rt = PasswordResetToken(user_id=user_id, token=token, expires_at=expires_at)
    db.add(rt)
    db.commit()
    return rt


def verify_reset_token(db: Session, token: str) -> "User | None":
    """Validate a password reset token. Returns the user if valid, None otherwise."""
    from ..models.user import PasswordResetToken

    payload = decode_token(token)
    if not payload or payload.get("type") != "reset":
        return None

    rt = db.query(PasswordResetToken).filter(
        PasswordResetToken.token == token,
        PasswordResetToken.used == False,
    ).first()

    if not rt:
        return None

    if rt.expires_at and rt.expires_at < datetime.now(timezone.utc):
        rt.used = True
        db.commit()
        return None

    rt.used = True
    db.commit()

    return rt.user
