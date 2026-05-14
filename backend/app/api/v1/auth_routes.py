"""
VISTA — Auth API Routes
Login, register, profile, organization management.
"""
from datetime import timedelta
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.auth import (
    hash_password, verify_password, create_access_token,
    get_current_user, require_auth, require_admin,
)

router = APIRouter(prefix="/api/v1/auth", tags=["Authentication"])


# ─── Schemas ──────────────────────────────────────────────────

class LoginRequest(BaseModel):
    email: str
    password: str

class RegisterRequest(BaseModel):
    email: str
    password: str
    full_name: str
    organization_name: Optional[str] = None

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: dict

class OrgCreate(BaseModel):
    name: str
    slug: str
    plan: str = "free"


# ─── Login ────────────────────────────────────────────────────

@router.post("/login", response_model=TokenResponse)
async def login(req: LoginRequest, db: AsyncSession = Depends(get_db)):
    """Authenticate user, return JWT token."""
    result = await db.execute(
        text("SELECT id, email, full_name, role, hashed_password, organization_id, is_active FROM users WHERE email = :email"),
        {"email": req.email}
    )
    user = result.mappings().fetchone()

    if not user or not verify_password(req.password, user["hashed_password"]):
        raise HTTPException(401, "Invalid email or password")
    if not user["is_active"]:
        raise HTTPException(403, "Account disabled")

    # Get organization info
    org_name = None
    if user["organization_id"]:
        org_result = await db.execute(
            text("SELECT name, slug, plan FROM organizations WHERE id = :id"),
            {"id": str(user["organization_id"])}
        )
        org = org_result.mappings().fetchone()
        if org:
            org_name = org["name"]

    token = create_access_token({
        "sub": str(user["id"]),
        "email": user["email"],
        "role": user["role"],
        "org_id": str(user["organization_id"]) if user["organization_id"] else None,
    })

    return TokenResponse(
        access_token=token,
        user={
            "id": str(user["id"]),
            "email": user["email"],
            "full_name": user["full_name"],
            "role": user["role"],
            "organization": org_name,
        }
    )


# ─── Register ─────────────────────────────────────────────────

@router.post("/register", response_model=TokenResponse)
async def register(req: RegisterRequest, db: AsyncSession = Depends(get_db)):
    """Register a new user. Creates a new organization if name provided."""
    # Check if email exists
    existing = await db.execute(
        text("SELECT id FROM users WHERE email = :email"), {"email": req.email}
    )
    if existing.scalar():
        raise HTTPException(400, "Email already registered")

    org_id = None

    # Create organization if name provided
    if req.organization_name:
        slug = req.organization_name.lower().replace(" ", "-").replace("_", "-")
        # Check slug uniqueness
        slug_check = await db.execute(
            text("SELECT id FROM organizations WHERE slug = :slug"), {"slug": slug}
        )
        if slug_check.scalar():
            raise HTTPException(400, f"Organization slug '{slug}' already taken")

        org_result = await db.execute(
            text("""
                INSERT INTO organizations (name, slug, plan)
                VALUES (:name, :slug, 'free')
                RETURNING id
            """),
            {"name": req.organization_name, "slug": slug}
        )
        org_id = str(org_result.scalar())
    else:
        # Assign to default org
        org_id = "a0000000-0000-0000-0000-000000000001"

    # Create user
    hashed = hash_password(req.password)
    user_result = await db.execute(
        text("""
            INSERT INTO users (email, hashed_password, full_name, role, organization_id)
            VALUES (:email, :pwd, :name, :role, :org_id)
            RETURNING id
        """),
        {
            "email": req.email, "pwd": hashed, "name": req.full_name,
            "role": "admin" if req.organization_name else "client",
            "org_id": org_id,
        }
    )
    user_id = str(user_result.scalar())

    token = create_access_token({
        "sub": user_id, "email": req.email,
        "role": "admin" if req.organization_name else "client",
        "org_id": org_id,
    })

    return TokenResponse(
        access_token=token,
        user={
            "id": user_id, "email": req.email,
            "full_name": req.full_name,
            "role": "admin" if req.organization_name else "client",
            "organization": req.organization_name or "VISTA Demo",
        }
    )


# ─── Profile ──────────────────────────────────────────────────

@router.get("/me")
async def get_profile(user=Depends(require_auth), db: AsyncSession = Depends(get_db)):
    """Get current user profile with organization details."""
    org = None
    if user["organization_id"]:
        org_result = await db.execute(
            text("SELECT name, slug, plan, max_images, max_models, max_users FROM organizations WHERE id = :id"),
            {"id": str(user["organization_id"])}
        )
        org = dict(org_result.mappings().fetchone()) if org_result else None

    # Usage stats for this org
    stats = {}
    if user["organization_id"]:
        img_count = await db.execute(
            text("SELECT COUNT(*) FROM images i JOIN datasets d ON i.dataset_id = d.id WHERE d.organization_id = :org"),
            {"org": str(user["organization_id"])}
        )
        model_count = await db.execute(
            text("SELECT COUNT(*) FROM ml_models WHERE organization_id = :org"),
            {"org": str(user["organization_id"])}
        )
        user_count = await db.execute(
            text("SELECT COUNT(*) FROM users WHERE organization_id = :org"),
            {"org": str(user["organization_id"])}
        )
        stats = {
            "images_used": img_count.scalar() or 0,
            "models_used": model_count.scalar() or 0,
            "users_count": user_count.scalar() or 0,
        }

    return {
        "user": user,
        "organization": org,
        "usage": stats,
    }


# ─── Organization management (admin only) ────────────────────

@router.get("/organizations")
async def list_organizations(user=Depends(require_admin), db: AsyncSession = Depends(get_db)):
    """List all organizations (super admin only)."""
    result = await db.execute(text("SELECT * FROM organizations ORDER BY created_at DESC"))
    return [dict(r) for r in result.mappings().fetchall()]


@router.post("/organizations")
async def create_organization(req: OrgCreate, user=Depends(require_admin), db: AsyncSession = Depends(get_db)):
    """Create a new organization (super admin only)."""
    result = await db.execute(
        text("""
            INSERT INTO organizations (name, slug, plan)
            VALUES (:name, :slug, :plan) RETURNING id, name, slug, plan
        """),
        {"name": req.name, "slug": req.slug, "plan": req.plan}
    )
    return dict(result.mappings().fetchone())


@router.get("/users")
async def list_org_users(user=Depends(require_auth), db: AsyncSession = Depends(get_db)):
    """List users in the current organization."""
    result = await db.execute(
        text("SELECT id, email, full_name, role, is_active, created_at FROM users WHERE organization_id = :org ORDER BY created_at"),
        {"org": str(user["organization_id"])}
    )
    return [dict(r) for r in result.mappings().fetchall()]
