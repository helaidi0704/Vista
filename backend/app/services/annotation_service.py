import uuid
from dataclasses import dataclass, field

from sqlalchemy.orm import Session

from app.models.annotation import Annotation
from app.repositories.annotation_repository import AnnotationRepository
from app.repositories.defect_class_repository import DefectClassRepository
from app.repositories.image_repository import ImageRepository
from app.schemas.annotations import SaveCreateAnnotationDto, SaveUpdateAnnotationDto


class ImageNotFoundError(Exception):
    """Raised when the image referenced by a save-annotations request doesn't exist."""


class AnnotationNotFoundError(Exception):
    """Raised when a referenced annotation id doesn't exist."""


@dataclass
class SaveAnnotationsResult:
    created_work_ids: list[str] = field(default_factory=list)
    updated_work_ids: list[str] = field(default_factory=list)
    failed_work_ids: list[str] = field(default_factory=list)
    created: list[tuple[str, uuid.UUID]] = field(default_factory=list)


class AnnotationService:
    """Business logic for saving/deleting annotations (`app.annotations`).

    Resolves `defectLabel` -> `defect_class_id` via `app.defect_classes`, and
    derives `geometry_type` from the discriminated `geometry.type` field.
    Per-item failures (unknown defect label, unknown update id, ...) are
    collected into `failed_work_ids` instead of aborting the whole batch.
    """

    def __init__(self, session: Session) -> None:
        self._session = session
        self._annotations = AnnotationRepository(session)
        self._defect_classes = DefectClassRepository(session)
        self._images = ImageRepository(session)

    def save_annotations(
        self,
        *,
        image_id: str,
        creates: list[SaveCreateAnnotationDto],
        updates: list[SaveUpdateAnnotationDto],
    ) -> SaveAnnotationsResult:
        try:
            image_uuid = uuid.UUID(image_id)
        except ValueError as exc:
            raise ImageNotFoundError(f"Image '{image_id}' not found.") from exc

        image = self._images.get_by_id(image_uuid)
        if image is None:
            raise ImageNotFoundError(f"Image '{image_id}' not found.")

        result = SaveAnnotationsResult()

        for item in creates:
            defect_class = self._defect_classes.get_by_label(item.defect_label)
            if defect_class is None:
                result.failed_work_ids.append(item.work_id)
                continue

            annotation = Annotation(
                image_id=image_uuid,
                defect_class_id=defect_class.id,
                severity=item.severity,
                description=item.description,
                geometry_type=item.geometry.type,
                geometry_data=item.geometry.model_dump(by_alias=True),
            )
            self._annotations.create(annotation)
            result.created_work_ids.append(item.work_id)
            result.created.append((item.work_id, annotation.id))

        for item in updates:
            annotation = self._resolve_update_target(item, image_uuid)
            if annotation is None:
                result.failed_work_ids.append(item.work_id)
                continue

            defect_class = self._defect_classes.get_by_label(item.defect_label)
            if defect_class is None:
                result.failed_work_ids.append(item.work_id)
                continue

            annotation.defect_class_id = defect_class.id
            annotation.severity = item.severity
            annotation.description = item.description
            annotation.geometry_type = item.geometry.type
            annotation.geometry_data = item.geometry.model_dump(by_alias=True)
            result.updated_work_ids.append(item.work_id)

        if result.created_work_ids or result.updated_work_ids:
            image.status = "draft"

        self._session.commit()
        return result

    def _resolve_update_target(
        self, item: SaveUpdateAnnotationDto, image_uuid: uuid.UUID
    ) -> Annotation | None:
        try:
            annotation_uuid = uuid.UUID(item.id)
        except ValueError:
            return None

        annotation = self._annotations.get_by_id(annotation_uuid)
        if annotation is None or annotation.image_id != image_uuid:
            return None
        return annotation

    def delete_annotation(self, annotation_id: str) -> uuid.UUID:
        try:
            annotation_uuid = uuid.UUID(annotation_id)
        except ValueError as exc:
            raise AnnotationNotFoundError(f"Annotation '{annotation_id}' not found.") from exc

        annotation = self._annotations.get_by_id(annotation_uuid)
        if annotation is None:
            raise AnnotationNotFoundError(f"Annotation '{annotation_id}' not found.")

        self._annotations.delete(annotation)
        return annotation_uuid

    def list_annotations_for_image(self, image_id: str) -> list[tuple[Annotation, str]]:
        try:
            image_uuid = uuid.UUID(image_id)
        except ValueError as exc:
            raise ImageNotFoundError(f"Image '{image_id}' not found.") from exc

        if self._images.get_by_id(image_uuid) is None:
            raise ImageNotFoundError(f"Image '{image_id}' not found.")

        return self._annotations.list_by_image_id(image_uuid)
