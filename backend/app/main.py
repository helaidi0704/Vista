from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from starlette import status

from app.api.health import router as health_router
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
    return app


app = create_app()
