"""
VISTA — Test Configuration
Fixtures for database, HTTP client, authentication.
"""
import os
import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from sqlalchemy import text

# Override settings for test environment
os.environ["POSTGRES_HOST"] = os.environ.get("POSTGRES_HOST", "localhost")
os.environ["POSTGRES_PORT"] = os.environ.get("POSTGRES_PORT", "5432")
os.environ["POSTGRES_USER"] = os.environ.get("POSTGRES_USER", "vista")
os.environ["POSTGRES_PASSWORD"] = os.environ.get("POSTGRES_PASSWORD", "vista_test")
os.environ["POSTGRES_DB"] = os.environ.get("POSTGRES_DB", "vista_test")
os.environ["REDIS_URL"] = os.environ.get("REDIS_URL", "redis://localhost:6379/0")
os.environ["SECRET_KEY"] = "test-secret-key-for-testing"

from app.main import app
from app.core.database import engine, get_db
from app.models import Base


@pytest_asyncio.fixture(scope="session")
async def test_engine():
    """Create test database engine."""
    test_url = (
        f"postgresql+asyncpg://{os.environ['POSTGRES_USER']}:{os.environ['POSTGRES_PASSWORD']}"
        f"@{os.environ['POSTGRES_HOST']}:{os.environ['POSTGRES_PORT']}/{os.environ['POSTGRES_DB']}"
    )
    engine = create_async_engine(test_url, echo=False)
    
    # Create all tables
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        # Add uuid extension
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\""))
    
    yield engine
    
    # Cleanup
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()


@pytest_asyncio.fixture
async def db_session(test_engine):
    """Create a test database session with rollback after each test."""
    async_session = sessionmaker(test_engine, class_=AsyncSession, expire_on_commit=False)
    async with async_session() as session:
        yield session
        await session.rollback()


@pytest_asyncio.fixture
async def client(db_session):
    """Create an async HTTP test client."""
    async def override_get_db():
        yield db_session
    
    app.dependency_overrides[get_db] = override_get_db
    
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    
    app.dependency_overrides.clear()


@pytest_asyncio.fixture
async def admin_token(client):
    """Create an admin user and return JWT token."""
    # Create organization
    from sqlalchemy import text as sql_text
    
    # Register admin
    response = await client.post("/api/v1/auth/register", json={
        "email": "testadmin@vista.ai",
        "password": "testpass123",
        "full_name": "Test Admin",
        "organization_name": "Test Org",
    })
    if response.status_code == 200:
        return response.json()["access_token"]
    
    # If already exists, login
    response = await client.post("/api/v1/auth/login", json={
        "email": "testadmin@vista.ai",
        "password": "testpass123",
    })
    return response.json()["access_token"]


@pytest_asyncio.fixture
async def auth_headers(admin_token):
    """Return authorization headers."""
    return {"Authorization": f"Bearer {admin_token}"}
