"""
VISTA — FastAPI Application Entry Point
Wires up all routes, CORS, health checks, and startup events.
"""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import get_settings
from app.core.storage import init_buckets
from app.api.v1.routes import router as v1_router
from app.schemas import HealthResponse

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup: init MinIO buckets. Shutdown: cleanup."""
    logger.info("🚀 VISTA API starting up...")
    try:
        await init_buckets()
        logger.info("✅ MinIO buckets initialized")
    except Exception as e:
        logger.warning(f"⚠️  MinIO not ready yet: {e}")
    yield
    logger.info("👋 VISTA API shutting down")


app = FastAPI(
    title="VISTA API",
    description="Visual Inspection for Smart Industrial Applications — REST + WebSocket API",
    version=settings.app_version,
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

# ─── CORS (dev: allow all origins) ────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Restrict in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Routes ───────────────────────────────────────────────────────────────────
app.include_router(v1_router)


# ─── Health Check ─────────────────────────────────────────────────────────────
@app.get("/health", response_model=HealthResponse, tags=["Health"])
async def health_check():
    """
    Returns service status + connectivity to DB, Redis, MinIO.
    Used by Docker healthchecks and load balancers.
    """
    status = {
        "status": "ok",
        "service": "vista-api",
        "version": settings.app_version,
        "database": "unknown",
        "redis": "unknown",
        "minio": "unknown",
    }

    # Check PostgreSQL
    try:
        from app.core.database import engine
        async with engine.connect() as conn:
            await conn.execute(__import__("sqlalchemy").text("SELECT 1"))
        status["database"] = "connected"
    except Exception:
        status["database"] = "disconnected"

    # Check Redis
    try:
        import redis
        r = redis.from_url(settings.redis_url, socket_timeout=2)
        r.ping()
        status["redis"] = "connected"
    except Exception:
        status["redis"] = "disconnected"

    # Check MinIO
    try:
        from app.core.storage import get_s3_client
        s3 = get_s3_client()
        s3.list_buckets()
        status["minio"] = "connected"
    except Exception:
        status["minio"] = "disconnected"

    return status
