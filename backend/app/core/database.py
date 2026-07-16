from collections.abc import Generator
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import get_settings

settings = get_settings()

engine = create_engine(settings.database_url, pool_pre_ping=True, future=True)

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


class Base(DeclarativeBase):
    """Declarative base class for all ORM models."""


def get_db() -> Generator[Session, None, None]:
    """FastAPI dependency yielding a SQLAlchemy session, closed after the request."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_repo_root() -> Path:
    """Resolve the monorepo root directory (parent of backend/)."""
    return Path(__file__).resolve().parents[3]


def get_data_dir() -> Path:
    """Resolve the configured data directory as an absolute path, relative to the repo root."""
    data_dir = Path(settings.data_dir)
    if data_dir.is_absolute():
        return data_dir
    return get_repo_root() / data_dir
