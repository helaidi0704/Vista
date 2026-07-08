from sqlalchemy.orm import Session

from app.models.defect_class import DefectClass


class DefectClassRepository:
    """Data access for `app.defect_classes`."""

    def __init__(self, session: Session) -> None:
        self._session = session

    def get_by_label(self, label: str) -> DefectClass | None:
        return self._session.query(DefectClass).filter(DefectClass.label == label).one_or_none()
