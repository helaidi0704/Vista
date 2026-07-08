import uuid

from sqlalchemy.orm import Session

from app.models.image import Image


class ImageRepository:
    """Data access for `app.images`."""

    def __init__(self, session: Session) -> None:
        self._session = session

    def create(self, image: Image) -> Image:
        self._session.add(image)
        self._session.commit()
        self._session.refresh(image)
        return image

    def get_by_hash(self, image_hash: str) -> Image | None:
        return self._session.query(Image).filter(Image.image_hash == image_hash).one_or_none()

    def get_by_id(self, image_id: uuid.UUID) -> Image | None:
        return self._session.get(Image, image_id)

    def list_all(self) -> list[Image]:
        return self._session.query(Image).order_by(Image.created_at.desc()).all()

    def delete(self, image: Image) -> None:
        self._session.delete(image)
        self._session.commit()
