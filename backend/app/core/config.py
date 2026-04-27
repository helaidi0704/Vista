"""
VISTA — Application Configuration
Loads from environment variables (Docker Compose injects them).
"""
from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    # ─── App ───
    app_name: str = "VISTA API"
    app_version: str = "0.1.0"
    debug: bool = True
    secret_key: str = "vista-jwt-secret-change-in-prod"

    # ─── PostgreSQL ───
    postgres_host: str = "db"
    postgres_port: int = 5432
    postgres_db: str = "vista"
    postgres_user: str = "vista"
    postgres_password: str = "vista_dev_2024"

    @property
    def database_url(self) -> str:
        return (
            f"postgresql+asyncpg://{self.postgres_user}:{self.postgres_password}"
            f"@{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"
        )

    # ─── Redis ───
    redis_url: str = "redis://redis:6379/0"

    # ─── Celery ───
    celery_broker_url: str = "redis://redis:6379/0"
    celery_result_backend: str = "redis://redis:6379/1"

    # ─── MinIO ───
    minio_endpoint: str = "minio:9000"
    minio_access_key: str = "vistaadmin"
    minio_secret_key: str = "vistaSecretKey2024"
    minio_bucket_images: str = "images-raw"
    minio_bucket_models: str = "models-weights"
    minio_bucket_exports: str = "exports"
    minio_use_ssl: bool = False

    # ─── JWT ───
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60 * 24  # 24 hours

    class Config:
        env_file = ".env"
        case_sensitive = False


@lru_cache()
def get_settings() -> Settings:
    return Settings()
