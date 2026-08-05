from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette import status

from app.api.annotations import router as annotations_router
from app.api.health import router as health_router
from app.api.images import router as images_router
from app.core.config import get_settings


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title=settings.service_name,
        description="Minimal FastAPI backend for the VISTA project.",
        version="0.1.0",
        docs_url="/docs",
        redoc_url="/redoc",
        openapi_url="/openapi.json",
    )

    if settings.environment == "local":
        app.add_middleware(
            CORSMiddleware,
            allow_origin_regex=r"^https?://localhost(:\d+)?$",
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )
    else:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=["http://localhost:4200", "http://localhost:4201"],
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(
        request: Request,
        exc: Exception,
    ) -> JSONResponse:
        del request, exc
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={
                "status": "error",
                "service": settings.service_name,
                "message": (
                    "An unexpected backend error occurred. No sensitive details are exposed."
                ),
            },
        )

    @app.get("/", tags=["root"])
    def root() -> dict[str, str]:
        return {
            "service": settings.service_name,
            "status": "ok",
            "message": "Backend API is ready",
        }

    app.include_router(health_router)
    app.include_router(images_router, prefix=settings.api_prefix)
    app.include_router(annotations_router, prefix=settings.api_prefix)
    return app


app = create_app()
