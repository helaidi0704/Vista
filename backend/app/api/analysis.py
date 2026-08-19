from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
from starlette import status

from app.core.database import get_db
from app.schemas.analysis import AugmentRequest, AugmentResponse
from app.schemas.common import ErrorResponse
from app.repositories.image_repository import ImageRepository
from app.services.augmentation_service import AugmentationError, generate_previews

router = APIRouter(prefix="/analysis", tags=["analysis"])


@router.post("/augment", response_model=AugmentResponse)
def augment_image(
    payload: AugmentRequest, db: Session = Depends(get_db)
) -> AugmentResponse | JSONResponse:
    try:
        previews = generate_previews(
            repo=ImageRepository(db),
            image_id=payload.image_id,
            reference_id=payload.reference_id,
            crop=payload.crop,
            rotation=payload.rotation,
            mixup=payload.mixup,
            cutout=payload.cutout,
            rotation_range=payload.rotation_range,
            mixup_alpha=payload.mixup_alpha,
            crop_ratio=payload.crop_ratio,
        )
    except AugmentationError as exc:
        return JSONResponse(
            status_code=status.HTTP_400_BAD_REQUEST,
            content=ErrorResponse(
                error_code="AUGMENTATION_FAILED",
                backend_message=str(exc),
                request_id="aug",
            ).model_dump(by_alias=True),
        )

    return AugmentResponse(success=True, previews=previews)
