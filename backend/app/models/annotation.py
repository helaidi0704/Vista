import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, Text, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.core.database import Base

if TYPE_CHECKING:
    from app.models.image import Image

annotation_severity_enum = Enum(
    "Critique", "Majeur", "Mineur", name="annotation_severity", schema="app", create_constraint=True
)
geometry_type_enum = Enum(
    "bbox", "polygon", "freehand", name="geometry_type", schema="app", create_constraint=True
)


class Annotation(Base):
    """Persisted geometric annotation on an image.

    ``geometry_data`` stores the exact wire-format DTO received from the
    frontend (``{"type":"bbox","bbox":{...}}`` / ``polygon`` / ``freehand``),
    matching the ``geometry_data`` note in ``docs/database/schema_v1.dbml``.
    ``geometry_type`` is derived server-side from ``geometry_data["type"]``.
    """

    __tablename__ = "annotations"
    __table_args__ = {"schema": "app"}

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    image_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("app.images.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    defect_class_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("app.defect_classes.id"), nullable=False, index=True
    )
    severity: Mapped[str] = mapped_column(annotation_severity_enum, nullable=False, index=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    geometry_type: Mapped[str] = mapped_column(geometry_type_enum, nullable=False, index=True)
    geometry_data: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("app.users.id"), nullable=True
    )
    updated_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("app.users.id"), nullable=True
    )

    image: Mapped["Image"] = relationship(back_populates="annotations")
