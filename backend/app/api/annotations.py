import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, Header
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
from starlette import status

from app.core.database import get_db
from app.schemas.annotations import (
    AnnotationListItem,
    CreatedAnnotationRef,
    DeleteAnnotationResponse,
    ListAnnotationsResponse,
    SaveAnnotationsRequest,
    SaveAnnotationsResponse,
)
from app.schemas.common import ErrorResponse
from app.services.annotation_service import (
    AnnotationNotFoundError,
    AnnotationService,
    ImageNotFoundError,
)

router = APIRouter(tags=["annotations"])


@router.post("/images/save-annotations", response_model=SaveAnnotationsResponse)
def save_annotations(
    payload: SaveAnnotationsRequest,
    db: Session = Depends(get_db),
    x_request_id: str | None = Header(default=None),
) -> SaveAnnotationsResponse | JSONResponse:
    del x_request_id  # informational only; the body's requestId is echoed back

    try:
        result = AnnotationService(db).save_annotations(
            image_id=payload.image.id,
            creates=payload.creates,
            updates=payload.updates,
        )
    except ImageNotFoundError as exc:
        return JSONResponse(
            status_code=status.HTTP_404_NOT_FOUND,
            content=ErrorResponse(
                error_code="IMAGE_NOT_FOUND",
                backend_message=str(exc),
                request_id=payload.request_id,
            ).model_dump(by_alias=True),
        )

    return SaveAnnotationsResponse(
        success=True,
        request_id=payload.request_id,
        created_work_ids=result.created_work_ids,
        updated_work_ids=result.updated_work_ids,
        failed_work_ids=result.failed_work_ids,
        backend_message="Annotations saved successfully",
        received_at=datetime.now(UTC).isoformat(),
        created=[
            CreatedAnnotationRef(work_id=work_id, id=str(annotation_id))
            for work_id, annotation_id in result.created
        ],
    )


@router.delete("/annotations/{annotation_id}", response_model=DeleteAnnotationResponse)
def delete_annotation(
    annotation_id: str, db: Session = Depends(get_db)
) -> DeleteAnnotationResponse | JSONResponse:
    try:
        deleted_id = AnnotationService(db).delete_annotation(annotation_id)
    except AnnotationNotFoundError as exc:
        return JSONResponse(
            status_code=status.HTTP_404_NOT_FOUND,
            content=ErrorResponse(
                error_code="ANNOTATION_NOT_FOUND",
                backend_message=str(exc),
                request_id=f"req_{uuid.uuid4().hex}",
            ).model_dump(by_alias=True),
        )

    return DeleteAnnotationResponse(
        success=True,
        id=str(deleted_id),
        received_at=datetime.now(UTC).isoformat(),
    )


@router.get("/images/{image_id}/annotations", response_model=ListAnnotationsResponse)
def list_annotations(
    image_id: str, db: Session = Depends(get_db)
) -> ListAnnotationsResponse | JSONResponse:
    try:
        rows = AnnotationService(db).list_annotations_for_image(image_id)
    except ImageNotFoundError as exc:
        return JSONResponse(
            status_code=status.HTTP_404_NOT_FOUND,
            content=ErrorResponse(
                error_code="IMAGE_NOT_FOUND",
                backend_message=str(exc),
                request_id=f"req_{uuid.uuid4().hex}",
            ).model_dump(by_alias=True),
        )

    return ListAnnotationsResponse(
        success=True,
        annotations=[
            AnnotationListItem(
                id=str(ann.id),
                image_id=str(ann.image_id),
                defect_label=label,
                severity=ann.severity,
                description=ann.description or "",
                geometry_type=ann.geometry_type,
                geometry=ann.geometry_data,
                created_at=ann.created_at.isoformat(),
                updated_at=ann.updated_at.isoformat(),
            )
            for ann, label in rows
        ],
    )
