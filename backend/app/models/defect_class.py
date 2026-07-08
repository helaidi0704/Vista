from sqlalchemy import Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class DefectClass(Base):
    """Reference table of defect types recognized by the platform.

    Seed data mirrors the 5 hardcoded values from the Angular annotation
    component (``frontend/src/app/pages/annotation/annotation.ts``,
    ``defectOptions``) — see the Alembic seed migration.
    """

    __tablename__ = "defect_classes"
    __table_args__ = {"schema": "app"}

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    label: Mapped[str] = mapped_column(String(100), nullable=False, unique=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
