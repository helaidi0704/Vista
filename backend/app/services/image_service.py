import base64
import binascii
import hashlib
import re
import uuid

from sqlalchemy.orm import Session

from app.core.database import get_data_dir, get_repo_root
from app.models.image import Image
from app.repositories.image_repository import ImageRepository

_DATA_URI_RE = re.compile(
    r"^data:image/(?P<subtype>[a-zA-Z0-9.+-]+);base64,(?P<data>.+)$", re.DOTALL
)

_EXTENSION_BY_FORMAT = {"PNG": "png", "JPEG": "jpg", "WEBP": "webp"}
_ALLOWED_FORMATS = set(_EXTENSION_BY_FORMAT)


class ImageServiceError(Exception):
    """Raised for user-facing image registration failures (bad payload, etc.)."""


class ImageNotFoundError(Exception):
    """Raised when a referenced image id doesn't exist."""


def _decode_data_uri(src: str) -> bytes:
    match = _DATA_URI_RE.match(src.strip())
    if not match:
        raise ImageServiceError(
            "Image 'src' must be a base64 data URI (data:image/<type>;base64,...)."
        )
    try:
        return base64.b64decode(match.group("data"), validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ImageServiceError("Image 'src' is not valid base64 data.") from exc


class ImageService:
    """Business logic for registering/deleting images (`app.images`)."""

    def __init__(self, session: Session) -> None:
        self._session = session
        self._repository = ImageRepository(session)

    def register_image(
        self,
        *,
        name: str,
        src: str,
        format: str,  # noqa: A002 - matches the frontend/API field name
        size: int | None,
        width: int,
        height: int,
    ) -> Image:
        normalized_format = format.strip().upper()
        if normalized_format not in _ALLOWED_FORMATS:
            raise ImageServiceError(f"Unsupported image format '{format}'.")

        raw_bytes = _decode_data_uri(src)
        image_hash = hashlib.sha256(raw_bytes).hexdigest()

        existing = self._repository.get_by_hash(image_hash)
        if existing is not None:
            return existing

        extension = _EXTENSION_BY_FORMAT[normalized_format]
        images_dir = get_data_dir() / "images"
        images_dir.mkdir(parents=True, exist_ok=True)
        file_path = images_dir / f"{image_hash}.{extension}"
        file_path.write_bytes(raw_bytes)
        storage_path = str(file_path.relative_to(get_repo_root()).as_posix())

        image = Image(
            name=name,
            storage_path=storage_path,
            format=normalized_format,
            image_hash=image_hash,
            size_bytes=size if size is not None else len(raw_bytes),
            width=width,
            height=height,
        )
        return self._repository.create(image)

    def delete_image(self, image_id: uuid.UUID) -> Image:
        image = self._repository.get_by_id(image_id)
        if image is None:
            raise ImageNotFoundError(f"Image '{image_id}' not found.")

        file_path = get_repo_root() / image.storage_path
        self._repository.delete(image)  # `app.annotations` rows cascade via ON DELETE CASCADE

        if file_path.exists():
            file_path.unlink()

        return image

    def list_images(self) -> list[Image]:
        return self._repository.list_all()

    def get_image(self, image_id: uuid.UUID) -> Image | None:
        return self._repository.get_by_id(image_id)
