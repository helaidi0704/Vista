import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv

_BACKEND_DIR = Path(__file__).resolve().parents[2]
_REPO_ROOT = _BACKEND_DIR.parent

# The root .env is the single source of truth for shared infra config (DB host/port/
# credentials), read by both docker-compose and this bare-metal backend. backend/.env
# is loaded on top and only overrides backend-process settings (SERVICE_NAME, ...);
# it must not redefine DB_* / DATABASE_URL or the two files can drift out of sync.
load_dotenv(_REPO_ROOT / ".env")
load_dotenv(_BACKEND_DIR / ".env", override=True)


def _database_url() -> str:
    if url := os.getenv("DATABASE_URL"):
        return url
    host = os.getenv("DB_HOST", "localhost")
    port = os.getenv("DB_PORT", "5442")
    user = os.getenv("DB_USER", "vista")
    password = os.getenv("DB_PASSWORD", "vista")
    name = os.getenv("DB_NAME", "vista")
    return f"postgresql+psycopg2://{user}:{password}@{host}:{port}/{name}"


@dataclass(frozen=True)
class Settings:
    service_name: str
    environment: str
    api_prefix: str
    database_url: str
    data_dir: str


@lru_cache
def get_settings() -> Settings:
    return Settings(
        service_name=os.getenv("SERVICE_NAME", "backend"),
        environment=os.getenv("ENVIRONMENT", "local"),
        api_prefix=os.getenv("API_PREFIX", "/api"),
        database_url=_database_url(),
        data_dir=os.getenv("DATA_DIR", "data"),
    )
