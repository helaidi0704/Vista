"""
VISTA — Authentication & Authorization
JWT tokens, password hashing, role-based access, tenant isolation.
"""
import os
from datetime import datetime, timedelta
from typing import Optional
from uuid import UUID

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.config import get_settings

settings = get_settings()

# Password hashing
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# JWT config
SECRET_KEY = settings.secret_key
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_HOURS = 24

# Bearer token extractor
security = HTTPBearer(auto_error=False)


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + (expires_delta or timedelta(hours=ACCESS_TOKEN_EXPIRE_HOURS))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def decode_token(token: str) -> dict:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )


async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    db: AsyncSession = Depends(get_db),
):
    """
    Extract and validate the current user from JWT token.
    Returns user dict with id, email, role, organization_id.
    If no token provided, returns None (for public endpoints).
    """
    if not credentials:
        return None

    payload = decode_token(credentials.credentials)
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(401, "Invalid token payload")

    result = await db.execute(
        text("SELECT id, email, full_name, role, organization_id, is_active FROM users WHERE id = :id"),
        {"id": user_id}
    )
    user = result.mappings().fetchone()
    if not user:
        raise HTTPException(401, "User not found")
    if not user["is_active"]:
        raise HTTPException(403, "Account disabled")

    return dict(user)


async def require_auth(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: AsyncSession = Depends(get_db),
):
    """Require authentication — returns user or raises 401."""
    if not credentials:
        raise HTTPException(401, "Authentication required")
    return await get_current_user(credentials, db)


async def require_admin(user=Depends(require_auth)):
    """Require admin role."""
    if user["role"] != "admin":
        raise HTTPException(403, "Admin access required")
    return user


async def require_engineer(user=Depends(require_auth)):
    """Require engineer or admin role."""
    if user["role"] not in ("admin", "engineer"):
        raise HTTPException(403, "Engineer access required")
    return user
