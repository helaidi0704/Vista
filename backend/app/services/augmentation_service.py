import base64
import io
import random
import uuid

from PIL import Image, ImageDraw

from app.core.database import get_repo_root
from app.models.image import Image as ImageModel
from app.repositories.image_repository import ImageRepository
from app.schemas.analysis import AugmentPreview


class AugmentationError(Exception):
    pass


def _load_pil(img: ImageModel) -> Image.Image:
    path = get_repo_root() / img.storage_path
    if not path.exists():
        raise AugmentationError(f"Image file not found: {img.storage_path}")
    return Image.open(path).convert("RGB")


def _to_data_url(pil_img: Image.Image) -> str:
    buf = io.BytesIO()
    pil_img.save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode()
    return f"data:image/png;base64,{b64}"


def _apply_crop(img: Image.Image, ratio: float) -> Image.Image:
    w, h = img.size
    cw, ch = int(w * ratio), int(h * ratio)
    x = random.randint(0, w - cw)
    y = random.randint(0, h - ch)
    return img.crop((x, y, x + cw, y + ch)).resize((w, h), Image.BILINEAR)


def _apply_rotation(img: Image.Image, angle_range: int) -> tuple[Image.Image, float]:
    angle = random.uniform(-angle_range, angle_range)
    rotated = img.rotate(angle, resample=Image.BILINEAR, expand=False, fillcolor=(0, 0, 0))
    return rotated, angle


def _apply_mixup(img: Image.Image, ref: Image.Image, alpha: float) -> Image.Image:
    ref_resized = ref.resize(img.size, Image.BILINEAR)
    return Image.blend(img, ref_resized, alpha=alpha)


def _apply_cutout(img: Image.Image, ratio: float = 0.2) -> Image.Image:
    result = img.copy()
    draw = ImageDraw.Draw(result)
    w, h = img.size
    cw, ch = int(w * ratio), int(h * ratio)
    x = random.randint(0, w - cw)
    y = random.randint(0, h - ch)
    draw.rectangle([x, y, x + cw, y + ch], fill=(0, 0, 0))
    return result


def generate_previews(
    *,
    repo: ImageRepository,
    image_id: str,
    reference_id: str | None,
    crop: bool,
    rotation: bool,
    mixup: bool,
    cutout: bool,
    rotation_range: int,
    mixup_alpha: float,
    crop_ratio: float,
) -> list[AugmentPreview]:
    img_record = repo.get_by_id(uuid.UUID(image_id))
    if img_record is None:
        raise AugmentationError(f"Image {image_id} not found.")

    pil_img = _load_pil(img_record)
    previews: list[AugmentPreview] = [
        AugmentPreview(label="Origine", src=_to_data_url(pil_img), params="—"),
    ]

    if crop:
        aug = _apply_crop(pil_img, crop_ratio)
        previews.append(AugmentPreview(
            label=f"Crop ({int(crop_ratio * 100)}%)",
            src=_to_data_url(aug),
            params=f"crop_ratio={crop_ratio}",
        ))

    if rotation:
        aug, angle = _apply_rotation(pil_img, rotation_range)
        previews.append(AugmentPreview(
            label=f"Rotation {angle:+.1f}°",
            src=_to_data_url(aug),
            params=f"angle={angle:.1f}",
        ))

    if mixup:
        if reference_id is None:
            previews.append(AugmentPreview(
                label="Mixup (pas de référence)",
                src=_to_data_url(pil_img),
                params="skipped",
            ))
        else:
            ref_record = repo.get_by_id(uuid.UUID(reference_id))
            if ref_record is None:
                raise AugmentationError(f"Reference image {reference_id} not found.")
            ref_pil = _load_pil(ref_record)
            aug = _apply_mixup(pil_img, ref_pil, mixup_alpha)
            previews.append(AugmentPreview(
                label=f"Mixup α={mixup_alpha}",
                src=_to_data_url(aug),
                params=f"alpha={mixup_alpha}",
            ))

    if cutout:
        aug = _apply_cutout(pil_img)
        previews.append(AugmentPreview(
            label="Cutout 20%",
            src=_to_data_url(aug),
            params="cutout_ratio=0.2",
        ))

    return previews
