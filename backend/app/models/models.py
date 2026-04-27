"""
VISTA — SQLAlchemy ORM Models
Mirrors the 8 tables from init-db.sql.
"""
import uuid
from datetime import datetime
from sqlalchemy import (
    Column, String, Integer, Float, Boolean, Text, BigInteger,
    ForeignKey, DateTime, CheckConstraint, Index
)
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import DeclarativeBase, relationship


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email = Column(String(255), unique=True, nullable=False, index=True)
    hashed_password = Column(String(255), nullable=False)
    full_name = Column(String(255))
    role = Column(String(50), nullable=False, default="client")
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    datasets = relationship("Dataset", back_populates="owner")
    training_jobs = relationship("TrainingJob", back_populates="owner")


class Dataset(Base):
    __tablename__ = "datasets"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(255), nullable=False)
    description = Column(Text)
    owner_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"))
    image_count = Column(Integer, default=0)
    annotated_count = Column(Integer, default=0)
    defect_classes = Column(JSONB, default=[])
    split_config = Column(JSONB, default={"train": 0.7, "val": 0.2, "test": 0.1})
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    owner = relationship("User", back_populates="datasets")
    images = relationship("Image", back_populates="dataset", cascade="all, delete-orphan")


class Image(Base):
    __tablename__ = "images"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    dataset_id = Column(UUID(as_uuid=True), ForeignKey("datasets.id", ondelete="CASCADE"))
    filename = Column(String(512), nullable=False)
    storage_path = Column(String(1024), nullable=False)
    thumbnail_path = Column(String(1024))
    width = Column(Integer)
    height = Column(Integer)
    format = Column(String(10), default="jpg")
    file_size_bytes = Column(BigInteger)
    split = Column(String(10), default="train")
    metadata_ = Column("metadata", JSONB, default={})
    uploaded_at = Column(DateTime(timezone=True), default=datetime.utcnow)

    # Relationships
    dataset = relationship("Dataset", back_populates="images")
    annotations = relationship("Annotation", back_populates="image", cascade="all, delete-orphan")

    __table_args__ = (
        Index("idx_images_dataset", "dataset_id"),
        Index("idx_images_split", "dataset_id", "split"),
    )


class Annotation(Base):
    __tablename__ = "annotations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    image_id = Column(UUID(as_uuid=True), ForeignKey("images.id", ondelete="CASCADE"))
    author_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"))
    shape = Column(String(20), nullable=False, default="bbox")
    coordinates = Column(JSONB, nullable=False)
    defect_class = Column(String(100), nullable=False)
    severity = Column(String(20), default="medium")
    description = Column(Text)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    image = relationship("Image", back_populates="annotations")

    __table_args__ = (
        Index("idx_annotations_image", "image_id"),
        Index("idx_annotations_class", "defect_class"),
    )


class TrainingJob(Base):
    __tablename__ = "training_jobs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(255))
    owner_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"))
    dataset_id = Column(UUID(as_uuid=True), ForeignKey("datasets.id", ondelete="SET NULL"))
    architecture = Column(String(100), nullable=False)
    task_type = Column(String(50), nullable=False, default="detection")
    hyperparams = Column(JSONB, nullable=False, default={})
    augmentations = Column(JSONB, default=[])
    status = Column(String(20), nullable=False, default="queued")
    current_epoch = Column(Integer, default=0)
    total_epochs = Column(Integer)
    best_metric = Column(Float)
    metrics_history = Column(JSONB, default=[])
    celery_task_id = Column(String(255))
    started_at = Column(DateTime(timezone=True))
    completed_at = Column(DateTime(timezone=True))
    error_message = Column(Text)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)

    # Relationships
    owner = relationship("User", back_populates="training_jobs")
    dataset = relationship("Dataset")
    model = relationship("MLModel", back_populates="training_job", uselist=False)

    __table_args__ = (
        Index("idx_training_jobs_status", "status"),
        Index("idx_training_jobs_owner", "owner_id"),
    )


class MLModel(Base):
    __tablename__ = "ml_models"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    training_job_id = Column(UUID(as_uuid=True), ForeignKey("training_jobs.id", ondelete="SET NULL"))
    name = Column(String(255), nullable=False)
    version = Column(Integer, default=1)
    architecture = Column(String(100), nullable=False)
    task_type = Column(String(50), nullable=False)
    weights_path = Column(String(1024), nullable=False)
    onnx_path = Column(String(1024))
    input_size = Column(JSONB, default={"width": 640, "height": 640})
    class_names = Column(JSONB, default=[])
    map50 = Column(Float)
    map50_95 = Column(Float)
    precision_val = Column(Float)
    recall_val = Column(Float)
    f1_score = Column(Float)
    inference_ms = Column(Float)
    status = Column(String(20), default="ready")
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)

    # Relationships
    training_job = relationship("TrainingJob", back_populates="model")
    inference_logs = relationship("InferenceLog", back_populates="model")
    deployments = relationship("Deployment", back_populates="model")


class InferenceLog(Base):
    __tablename__ = "inference_logs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    model_id = Column(UUID(as_uuid=True), ForeignKey("ml_models.id", ondelete="SET NULL"))
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"))
    input_image_path = Column(String(1024))
    detections = Column(JSONB, default=[])
    verdict = Column(String(20), default="ok")
    gradcam_path = Column(String(1024))
    latency_ms = Column(Float)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)

    # Relationships
    model = relationship("MLModel", back_populates="inference_logs")

    __table_args__ = (
        Index("idx_inference_model", "model_id"),
        Index("idx_inference_date", "created_at"),
    )


class Deployment(Base):
    __tablename__ = "deployments"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    model_id = Column(UUID(as_uuid=True), ForeignKey("ml_models.id", ondelete="CASCADE"))
    owner_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"))
    format = Column(String(50), nullable=False)
    export_path = Column(String(1024))
    api_endpoint = Column(String(512))
    status = Column(String(20), default="pending")
    config = Column(JSONB, default={})
    file_size_bytes = Column(BigInteger)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)

    # Relationships
    model = relationship("MLModel", back_populates="deployments")
