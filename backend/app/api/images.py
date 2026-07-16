import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends
from fastapi.responses import FileResponse, JSONResponse
from sqlalchemy.orm import Session
from starlette import status

from app.core.database import get_db, get_repo_root
from app.schemas.common import ErrorResponse
from app.schemas.images import (
    DeleteImageResponse,
    ImageListItem,
    ImageModel,
    ListImagesResponse,
    RegisterImageResponse,
)
from app.services.image_service import ImageNotFoundError, ImageService, ImageServiceError

router = APIRouter(prefix="/images", tags=["images"])


def _new_request_id() -> str:
    return f"req_{uuid.uuid4().hex}"


@router.post("", response_model=RegisterImageResponse)
def register_image(
    payload: ImageModel, db: Session = Depends(get_db)
) -> RegisterImageResponse | JSONResponse:
    request_id = _new_request_id()

    try:
        image = ImageService(db).register_image(
            name=payload.name,
            src=payload.src,
            format=payload.format,
            size=payload.size,
            width=payload.width,
            height=payload.height,
        )
    except ImageServiceError as exc:
        return JSONResponse(
            status_code=status.HTTP_400_BAD_REQUEST,
            content=ErrorResponse(
                error_code="IMAGE_REGISTRATION_FAILED",
                backend_message=str(exc),
                request_id=request_id,
            ).model_dump(by_alias=True),
        )

    return RegisterImageResponse(
        success=True,
        request_id=request_id,
        saved_image=ImageModel(
            id=str(image.id),
            name=image.name,
            src=payload.src,
            format=image.format,
            size=image.size_bytes,
            width=image.width,
            height=image.height,
            created_at=image.created_at.isoformat(),
        ),
        backend_message="Image registered successfully",
        received_at=datetime.now(UTC).isoformat(),
    )


@router.delete("/{image_id}", response_model=DeleteImageResponse)
def delete_image(
    image_id: str, db: Session = Depends(get_db)
) -> DeleteImageResponse | JSONResponse:
    request_id = _new_request_id()

    try:
        image_uuid = uuid.UUID(image_id)
        ImageService(db).delete_image(image_uuid)
    except (ImageNotFoundError, ValueError) as exc:
        return JSONResponse(
            status_code=status.HTTP_404_NOT_FOUND,
            content=ErrorResponse(
                error_code="IMAGE_NOT_FOUND",
                backend_message=str(exc) or f"Image '{image_id}' not found.",
                request_id=request_id,
            ).model_dump(by_alias=True),
        )

    return DeleteImageResponse(
        success=True,
        request_id=request_id,
        deleted_image_id=image_id,
        backend_message="Image deleted successfully",
        received_at=datetime.now(UTC).isoformat(),
    )


@router.get("", response_model=ListImagesResponse)
def list_images(db: Session = Depends(get_db)) -> ListImagesResponse:
    service = ImageService(db)
    images = service.list_images()

    return ListImagesResponse(
        success=True,
        images=[
            ImageListItem(
                id=str(img.id),
                name=img.name,
                format=img.format,
                size=img.size_bytes,
                width=img.width,
                height=img.height,
                status=img.status,
                created_at=img.created_at.isoformat(),
                src=f"/api/images/{img.id}/file",
            )
            for img in images
        ],
    )


@router.get("/{image_id}/file", response_model=None)
def get_image_file(image_id: str, db: Session = Depends(get_db)) -> FileResponse | JSONResponse:
    try:
        image_uuid = uuid.UUID(image_id)
    except ValueError:
        return JSONResponse(
            status_code=status.HTTP_404_NOT_FOUND,
            content={"detail": f"Image '{image_id}' not found."},
        )

    image = ImageService(db).get_image(image_uuid)
    if image is None:
        return JSONResponse(
            status_code=status.HTTP_404_NOT_FOUND,
            content={"detail": f"Image '{image_id}' not found."},
        )

    file_path = get_repo_root() / image.storage_path
    if not file_path.exists():
        return JSONResponse(
            status_code=status.HTTP_404_NOT_FOUND,
            content={"detail": "Image file not found on disk."},
        )

    media_type = {"PNG": "image/png", "JPEG": "image/jpeg", "WEBP": "image/webp"}.get(
        image.format, "application/octet-stream"
    )
    return FileResponse(str(file_path), media_type=media_type)
