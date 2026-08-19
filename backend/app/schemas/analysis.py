from app.schemas.common import CamelModel


class AugmentRequest(CamelModel):
    image_id: str
    reference_id: str | None = None
    crop: bool = True
    rotation: bool = True
    mixup: bool = False
    cutout: bool = True
    rotation_range: int = 15
    mixup_alpha: float = 0.2
    crop_ratio: float = 0.8


class AugmentPreview(CamelModel):
    label: str
    src: str   # base64 data URL
    params: str


class AugmentResponse(CamelModel):
    success: bool
    previews: list[AugmentPreview]
