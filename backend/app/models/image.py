import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, String, Text, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.core.database import Base

if TYPE_CHECKING:
    from app.models.annotation import Annotation

image_status_enum = Enum(
    "pending", "draft", "ready", name="image_status", schema="app", create_constraint=True
)


class Image(Base):
    """Industrial image imported into the annotation module.

    ``storage_path`` + ``image_hash`` back the on-disk file storage strategy:
    the frontend sends the image as a base64 data URI, the backend decodes it,
    writes the bytes under ``data/images/`` and computes a sha256 hash to
    deduplicate uploads.
    """

    __tablename__ = "images"
    __table_args__ = {"schema": "app"}

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    dataset_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("app.datasets.id"), nullable=True, index=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    storage_path: Mapped[str] = mapped_column(Text, nullable=False)
    format: Mapped[str] = mapped_column(String(10), nullable=False)
    image_hash: Mapped[str] = mapped_column(String(100), nullable=False, unique=True)
    size_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    width: Mapped[int] = mapped_column(Integer, nullable=False)
    height: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(
        image_status_enum, nullable=False, server_default="pending", index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("app.users.id"), nullable=True
    )

    annotations: Mapped[list["Annotation"]] = relationship(
        back_populates="image", cascade="all, delete-orphan", passive_deletes=True
    )
