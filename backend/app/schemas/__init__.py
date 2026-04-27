"""
VISTA — Pydantic Schemas (API request/response validation)
"""
from pydantic import BaseModel, Field
from typing import Optional
from uuid import UUID
from datetime import datetime


# ─── Images ───────────────────────────────────────────────────────────────────
class ImageOut(BaseModel):
    id: UUID
    dataset_id: UUID
    filename: str
    thumbnail_url: Optional[str] = None
    width: Optional[int] = None
    height: Optional[int] = None
    format: str = "jpg"
    uploaded_at: datetime

    model_config = {"from_attributes": True}


class ImageUploadResponse(BaseModel):
    images: list[ImageOut]
    count: int


# ─── Annotations ──────────────────────────────────────────────────────────────
class AnnotationCreate(BaseModel):
    image_id: UUID
    shape: str = Field(default="bbox", pattern="^(bbox|polygon|freehand|mask)$")
    coordinates: dict
    defect_class: str
    severity: str = Field(default="medium", pattern="^(low|medium|high|critical)$")
    description: Optional[str] = None


class AnnotationOut(BaseModel):
    id: UUID
    image_id: UUID
    shape: str
    coordinates: dict
    defect_class: str
    severity: str
    description: Optional[str] = None
    created_at: datetime

    model_config = {"from_attributes": True}


# ─── Datasets ─────────────────────────────────────────────────────────────────
class DatasetCreate(BaseModel):
    name: str
    description: Optional[str] = None
    defect_classes: list[str] = []


class DatasetOut(BaseModel):
    id: UUID
    name: str
    description: Optional[str] = None
    image_count: int = 0
    annotated_count: int = 0
    defect_classes: list = []
    created_at: datetime

    model_config = {"from_attributes": True}


# ─── Training Jobs ────────────────────────────────────────────────────────────
class TrainingJobCreate(BaseModel):
    dataset_id: UUID
    architecture: str = Field(examples=["yolov8s", "yolov8m", "resnet50", "unet"])
    task_type: str = Field(default="detection", pattern="^(detection|classification|segmentation)$")
    hyperparams: dict = Field(default_factory=lambda: {
        "epochs": 100, "batch_size": 16, "lr": 1e-3, "optimizer": "AdamW"
    })
    augmentations: list[dict] = []
    name: Optional[str] = None


class TrainingJobOut(BaseModel):
    id: UUID
    name: Optional[str] = None
    dataset_id: Optional[UUID] = None
    architecture: str
    task_type: str
    status: str
    current_epoch: int = 0
    total_epochs: Optional[int] = None
    best_metric: Optional[float] = None
    created_at: datetime
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


# ─── ML Models ────────────────────────────────────────────────────────────────
class MLModelOut(BaseModel):
    id: UUID
    name: str
    architecture: str
    task_type: str
    map50: Optional[float] = None
    precision_val: Optional[float] = None
    recall_val: Optional[float] = None
    f1_score: Optional[float] = None
    inference_ms: Optional[float] = None
    status: str
    created_at: datetime

    model_config = {"from_attributes": True}


# ─── Inference ────────────────────────────────────────────────────────────────
class InferenceRequest(BaseModel):
    model_id: UUID
    return_gradcam: bool = False


class DetectionResult(BaseModel):
    defect_class: str = Field(alias="class")
    confidence: float
    bbox: list[int]


class InferenceResponse(BaseModel):
    detections: list[DetectionResult] = []
    gradcam_url: Optional[str] = None
    latency_ms: float
    verdict: str


# ─── Deployments ──────────────────────────────────────────────────────────────
class DeploymentCreate(BaseModel):
    model_id: UUID
    format: str = Field(pattern="^(onnx|tensorrt|api_rest|docker)$")


class DeploymentOut(BaseModel):
    id: UUID
    model_id: UUID
    format: str
    status: str
    export_path: Optional[str] = None
    api_endpoint: Optional[str] = None
    created_at: datetime

    model_config = {"from_attributes": True}


# ─── Health ───────────────────────────────────────────────────────────────────
class HealthResponse(BaseModel):
    status: str = "ok"
    service: str = "vista-api"
    version: str
    database: str = "connected"
    redis: str = "connected"
    minio: str = "connected"
