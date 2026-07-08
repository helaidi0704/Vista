import uuid

from sqlalchemy.orm import Session

from app.models.annotation import Annotation
from app.models.defect_class import DefectClass


class AnnotationRepository:
    """Data access for `app.annotations`."""

    def __init__(self, session: Session) -> None:
        self._session = session

    def create(self, annotation: Annotation) -> Annotation:
        self._session.add(annotation)
        self._session.flush()
        return annotation

    def get_by_id(self, annotation_id: uuid.UUID) -> Annotation | None:
        return self._session.get(Annotation, annotation_id)

    def list_by_image_id(self, image_id: uuid.UUID) -> list[tuple[Annotation, str]]:
        rows = (
            self._session.query(Annotation, DefectClass.label)
            .join(DefectClass, Annotation.defect_class_id == DefectClass.id)
            .filter(Annotation.image_id == image_id)
            .order_by(Annotation.created_at.asc())
            .all()
        )
        return [(ann, label) for ann, label in rows]

    def delete(self, annotation: Annotation) -> None:
        self._session.delete(annotation)
        self._session.commit()

    def commit(self) -> None:
        self._session.commit()
