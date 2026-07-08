from app.schemas.common import CamelModel

_ALLOWED_FORMATS = {"PNG", "JPEG", "WEBP"}


class ImageModel(CamelModel):
    """Mirrors the frontend's `ImageModel` interface exactly."""

    id: str
    name: str
    src: str
    format: str
    size: int | None = None
    width: int
    height: int
    created_at: str

    @property
    def normalized_format(self) -> str:
        return self.format.strip().upper()


class RegisterImageResponse(CamelModel):
    success: bool
    request_id: str
    saved_image: ImageModel
    backend_message: str
    received_at: str


class DeleteImageResponse(CamelModel):
    success: bool
    request_id: str
    deleted_image_id: str
    backend_message: str
    received_at: str


class ImageListItem(CamelModel):
    """Returned by GET /api/images — metadata only (no base64 `src`)."""

    id: str
    name: str
    format: str
    size: int | None = None
    width: int
    height: int
    status: str
    created_at: str
    src: str  # URL to fetch the image file bytes


class ListImagesResponse(CamelModel):
    success: bool
    images: list[ImageListItem]
