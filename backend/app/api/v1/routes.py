"""
VISTA — API v1 Routes
All endpoints matching the sequence diagrams.
"""
from fastapi import APIRouter, Depends, UploadFile, File, HTTPException, WebSocket, WebSocketDisconnect
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from uuid import UUID
from typing import Optional
import json
import logging

from app.core.database import get_db
from app.core.storage import get_s3_client, generate_presigned_url
from app.core.config import get_settings
from app.core.celery_app import celery_app
from app.core.auth import get_current_user, require_auth
from app.models import Dataset, Image, Annotation, TrainingJob, MLModel, InferenceLog, Deployment
from app.schemas import (
    DatasetCreate, DatasetOut,
    ImageOut, ImageUploadResponse,
    AnnotationCreate, AnnotationOut,
    TrainingJobCreate, TrainingJobOut,
    MLModelOut,
    InferenceRequest, InferenceResponse,
    DeploymentCreate, DeploymentOut,
)

logger = logging.getLogger(__name__)
settings = get_settings()

router = APIRouter(prefix="/api/v1", tags=["VISTA API v1"])


# ═══════════════════════════════════════════════════════════════════════════════
# DATASETS
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/datasets", response_model=list[DatasetOut])
async def list_datasets(db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    # ===== ISOLATION: Only show datasets belonging to the user's organization =====
    query = select(Dataset).order_by(Dataset.created_at.desc())
    if user and user.get("organization_id"):
        query = query.where(Dataset.organization_id == user["organization_id"])
    result = await db.execute(query)
    return result.scalars().all()


@router.post("/datasets", response_model=DatasetOut, status_code=201)
async def create_dataset(payload: DatasetCreate, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    # ===== ISOLATION: Assign dataset to user's organization =====
    org_id = user["organization_id"] if user and user.get("organization_id") else None
    dataset = Dataset(
        name=payload.name,
        description=payload.description,
        defect_classes=payload.defect_classes,
        organization_id=org_id,
    )
    db.add(dataset)
    await db.flush()
    await db.refresh(dataset)
    return dataset


@router.get("/datasets/{dataset_id}", response_model=DatasetOut)
async def get_dataset(dataset_id: UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Dataset).where(Dataset.id == dataset_id))
    dataset = result.scalar_one_or_none()
    if not dataset:
        raise HTTPException(404, "Dataset not found")
    return dataset


# ═══════════════════════════════════════════════════════════════════════════════
# IMAGES — SEQ 1, Phase 1 (Upload)
# ═══════════════════════════════════════════════════════════════════════════════

@router.post("/images/upload", response_model=ImageUploadResponse, status_code=201)
async def upload_images(
    dataset_id: UUID,
    files: list[UploadFile] = File(...),
    db: AsyncSession = Depends(get_db),
):
    """
    SEQ 1 — Steps 1.2→1.6
    Upload multiple images to MinIO + create DB records + dispatch thumbnail jobs.
    """
    s3 = get_s3_client()
    uploaded = []

    for f in files:
        # 1.3 — Store in MinIO
        key = f"{dataset_id}/{f.filename}"
        content = await f.read()
        s3.put_object(
            Bucket=settings.minio_bucket_images,
            Key=key,
            Body=content,
            ContentType=f.content_type or "image/jpeg",
        )

        # 1.4 — Insert DB record
        image = Image(
            dataset_id=dataset_id,
            filename=f.filename,
            storage_path=key,
            file_size_bytes=len(content),
            format=f.filename.rsplit(".", 1)[-1] if "." in f.filename else "jpg",
        )
        db.add(image)
        await db.flush()
        await db.refresh(image)

        # 1.5 — Dispatch thumbnail generation (async)
        celery_app.send_task(
            "tasks.generate_thumbnail",
            args=[str(image.id)],
            queue="cpu",
        )

        uploaded.append(image)

    # Update dataset image count
    await db.execute(
        select(Dataset).where(Dataset.id == dataset_id)
    )
    result = await db.execute(
        select(func.count()).where(Image.dataset_id == dataset_id)
    )
    count = result.scalar()
    await db.execute(
        Dataset.__table__.update()
        .where(Dataset.id == dataset_id)
        .values(image_count=count)
    )

    return ImageUploadResponse(images=uploaded, count=len(uploaded))


@router.get("/images", response_model=list[ImageOut])
async def list_images(
    dataset_id: UUID,
    split: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    query = select(Image).where(Image.dataset_id == dataset_id)
    if split:
        query = query.where(Image.split == split)
    result = await db.execute(query.order_by(Image.uploaded_at.desc()))
    images = result.scalars().all()

    # Inject presigned thumbnail URLs
    for img in images:
        if img.thumbnail_path:
            img.thumbnail_url = generate_presigned_url(
                settings.minio_bucket_images, img.thumbnail_path
            )
    return images


# ═══════════════════════════════════════════════════════════════════════════════
# ANNOTATIONS — SEQ 1, Phase 2-3
# ═══════════════════════════════════════════════════════════════════════════════

@router.post("/annotations", response_model=AnnotationOut, status_code=201)
async def create_annotation(
    payload: AnnotationCreate,
    db: AsyncSession = Depends(get_db),
):
    """
    SEQ 1 — Step 3.2→3.4
    Save annotation with normalized coordinates.
    """
    annotation = Annotation(
        image_id=payload.image_id,
        shape=payload.shape,
        coordinates=payload.coordinates,
        defect_class=payload.defect_class,
        severity=payload.severity,
        description=payload.description,
    )
    db.add(annotation)
    await db.flush()
    await db.refresh(annotation)
    return annotation


@router.get("/annotations/{image_id}", response_model=list[AnnotationOut])
async def get_annotations(image_id: UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Annotation).where(Annotation.image_id == image_id)
    )
    return result.scalars().all()



@router.post("/auto-annotate/{image_id}")
async def auto_annotate(
    image_id: UUID,
    model_id: UUID,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    """
    Auto-Annotation: Run inference on an image and create annotations
    from the detections. Quality engineer reviews and corrects.
    Cuts annotation time from 30 seconds to 3 seconds per image.
    """
    import base64
    from io import BytesIO

    # Get image
    result = await db.execute(select(Image).where(Image.id == image_id))
    image = result.scalar_one_or_none()
    if not image:
        raise HTTPException(404, "Image not found")

    # Get presigned URL and download image
    from app.core.storage import get_s3_client
    s3 = get_s3_client()
    bucket = settings.minio_bucket_images
    response = s3.get_object(Bucket=bucket, Key=image.storage_path)
    image_bytes = response["Body"].read()
    image_b64 = base64.b64encode(image_bytes).decode()

    # Run inference via Celery
    task = celery_app.send_task(
        "tasks.run_inference",
        args=[str(model_id), image_b64, False],
        queue="gpu",
    )
    result = task.get(timeout=120)

    # Create annotations from detections
    annotations_created = []
    detections = result.get("detections", [])

    for det in detections:
        bbox = det["bbox"]  # [x1, y1, x2, y2]
        # Convert to normalized coordinates
        w = image.width or 512
        h = image.height or 512
        nx = bbox[0] / w
        ny = bbox[1] / h
        nw = (bbox[2] - bbox[0]) / w
        nh = (bbox[3] - bbox[1]) / h

        annotation = Annotation(
            image_id=image_id,
            shape="bbox",
            coordinates={"nx": round(nx, 4), "ny": round(ny, 4), "nw": round(nw, 4), "nh": round(nh, 4)},
            defect_class=det["class"],
            severity="medium" if det["confidence"] > 0.7 else "low",
            description=f"Auto-detected ({det['confidence']:.0%} confidence)",
        )
        if user and user.get("id"):
            annotation.author_id = user["id"]
        db.add(annotation)
        await db.flush()
        await db.refresh(annotation)
        annotations_created.append({
            "id": str(annotation.id),
            "class": det["class"],
            "confidence": det["confidence"],
            "bbox": bbox,
        })

    return {
        "image_id": str(image_id),
        "model_id": str(model_id),
        "annotations_created": len(annotations_created),
        "detections": annotations_created,
        "message": f"{len(annotations_created)} annotations created — review and correct in the Viewer",
    }


@router.post("/auto-annotate-batch/{dataset_id}")
async def auto_annotate_batch(
    dataset_id: UUID,
    model_id: UUID,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    """
    Batch auto-annotation: Run inference on ALL images in a dataset.
    Creates pre-annotations for the entire dataset at once.
    """
    # Get all images in dataset
    result = await db.execute(
        select(Image).where(Image.dataset_id == dataset_id).order_by(Image.uploaded_at)
    )
    images = result.scalars().all()
    if not images:
        raise HTTPException(404, "No images in dataset")

    # Dispatch batch task
    task = celery_app.send_task(
        "tasks.auto_annotate_batch",
        args=[str(dataset_id), str(model_id), [str(img.id) for img in images]],
        queue="gpu",
    )

    return {
        "dataset_id": str(dataset_id),
        "model_id": str(model_id),
        "total_images": len(images),
        "task_id": task.id,
        "message": f"Auto-annotation started for {len(images)} images. Check progress in the Viewer.",
    }


# ═══════════════════════════════════════════════════════════════════════════════
# TRAINING JOBS — SEQ 2
# ═══════════════════════════════════════════════════════════════════════════════

@router.post("/training-jobs", response_model=TrainingJobOut, status_code=202)
async def create_training_job(
    payload: TrainingJobCreate,
    db: AsyncSession = Depends(get_db),
):
    """
    SEQ 2 — Steps 2.2→2.6
    Validate config, create job, dispatch to GPU queue.
    """
    # 2.3 — Validate dataset exists and has images
    result = await db.execute(select(Dataset).where(Dataset.id == payload.dataset_id))
    dataset = result.scalar_one_or_none()
    if not dataset:
        raise HTTPException(404, "Dataset not found")
    if dataset.image_count == 0:
        raise HTTPException(400, "Dataset has no images")

    # 2.4 — Create job record
    job = TrainingJob(
        name=payload.name or f"{payload.architecture}_{dataset.name}",
        dataset_id=payload.dataset_id,
        architecture=payload.architecture,
        task_type=payload.task_type,
        hyperparams=payload.hyperparams,
        augmentations=payload.augmentations,
        total_epochs=payload.hyperparams.get("epochs", 100),
        status="queued",
    )
    db.add(job)
    await db.flush()
    await db.refresh(job)

    # 2.5 — Dispatch to GPU queue
    task = celery_app.send_task(
        "tasks.train_model",
        args=[str(job.id)],
        queue="gpu",
    )
    job.celery_task_id = task.id
    await db.flush()

    return job


@router.get("/training-jobs", response_model=list[TrainingJobOut])
async def list_training_jobs(
    status: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    # ===== ISOLATION: Only show training jobs from user's organization =====
    query = select(TrainingJob).order_by(TrainingJob.created_at.desc())
    if user and user.get("organization_id"):
        query = query.where(TrainingJob.organization_id == user["organization_id"])
    if status:
        query = query.where(TrainingJob.status == status)
    result = await db.execute(query)
    return result.scalars().all()


@router.get("/training-jobs/{job_id}", response_model=TrainingJobOut)
async def get_training_job(job_id: UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(TrainingJob).where(TrainingJob.id == job_id))
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(404, "Training job not found")
    return job


# ═══════════════════════════════════════════════════════════════════════════════
# ML MODELS
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/models", response_model=list[MLModelOut])
async def list_models(db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    # ===== ISOLATION: Only show models from user's organization =====
    query = select(MLModel).order_by(MLModel.created_at.desc())
    if user and user.get("organization_id"):
        query = query.where(MLModel.organization_id == user["organization_id"])
    result = await db.execute(query)
    return result.scalars().all()


@router.get("/models/{model_id}", response_model=MLModelOut)
async def get_model(model_id: UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(MLModel).where(MLModel.id == model_id))
    model = result.scalar_one_or_none()
    if not model:
        raise HTTPException(404, "Model not found")
    return model




@router.get("/reports/inspection/{dataset_id}")
async def generate_inspection_report(
    dataset_id: UUID,
    model_id: Optional[UUID] = None,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    """
    Generate a PDF inspection report for a dataset.
    Contains: date, model info, images inspected, defects found,
    pass/fail rates, summary statistics. Required for ISO audits.
    """
    # Get dataset
    ds_result = await db.execute(select(Dataset).where(Dataset.id == dataset_id))
    dataset = ds_result.scalar_one_or_none()
    if not dataset:
        raise HTTPException(404, "Dataset not found")

    # Get model info if provided
    model_info = None
    if model_id:
        m_result = await db.execute(select(MLModel).where(MLModel.id == model_id))
        model_info = m_result.scalar_one_or_none()

    # Get images and annotations
    img_result = await db.execute(
        select(Image).where(Image.dataset_id == dataset_id).order_by(Image.uploaded_at)
    )
    images = img_result.scalars().all()

    # Get all annotations for this dataset
    from sqlalchemy import and_
    ann_result = await db.execute(
        select(Annotation).where(
            Annotation.image_id.in_([img.id for img in images])
        )
    )
    annotations = ann_result.scalars().all()

    # Get inference logs if model specified
    inference_stats = {"total": 0, "ok": 0, "anomaly": 0, "avg_latency": 0}
    if model_id:
        from sqlalchemy import func as sqlfunc
        inf_result = await db.execute(
            select(
                sqlfunc.count(InferenceLog.id).label("total"),
                sqlfunc.avg(InferenceLog.latency_ms).label("avg_latency"),
            ).where(InferenceLog.model_id == model_id)
        )
        row = inf_result.mappings().fetchone()
        if row:
            inference_stats["total"] = row["total"] or 0
            inference_stats["avg_latency"] = round(row["avg_latency"] or 0, 1)

        ok_result = await db.execute(
            select(sqlfunc.count(InferenceLog.id)).where(
                and_(InferenceLog.model_id == model_id, InferenceLog.verdict == "ok")
            )
        )
        inference_stats["ok"] = ok_result.scalar() or 0
        inference_stats["anomaly"] = inference_stats["total"] - inference_stats["ok"]

    # Count defects by class
    defect_summary = {}
    for ann in annotations:
        cls = ann.defect_class
        defect_summary[cls] = defect_summary.get(cls, 0) + 1

    # Build report
    from datetime import datetime
    report = {
        "report_type": "Inspection Report",
        "generated_at": datetime.utcnow().isoformat(),
        "generated_by": user["full_name"] if user else "System",
        "organization": user.get("organization_id") if user else None,
        "dataset": {
            "name": dataset.name,
            "description": dataset.description,
            "total_images": dataset.image_count,
            "annotated_images": len(set(a.image_id for a in annotations)),
            "defect_classes": dataset.defect_classes,
        },
        "model": {
            "name": model_info.name if model_info else "N/A",
            "architecture": model_info.architecture if model_info else "N/A",
            "map50": model_info.map50 if model_info else None,
            "precision": model_info.precision_val if model_info else None,
            "recall": model_info.recall_val if model_info else None,
        } if model_info else None,
        "annotations": {
            "total": len(annotations),
            "by_class": defect_summary,
            "images_with_defects": len(set(a.image_id for a in annotations if a.defect_class != "OK")),
        },
        "inference": inference_stats,
        "summary": {
            "pass_rate": round((1 - inference_stats["anomaly"] / max(inference_stats["total"], 1)) * 100, 1),
            "defect_rate": round(inference_stats["anomaly"] / max(inference_stats["total"], 1) * 100, 1),
            "total_defects_annotated": len(annotations),
            "most_common_defect": max(defect_summary, key=defect_summary.get) if defect_summary else "None",
        },
    }

    return report


@router.get("/reports/model/{model_id}")
async def generate_model_report(
    model_id: UUID,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    """
    Generate a model performance report.
    Contains: training history, metrics evolution, validation results.
    """
    # Get model
    m_result = await db.execute(select(MLModel).where(MLModel.id == model_id))
    model = m_result.scalar_one_or_none()
    if not model:
        raise HTTPException(404, "Model not found")

    # Get training job
    job = None
    if model.training_job_id:
        j_result = await db.execute(select(TrainingJob).where(TrainingJob.id == model.training_job_id))
        job = j_result.scalar_one_or_none()

    # Get inference history
    from sqlalchemy import func as sqlfunc
    inf_result = await db.execute(
        select(
            sqlfunc.count(InferenceLog.id).label("total"),
            sqlfunc.avg(InferenceLog.latency_ms).label("avg_latency"),
        ).where(InferenceLog.model_id == model_id)
    )
    usage = inf_result.mappings().fetchone()

    # Recent inferences
    recent = await db.execute(
        select(InferenceLog).where(InferenceLog.model_id == model_id)
        .order_by(InferenceLog.created_at.desc()).limit(10)
    )
    recent_logs = [
        {"verdict": log.verdict, "latency_ms": log.latency_ms, "created_at": log.created_at.isoformat()}
        for log in recent.scalars().all()
    ]

    from datetime import datetime
    return {
        "report_type": "Model Performance Report",
        "generated_at": datetime.utcnow().isoformat(),
        "model": {
            "id": str(model.id),
            "name": model.name,
            "architecture": model.architecture,
            "task_type": model.task_type,
            "map50": model.map50,
            "precision": model.precision_val,
            "recall": model.recall_val,
            "status": model.status,
            "created_at": model.created_at.isoformat(),
        },
        "training": {
            "job_name": job.name if job else "N/A",
            "epochs": job.total_epochs if job else 0,
            "best_metric": job.best_metric if job else None,
            "duration": str(job.completed_at - job.started_at) if job and job.completed_at and job.started_at else "N/A",
        } if job else None,
        "usage": {
            "total_inferences": usage["total"] if usage else 0,
            "avg_latency_ms": round(usage["avg_latency"] or 0, 1) if usage else 0,
        },
        "recent_inferences": recent_logs,
    }


# ═══════════════════════════════════════════════════════════════════════════════


@router.post("/models/{model_id}/retrain", response_model=TrainingJobOut, status_code=202)
async def retrain_model(
    model_id: UUID,
    epochs: int = 20,
    lr: float = 0.001,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    """
    Retrain an existing model with updated dataset.
    Uses the previous model weights as starting point (transfer learning).
    Faster and better than training from scratch.
    """
    # Get the existing model
    result = await db.execute(select(MLModel).where(MLModel.id == model_id))
    model = result.scalar_one_or_none()
    if not model:
        raise HTTPException(404, "Model not found")

    # Get the original training job to find dataset_id
    original_job = None
    if model.training_job_id:
        job_result = await db.execute(select(TrainingJob).where(TrainingJob.id == model.training_job_id))
        original_job = job_result.scalar_one_or_none()

    if not original_job:
        raise HTTPException(400, "Cannot retrain: original training job not found")

    # Create new training job with retrain flag
    job = TrainingJob(
        name=f"{model.name}_retrained",
        dataset_id=original_job.dataset_id,
        architecture=model.architecture,
        task_type=model.task_type,
        hyperparams={
            "epochs": epochs,
            "batch_size": original_job.hyperparams.get("batch_size", 16) if isinstance(original_job.hyperparams, dict) else 16,
            "lr": lr,
            "optimizer": original_job.hyperparams.get("optimizer", "AdamW") if isinstance(original_job.hyperparams, dict) else "AdamW",
            "retrain_from": str(model_id),
            "base_weights": model.weights_path,
        },
        total_epochs=epochs,
        status="queued",
    )
    if user and user.get("organization_id"):
        job.organization_id = user["organization_id"]
    db.add(job)
    await db.flush()
    await db.refresh(job)

    # Dispatch to GPU queue
    task = celery_app.send_task(
        "tasks.train_model",
        args=[str(job.id)],
        queue="gpu",
    )
    job.celery_task_id = task.id
    await db.flush()

    logger.info(f"Retrain job created: {job.id} from model {model_id}")
    return job

# INFERENCE — SEQ 3
# ═══════════════════════════════════════════════════════════════════════════════

@router.post("/inference", response_model=InferenceResponse)
async def run_inference(
    model_id: UUID,
    image: UploadFile = File(...),
    return_gradcam: bool = False,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    """
    SEQ 3 — Steps 1.3→3.5
    Run inference on uploaded image, return detections + optional Grad-CAM.
    """
    # Dispatch to GPU worker synchronously (short task)
    raw = await image.read()
    import base64
    image_b64 = base64.b64encode(raw).decode()

    task = celery_app.send_task(
        "tasks.run_inference",
        args=[str(model_id), image_b64, return_gradcam],
        queue="gpu",
    )

    # Wait for result (timeout 30s)
    try:
        result = task.get(timeout=30)
    except Exception as e:
        raise HTTPException(500, f"Inference failed: {str(e)}")

    # Log inference
    log = InferenceLog(
        model_id=model_id,
        detections=result.get("detections", []),
        verdict=result.get("verdict", "ok"),
        latency_ms=result.get("latency_ms", 0),
        gradcam_path=result.get("gradcam_path"),
    )
    db.add(log)

    return InferenceResponse(
        detections=result.get("detections", []),
        gradcam_url=result.get("gradcam_url"),
        latency_ms=result.get("latency_ms", 0),
        verdict=result.get("verdict", "ok"),
    )


# ═══════════════════════════════════════════════════════════════════════════════
# DEPLOYMENTS — SEQ 3, Phase 4
# ═══════════════════════════════════════════════════════════════════════════════

@router.post("/deployments", response_model=DeploymentOut, status_code=202)
async def create_deployment(
    payload: DeploymentCreate,
    db: AsyncSession = Depends(get_db),
):
    """
    SEQ 3 — Steps 4.2→4.5
    Export model to specified format.
    """
    deployment = Deployment(
        model_id=model_id,
        format=payload.format,
        status="exporting",
    )
    db.add(deployment)
    await db.flush()
    await db.refresh(deployment)

    # Dispatch export task
    celery_app.send_task(
        "tasks.export_model",
        args=[str(deployment.id), str(payload.model_id), payload.format],
        queue="gpu",
    )

    return deployment


@router.get("/deployments", response_model=list[DeploymentOut])
async def list_deployments(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Deployment).order_by(Deployment.created_at.desc()))
    return result.scalars().all()


@router.get("/deployments/{deployment_id}", response_model=DeploymentOut)
async def get_deployment(deployment_id: UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Deployment).where(Deployment.id == deployment_id))
    dep = result.scalar_one_or_none()
    if not dep:
        raise HTTPException(404, "Deployment not found")
    return dep


@router.get("/deployments/{deployment_id}/download")
async def download_deployment(deployment_id: UUID, db: AsyncSession = Depends(get_db)):
    """Get a presigned download URL for an exported model."""
    result = await db.execute(select(Deployment).where(Deployment.id == deployment_id))
    dep = result.scalar_one_or_none()
    if not dep:
        raise HTTPException(404, "Deployment not found")
    if dep.status != "ready" or not dep.export_path:
        raise HTTPException(400, "Export not ready yet")

    url = generate_presigned_url(settings.minio_bucket_exports, dep.export_path, expires_in=3600)
    return {"download_url": url, "format": dep.format, "path": dep.export_path}


@router.get("/models/{model_id}/stats")
async def get_model_stats(model_id: UUID, db: AsyncSession = Depends(get_db)):
    """Get detailed model stats: performance metrics + inference history summary."""
    result = await db.execute(select(MLModel).where(MLModel.id == model_id))
    model = result.scalar_one_or_none()
    if not model:
        raise HTTPException(404, "Model not found")

    # Count inferences
    inf_count = await db.execute(
        select(func.count()).where(InferenceLog.model_id == model_id)
    )
    total_inferences = inf_count.scalar() or 0

    # Average latency
    avg_lat = await db.execute(
        select(func.avg(InferenceLog.latency_ms)).where(InferenceLog.model_id == model_id)
    )
    avg_latency = avg_lat.scalar() or 0

    # Verdict distribution
    from sqlalchemy import case
    ok_count = await db.execute(
        select(func.count()).where(
            InferenceLog.model_id == model_id,
            InferenceLog.verdict == "ok"
        )
    )
    anomaly_count = await db.execute(
        select(func.count()).where(
            InferenceLog.model_id == model_id,
            InferenceLog.verdict == "anomaly"
        )
    )

    # Deployments
    deps = await db.execute(
        select(Deployment).where(Deployment.model_id == model_id)
    )

    return {
        "model": {
            "id": str(model.id),
            "name": model.name,
            "architecture": model.architecture,
            "task_type": model.task_type,
            "map50": model.map50,
            "precision_val": model.precision_val,
            "recall_val": model.recall_val,
            "f1_score": model.f1_score,
            "inference_ms": model.inference_ms,
            "status": model.status,
        },
        "usage": {
            "total_inferences": total_inferences,
            "avg_latency_ms": round(avg_latency, 1) if avg_latency else 0,
            "ok_count": ok_count.scalar() or 0,
            "anomaly_count": anomaly_count.scalar() or 0,
        },
        "deployments": [
            {
                "id": str(d.id),
                "format": d.format,
                "status": d.status,
                "created_at": d.created_at.isoformat() if d.created_at else None,
            }
            for d in deps.scalars().all()
        ],
    }


# ═══════════════════════════════════════════════════════════════════════════════
# WEBSOCKET — Training metrics stream (SEQ 2, Step 2.7)
# ═══════════════════════════════════════════════════════════════════════════════

@router.websocket("/ws/training/{job_id}")
async def training_ws(websocket: WebSocket, job_id: str):
    """
    SEQ 2 — Step 2.7 + 3.7
    Stream training metrics from Redis Pub/Sub to the client.
    """
    await websocket.accept()
    import redis.asyncio as aioredis

    r = aioredis.from_url(settings.redis_url)
    pubsub = r.pubsub()
    await pubsub.subscribe(f"training:{job_id}")

    try:
        async for message in pubsub.listen():
            if message["type"] == "message":
                data = message["data"]
                if isinstance(data, bytes):
                    data = data.decode()
                await websocket.send_text(data)
    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected for job {job_id}")
    finally:
        await pubsub.unsubscribe(f"training:{job_id}")
        await r.close()


# ═══════════════════════════════════════════════════════════════════════════════
# BRIQUE 02 — ANALYSE & COMPARAISON
# ═══════════════════════════════════════════════════════════════════════════════

@router.post("/analysis/filter")
async def apply_filter(
    image_id: UUID,
    filter_type: str,  # sobel, canny, equalize
    db: AsyncSession = Depends(get_db),
):
    """Apply a CV filter (Sobel, Canny, EqHist) to an image. Returns presigned URL to result."""
    result = await db.execute(select(Image).where(Image.id == image_id))
    image = result.scalar_one_or_none()
    if not image:
        raise HTTPException(404, "Image not found")

    task = celery_app.send_task(
        "tasks.apply_filter",
        args=[str(image_id), filter_type],
        queue="cpu",
    )
    try:
        result = task.get(timeout=30)
    except Exception as e:
        raise HTTPException(500, f"Filter failed: {str(e)}")

    url = generate_presigned_url(settings.minio_bucket_images, result["result_path"])
    return {"result_url": url, "result_path": result["result_path"], "filter": filter_type}


@router.post("/analysis/fft")
async def compute_fft(
    image_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """Compute FFT magnitude spectrum of an image."""
    result = await db.execute(select(Image).where(Image.id == image_id))
    image = result.scalar_one_or_none()
    if not image:
        raise HTTPException(404, "Image not found")

    task = celery_app.send_task(
        "tasks.compute_fft",
        args=[str(image_id)],
        queue="cpu",
    )
    try:
        result = task.get(timeout=30)
    except Exception as e:
        raise HTTPException(500, f"FFT failed: {str(e)}")

    url = generate_presigned_url(settings.minio_bucket_images, result["fft_path"])
    return {"result_url": url, "fft_path": result["fft_path"]}


@router.post("/analysis/augmentation-preview")
async def preview_augmentation(
    image_id: UUID,
    augmentations: list[dict],
    db: AsyncSession = Depends(get_db),
):
    """Preview augmentations on an image. Returns presigned URL to augmented result."""
    result = await db.execute(select(Image).where(Image.id == image_id))
    image = result.scalar_one_or_none()
    if not image:
        raise HTTPException(404, "Image not found")

    task = celery_app.send_task(
        "tasks.preview_augmentation",
        args=[str(image_id), augmentations],
        queue="cpu",
    )
    try:
        result = task.get(timeout=30)
    except Exception as e:
        raise HTTPException(500, f"Augmentation preview failed: {str(e)}")

    url = generate_presigned_url(settings.minio_bucket_images, result["result_path"])
    return {"result_url": url, "result_path": result["result_path"]}


@router.get("/analysis/image-url/{image_id}")
async def get_image_url(
    image_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """Get presigned URL for direct image access."""
    result = await db.execute(select(Image).where(Image.id == image_id))
    image = result.scalar_one_or_none()
    if not image:
        raise HTTPException(404, "Image not found")

    url = generate_presigned_url(settings.minio_bucket_images, image.storage_path)
    thumb_url = generate_presigned_url(
        settings.minio_bucket_images, image.thumbnail_path
    ) if image.thumbnail_path else None

    return {
        "url": url,
        "thumbnail_url": thumb_url,
        "width": image.width,
        "height": image.height,
        "filename": image.filename,
    }


@router.post("/analysis/diff")
async def compute_image_diff(
    image_id_a: UUID,
    image_id_b: UUID,
    db: AsyncSession = Depends(get_db),
):
    """Compute pixel difference between two images. Returns heatmap + similarity score."""
    # Verify both images exist
    result_a = await db.execute(select(Image).where(Image.id == image_id_a))
    result_b = await db.execute(select(Image).where(Image.id == image_id_b))
    if not result_a.scalar_one_or_none() or not result_b.scalar_one_or_none():
        raise HTTPException(404, "One or both images not found")

    task = celery_app.send_task(
        "tasks.compute_diff",
        args=[str(image_id_a), str(image_id_b)],
        queue="cpu",
    )
    try:
        result = task.get(timeout=30)
    except Exception as e:
        raise HTTPException(500, f"Diff computation failed: {str(e)}")

    url = generate_presigned_url(settings.minio_bucket_images, result["diff_path"])
    return {
        "diff_url": url,
        "diff_path": result["diff_path"],
        "similarity": result["similarity"],
    }


# ═══════════════════════════════════════════════════════════════════════════════
# MLOPS — Drift Detection, Dataset Versioning, Alerts
# ═══════════════════════════════════════════════════════════════════════════════

@router.post("/mlops/drift-analysis/{model_id}")
async def run_drift_analysis(
    model_id: UUID,
    window_days: int = 7,
    db: AsyncSession = Depends(get_db),
):
    """Run data drift analysis on a deployed model."""
    result = await db.execute(select(MLModel).where(MLModel.id == model_id))
    model = result.scalar_one_or_none()
    if not model:
        raise HTTPException(404, "Model not found")

    # Dispatch drift analysis to CPU worker
    task = celery_app.send_task(
        "tasks.run_drift_analysis",
        args=[str(model_id), window_days],
        queue="cpu",
    )
    try:
        report = task.get(timeout=30)
    except Exception as e:
        raise HTTPException(500, f"Drift analysis failed: {str(e)}")

    return report


@router.get("/mlops/drift-reports/{model_id}")
async def get_drift_reports(
    model_id: UUID,
    limit: int = 10,
    db: AsyncSession = Depends(get_db),
):
    """Get historical drift reports for a model."""
    from sqlalchemy import text as sa_text
    result = await db.execute(
        sa_text("""
            SELECT * FROM drift_reports
            WHERE model_id = :model_id
            ORDER BY created_at DESC
            LIMIT :limit
        """),
        {"model_id": str(model_id), "limit": limit}
    )
    return [dict(r) for r in result.mappings().fetchall()]


@router.post("/mlops/dataset-snapshot")
async def create_dataset_snapshot(
    dataset_id: UUID,
    name: str,
    description: str = "",
    db: AsyncSession = Depends(get_db),
):
    """Create a versioned snapshot of a dataset for reproducibility."""
    task = celery_app.send_task(
        "tasks.create_dataset_snapshot",
        args=[str(dataset_id), name, description],
        queue="cpu",
    )
    try:
        result = task.get(timeout=30)
    except Exception as e:
        raise HTTPException(500, f"Snapshot failed: {str(e)}")

    return result


@router.get("/mlops/dataset-versions/{dataset_id}")
async def list_dataset_versions(
    dataset_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """List all versions of a dataset."""
    task = celery_app.send_task(
        "tasks.list_dataset_versions",
        args=[str(dataset_id)],
        queue="cpu",
    )
    try:
        result = task.get(timeout=15)
    except Exception as e:
        raise HTTPException(500, f"Failed: {str(e)}")

    return result


@router.get("/mlops/alerts")
async def get_alerts(
    severity: str = None,
    limit: int = 20,
    db: AsyncSession = Depends(get_db),
):
    """Get recent alerts."""
    from sqlalchemy import text as sa_text
    query = "SELECT * FROM alerts"
    params = {"limit": limit}
    if severity:
        query += " WHERE severity = :sev"
        params["sev"] = severity
    query += " ORDER BY created_at DESC LIMIT :limit"

    result = await db.execute(sa_text(query), params)
    return [dict(r) for r in result.mappings().fetchall()]


@router.post("/mlops/alerts/{alert_id}/acknowledge")
async def acknowledge_alert(
    alert_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """Mark an alert as acknowledged."""
    from sqlalchemy import text as sa_text
    await db.execute(
        sa_text("UPDATE alerts SET acknowledged = true WHERE id = :id"),
        {"id": str(alert_id)}
    )
    return {"status": "acknowledged"}


@router.get("/mlops/experiments")
async def list_experiments():
    """List MLflow experiments (proxy to MLflow API)."""
    import httpx
    mlflow_url = settings.redis_url.replace("redis://redis:6379/0", "http://mlflow:5000")
    mlflow_url = "http://mlflow:5000"
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(f"{mlflow_url}/api/2.0/mlflow/experiments/search", timeout=5)
            return resp.json()
    except Exception as e:
        return {"experiments": [], "error": str(e)}


@router.get("/dashboard/live")
async def live_dashboard(
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    """
    Real-time production dashboard.
    Shows: parts inspected today, defect rate per hour,
    top defect types, model accuracy trend, system health.
    Designed to run on a factory TV screen.
    """
    from sqlalchemy import func as sqlfunc, and_, cast, Date
    from datetime import datetime, timedelta

    now = datetime.utcnow()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    hour_ago = now - timedelta(hours=1)
    week_ago = now - timedelta(days=7)

    org_filter = True
    if user and user.get("organization_id"):
        org_filter = InferenceLog.organization_id == user["organization_id"]

    # Today's inspections
    today_result = await db.execute(
        select(sqlfunc.count(InferenceLog.id)).where(
            and_(InferenceLog.created_at >= today_start, org_filter)
        )
    )
    today_total = today_result.scalar() or 0

    # Today's defects
    today_defects = await db.execute(
        select(sqlfunc.count(InferenceLog.id)).where(
            and_(InferenceLog.created_at >= today_start, InferenceLog.verdict == "anomaly", org_filter)
        )
    )
    today_anomaly = today_defects.scalar() or 0

    # Last hour
    hour_result = await db.execute(
        select(sqlfunc.count(InferenceLog.id)).where(
            and_(InferenceLog.created_at >= hour_ago, org_filter)
        )
    )
    last_hour_total = hour_result.scalar() or 0

    hour_defects = await db.execute(
        select(sqlfunc.count(InferenceLog.id)).where(
            and_(InferenceLog.created_at >= hour_ago, InferenceLog.verdict == "anomaly", org_filter)
        )
    )
    last_hour_anomaly = hour_defects.scalar() or 0

    # Average latency today
    lat_result = await db.execute(
        select(sqlfunc.avg(InferenceLog.latency_ms)).where(
            and_(InferenceLog.created_at >= today_start, org_filter)
        )
    )
    avg_latency = round(lat_result.scalar() or 0, 1)

    # Total models
    model_count = await db.execute(select(sqlfunc.count(MLModel.id)))
    total_models = model_count.scalar() or 0

    # Active model (most recent ready)
    active_model_result = await db.execute(
        select(MLModel).where(MLModel.status == "ready").order_by(MLModel.created_at.desc()).limit(1)
    )
    active_model = active_model_result.scalar_one_or_none()

    # Weekly trend (last 7 days)
    weekly_trend = []
    for i in range(7):
        day = now - timedelta(days=6-i)
        day_start = day.replace(hour=0, minute=0, second=0, microsecond=0)
        day_end = day_start + timedelta(days=1)
        day_total = await db.execute(
            select(sqlfunc.count(InferenceLog.id)).where(
                and_(InferenceLog.created_at >= day_start, InferenceLog.created_at < day_end, org_filter)
            )
        )
        day_defects = await db.execute(
            select(sqlfunc.count(InferenceLog.id)).where(
                and_(InferenceLog.created_at >= day_start, InferenceLog.created_at < day_end,
                     InferenceLog.verdict == "anomaly", org_filter)
            )
        )
        weekly_trend.append({
            "date": day_start.strftime("%Y-%m-%d"),
            "day": day_start.strftime("%a"),
            "inspections": day_total.scalar() or 0,
            "defects": day_defects.scalar() or 0,
        })

    return {
        "timestamp": now.isoformat(),
        "today": {
            "inspections": today_total,
            "defects": today_anomaly,
            "pass_rate": round((1 - today_anomaly / max(today_total, 1)) * 100, 1),
            "defect_rate": round(today_anomaly / max(today_total, 1) * 100, 1),
        },
        "last_hour": {
            "inspections": last_hour_total,
            "defects": last_hour_anomaly,
            "defect_rate": round(last_hour_anomaly / max(last_hour_total, 1) * 100, 1),
        },
        "performance": {
            "avg_latency_ms": avg_latency,
            "total_models": total_models,
            "active_model": {
                "name": active_model.name,
                "architecture": active_model.architecture,
                "map50": active_model.map50,
            } if active_model else None,
        },
        "weekly_trend": weekly_trend,
    }



# ═══════════════════════════════════════════════════════════════════════════════
# COMPARISON VIEW — Golden Reference
# ═══════════════════════════════════════════════════════════════════════════════

@router.post("/compare/images")
async def compare_two_images(
    image_a: UploadFile = File(...),
    image_b: UploadFile = File(...),
    sensitivity: float = 30.0,
):
    """Compare two images and highlight differences."""
    import numpy as np
    import cv2
    from io import BytesIO
    from PIL import Image as PILImage

    a_bytes = await image_a.read()
    b_bytes = await image_b.read()
    img_a = np.array(PILImage.open(BytesIO(a_bytes)).convert("RGB"))
    img_b = np.array(PILImage.open(BytesIO(b_bytes)).convert("RGB"))
    h, w = img_a.shape[:2]
    img_b = cv2.resize(img_b, (w, h))
    gray_a = cv2.GaussianBlur(cv2.cvtColor(img_a, cv2.COLOR_RGB2GRAY), (5, 5), 0)
    gray_b = cv2.GaussianBlur(cv2.cvtColor(img_b, cv2.COLOR_RGB2GRAY), (5, 5), 0)
    diff = cv2.absdiff(gray_a, gray_b)
    _, thresh = cv2.threshold(diff, sensitivity, 255, cv2.THRESH_BINARY)
    diff_pixels = cv2.countNonZero(thresh)
    total_pixels = w * h
    similarity = round((1 - diff_pixels / total_pixels) * 100, 1)
    contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    significant_zones = [c for c in contours if cv2.contourArea(c) > 50]
    zones = []
    for c in significant_zones:
        x, y, cw, ch = cv2.boundingRect(c)
        zones.append({"bbox": [int(x), int(y), int(x+cw), int(y+ch)], "area_percent": round(cv2.contourArea(c)/(w*h)*100, 2)})
    return {
        "similarity_percent": similarity,
        "different_pixels": diff_pixels,
        "total_pixels": total_pixels,
        "deviation_zones": len(zones),
        "zones": zones,
        "verdict": "IDENTICAL" if similarity > 98 else "SIMILAR" if similarity > 90 else "DIFFERENT",
    }


@router.post("/compare/reference")
async def compare_with_reference(
    reference_image: UploadFile = File(...),
    inspection_image: UploadFile = File(...),
    sensitivity: float = 30.0,
    user=Depends(get_current_user),
):
    """Compare production part against golden reference. Returns heatmap URL."""
    import numpy as np
    import cv2
    from io import BytesIO
    from PIL import Image as PILImage
    from datetime import datetime

    ref_bytes = await reference_image.read()
    insp_bytes = await inspection_image.read()
    ref_img = np.array(PILImage.open(BytesIO(ref_bytes)).convert("RGB"))
    insp_img = np.array(PILImage.open(BytesIO(insp_bytes)).convert("RGB"))
    h, w = ref_img.shape[:2]
    insp_img = cv2.resize(insp_img, (w, h))
    ref_gray = cv2.GaussianBlur(cv2.cvtColor(ref_img, cv2.COLOR_RGB2GRAY), (5, 5), 0)
    insp_gray = cv2.GaussianBlur(cv2.cvtColor(insp_img, cv2.COLOR_RGB2GRAY), (5, 5), 0)
    diff = cv2.absdiff(ref_gray, insp_gray)
    _, thresh = cv2.threshold(diff, sensitivity, 255, cv2.THRESH_BINARY)
    contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    diff_normalized = cv2.normalize(diff, None, 0, 255, cv2.NORM_MINMAX)
    heatmap = cv2.applyColorMap(diff_normalized, cv2.COLORMAP_JET)
    overlay = cv2.addWeighted(cv2.cvtColor(insp_img, cv2.COLOR_RGB2BGR), 0.6, heatmap, 0.4, 0)

    zones = []
    for c in contours:
        area = cv2.contourArea(c)
        if area < 50:
            continue
        x, y, cw, ch = cv2.boundingRect(c)
        cv2.rectangle(overlay, (x, y), (x+cw, y+ch), (0, 255, 255), 2)
        zones.append({"id": len(zones)+1, "bbox": [int(x), int(y), int(x+cw), int(y+ch)], "area_percent": round(area/(w*h)*100, 2)})

    _, img_encoded = cv2.imencode(".png", overlay)
    heat_key = f"comparisons/{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}_heatmap.png"
    from app.core.storage import get_s3_client, generate_presigned_url
    s3 = get_s3_client()
    s3.put_object(Bucket="exports", Key=heat_key, Body=img_encoded.tobytes(), ContentType="image/png")
    heatmap_url = generate_presigned_url("exports", heat_key)

    total_diff = sum(cv2.contourArea(c) for c in contours if cv2.contourArea(c) > 50)
    score = min(100, round(total_diff / (w*h) * 1000, 1))
    verdict = "PASS" if score < 5 else "REVIEW" if score < 15 else "FAIL"

    return {
        "verdict": verdict, "deviation_score": score, "zones": zones,
        "heatmap_url": heatmap_url, "message": f"{verdict}: {len(zones)} zones (score: {score}/100)",
    }


# ═══════════════════════════════════════════════════════════════════════════════
# EXPORT — CSV
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/export/annotations/{dataset_id}")
async def export_annotations_csv(
    dataset_id: UUID, format: str = "csv",
    db: AsyncSession = Depends(get_db), user=Depends(get_current_user),
):
    """Export annotations as CSV. Quality managers import into Excel."""
    from fastapi.responses import StreamingResponse
    import csv, io

    ds = await db.execute(select(Dataset).where(Dataset.id == dataset_id))
    dataset = ds.scalar_one_or_none()
    if not dataset:
        raise HTTPException(404, "Dataset not found")

    imgs = await db.execute(select(Image).where(Image.dataset_id == dataset_id))
    images = {str(i.id): i for i in imgs.scalars().all()}
    anns = await db.execute(select(Annotation).where(Annotation.image_id.in_(list(images.keys()))))
    annotations = anns.scalars().all()

    if format == "json":
        rows = [{"image": images.get(str(a.image_id), Image()).filename if images.get(str(a.image_id)) else "?",
                 "class": a.defect_class, "severity": a.severity,
                 "coords": a.coordinates, "date": a.created_at.isoformat() if a.created_at else ""} for a in annotations]
        return {"dataset": dataset.name, "total": len(rows), "annotations": rows}

    output = io.StringIO()
    w = csv.writer(output)
    w.writerow(["image", "defect_class", "severity", "bbox_x", "bbox_y", "bbox_w", "bbox_h", "date"])
    for a in annotations:
        img = images.get(str(a.image_id))
        c = a.coordinates if isinstance(a.coordinates, dict) else {}
        w.writerow([img.filename if img else "?", a.defect_class, a.severity,
                    c.get("nx",0), c.get("ny",0), c.get("nw",0), c.get("nh",0),
                    a.created_at.isoformat() if a.created_at else ""])
    output.seek(0)
    return StreamingResponse(iter([output.getvalue()]), media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={dataset.name.replace(' ','_')}_annotations.csv"})


@router.get("/export/inferences/{model_id}")
async def export_inferences_csv(
    model_id: UUID, format: str = "csv",
    db: AsyncSession = Depends(get_db), user=Depends(get_current_user),
):
    """Export inference history as CSV."""
    from fastapi.responses import StreamingResponse
    import csv, io

    m = await db.execute(select(MLModel).where(MLModel.id == model_id))
    model = m.scalar_one_or_none()
    if not model:
        raise HTTPException(404, "Model not found")

    logs = await db.execute(select(InferenceLog).where(InferenceLog.model_id == model_id).order_by(InferenceLog.created_at.desc()))
    all_logs = logs.scalars().all()

    if format == "json":
        return {"model": model.name, "total": len(all_logs),
                "inferences": [{"verdict": l.verdict, "latency": l.latency_ms,
                    "date": l.created_at.isoformat() if l.created_at else ""} for l in all_logs]}

    output = io.StringIO()
    w = csv.writer(output)
    w.writerow(["timestamp", "verdict", "latency_ms", "detections"])
    for l in all_logs:
        dets = l.detections if isinstance(l.detections, list) else []
        w.writerow([l.created_at.isoformat() if l.created_at else "", l.verdict, l.latency_ms,
                    ";".join(f"{d.get('class','?')}({d.get('confidence',0):.0%})" for d in dets) if dets else "none"])
    output.seek(0)
    return StreamingResponse(iter([output.getvalue()]), media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={model.name}_inferences.csv"})


@router.get("/export/dashboard")
async def export_dashboard_csv(
    days: int = 30, db: AsyncSession = Depends(get_db), user=Depends(get_current_user),
):
    """Export daily inspection summary as CSV for Excel charts."""
    from fastapi.responses import StreamingResponse
    from sqlalchemy import func as sqlfunc, and_
    from datetime import datetime, timedelta
    import csv, io

    now = datetime.utcnow()
    output = io.StringIO()
    w = csv.writer(output)
    w.writerow(["date", "day", "inspections", "defects", "ok", "defect_rate", "avg_latency_ms"])
    for i in range(days):
        day = now - timedelta(days=days-1-i)
        ds = day.replace(hour=0, minute=0, second=0, microsecond=0)
        de = ds + timedelta(days=1)
        t = (await db.execute(select(sqlfunc.count(InferenceLog.id)).where(and_(InferenceLog.created_at >= ds, InferenceLog.created_at < de)))).scalar() or 0
        d = (await db.execute(select(sqlfunc.count(InferenceLog.id)).where(and_(InferenceLog.created_at >= ds, InferenceLog.created_at < de, InferenceLog.verdict == "anomaly")))).scalar() or 0
        lat = round((await db.execute(select(sqlfunc.avg(InferenceLog.latency_ms)).where(and_(InferenceLog.created_at >= ds, InferenceLog.created_at < de)))).scalar() or 0, 1)
        w.writerow([ds.strftime("%Y-%m-%d"), ds.strftime("%A"), t, d, t-d, round(d/max(t,1)*100, 1), lat])
    output.seek(0)
    return StreamingResponse(iter([output.getvalue()]), media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=vista_dashboard_export.csv"})


# ═══════════════════════════════════════════════════════════════════════════════
# DEFECT HEATMAP PER BATCH
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/heatmap/defects/{dataset_id}")
async def defect_heatmap(
    dataset_id: UUID,
    width: int = 512,
    height: int = 512,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    """
    Generate a defect density heatmap for a dataset.
    Shows where defects appear most frequently on the part geometry.
    If 70% of porosity is in upper-left, the mold has a problem there.
    Turns VISTA from detection tool into diagnostic tool.
    """
    import numpy as np
    import cv2
    import base64

    # Get all annotations for this dataset
    imgs = await db.execute(select(Image).where(Image.dataset_id == dataset_id))
    image_ids = [str(i.id) for i in imgs.scalars().all()]
    if not image_ids:
        raise HTTPException(404, "No images in dataset")

    anns = await db.execute(
        select(Annotation).where(Annotation.image_id.in_(image_ids))
    )
    annotations = anns.scalars().all()
    if not annotations:
        return {"message": "No annotations found", "heatmap_b64": None}

    # Build density map
    density = np.zeros((height, width), dtype=np.float32)

    class_density = {}
    for ann in annotations:
        coords = ann.coordinates if isinstance(ann.coordinates, dict) else {}
        nx = coords.get("nx", 0)
        ny = coords.get("ny", 0)
        nw = coords.get("nw", 0.1)
        nh = coords.get("nh", 0.1)

        x1 = int(nx * width)
        y1 = int(ny * height)
        x2 = int((nx + nw) * width)
        y2 = int((ny + nh) * height)
        x1, y1 = max(0, x1), max(0, y1)
        x2, y2 = min(width, x2), min(height, y2)

        density[y1:y2, x1:x2] += 1.0

        cls = ann.defect_class
        if cls not in class_density:
            class_density[cls] = np.zeros((height, width), dtype=np.float32)
        class_density[cls][y1:y2, x1:x2] += 1.0

    # Normalize and colorize
    if density.max() > 0:
        density_norm = (density / density.max() * 255).astype(np.uint8)
    else:
        density_norm = density.astype(np.uint8)

    heatmap = cv2.applyColorMap(density_norm, cv2.COLORMAP_JET)
    _, buf = cv2.imencode(".png", heatmap)
    heatmap_b64 = base64.b64encode(buf).decode()

    # Find hotspots (zones with highest density)
    hotspots = []
    thresh = density.max() * 0.5
    if thresh > 0:
        binary = (density > thresh).astype(np.uint8) * 255
        contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        for c in contours:
            if cv2.contourArea(c) < 100:
                continue
            x, y, w, h = cv2.boundingRect(c)
            hotspots.append({
                "bbox": [x, y, x+w, y+h],
                "center": [x + w//2, y + h//2],
                "intensity": round(float(density[y:y+h, x:x+w].mean()), 2),
                "area_percent": round(cv2.contourArea(c) / (width * height) * 100, 1),
            })

    # Per-class summary
    class_summary = {}
    for cls, dens in class_density.items():
        total = float(dens.sum())
        if total > 0:
            ys, xs = np.where(dens > 0)
            class_summary[cls] = {
                "count": int(len([a for a in annotations if a.defect_class == cls])),
                "center_of_mass": [int(xs.mean()), int(ys.mean())],
                "spread_percent": round(np.count_nonzero(dens) / (width * height) * 100, 1),
            }

    return {
        "dataset_id": str(dataset_id),
        "total_annotations": len(annotations),
        "image_size": {"width": width, "height": height},
        "heatmap_b64": heatmap_b64,
        "hotspots": sorted(hotspots, key=lambda h: h["intensity"], reverse=True),
        "class_summary": class_summary,
        "diagnostic": f"{len(hotspots)} hotspot(s) detected — check mold/tooling in those zones" if hotspots else "Defects evenly distributed — no tooling issue detected",
    }


# ═══════════════════════════════════════════════════════════════════════════════
# WEBHOOK / API CALLBACKS
# ═══════════════════════════════════════════════════════════════════════════════

@router.post("/webhooks")
async def create_webhook(
    url: str,
    event: str = "defect_detected",
    name: str = "My Webhook",
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    """
    Register a webhook. VISTA calls this URL when events occur.
    Events: defect_detected, training_completed, drift_alert, batch_complete.
    Integration with Slack, Teams, ERP, PLC systems.
    """
    from sqlalchemy import text
    webhook_id = str(__import__("uuid").uuid4())
    org_id = user.get("organization_id") if user else None

    await db.execute(text("""
        CREATE TABLE IF NOT EXISTS webhooks (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            name VARCHAR(255),
            url VARCHAR(1024) NOT NULL,
            event VARCHAR(100) NOT NULL,
            organization_id UUID,
            is_active BOOLEAN DEFAULT true,
            secret VARCHAR(255),
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
    """))

    await db.execute(text("""
        INSERT INTO webhooks (id, name, url, event, organization_id)
        VALUES (:id, :name, :url, :event, :org)
    """), {"id": webhook_id, "name": name, "url": url, "event": event, "org": org_id})

    return {
        "id": webhook_id,
        "name": name,
        "url": url,
        "event": event,
        "message": f"Webhook registered — VISTA will POST to {url} on '{event}' events",
    }


@router.get("/webhooks")
async def list_webhooks(
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    """List all registered webhooks."""
    from sqlalchemy import text
    try:
        result = await db.execute(text("SELECT id, name, url, event, is_active, created_at FROM webhooks ORDER BY created_at DESC"))
        return [dict(r) for r in result.mappings().fetchall()]
    except Exception:
        return []


@router.delete("/webhooks/{webhook_id}")
async def delete_webhook(
    webhook_id: UUID,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    """Delete a webhook."""
    from sqlalchemy import text
    await db.execute(text("DELETE FROM webhooks WHERE id = :id"), {"id": str(webhook_id)})
    return {"message": "Webhook deleted"}


@router.post("/webhooks/test/{webhook_id}")
async def test_webhook(
    webhook_id: UUID,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    """Send a test payload to a webhook URL."""
    import requests as req
    from sqlalchemy import text
    from datetime import datetime

    result = await db.execute(text("SELECT url, event FROM webhooks WHERE id = :id"), {"id": str(webhook_id)})
    wh = result.mappings().fetchone()
    if not wh:
        raise HTTPException(404, "Webhook not found")

    payload = {
        "event": wh["event"],
        "timestamp": datetime.utcnow().isoformat(),
        "source": "VISTA",
        "test": True,
        "data": {
            "message": "This is a test webhook from VISTA",
            "verdict": "anomaly",
            "confidence": 0.87,
            "defect_class": "Porosité",
        }
    }

    try:
        resp = req.post(wh["url"], json=payload, timeout=5)
        return {"status": resp.status_code, "success": resp.ok, "message": f"Webhook called — response: {resp.status_code}"}
    except Exception as e:
        return {"status": 0, "success": False, "message": f"Failed: {str(e)}"}


# ═══════════════════════════════════════════════════════════════════════════════
# AUGMENTATION PREVIEW
# ═══════════════════════════════════════════════════════════════════════════════

@router.post("/augmentation/preview")
async def augmentation_preview(
    image: UploadFile = File(...),
    flip_h: float = 0.5,
    flip_v: float = 0.0,
    rotation: float = 15.0,
    brightness: float = 0.2,
    noise: float = 0.1,
    count: int = 6,
):
    """
    Preview data augmentation on an image before training.
    Shows what augmented images look like (rotated, flipped, color-shifted).
    Engineers verify augmentations don't create unrealistic images.
    Returns base64-encoded previews.
    """
    import numpy as np
    import cv2
    import base64
    import random
    from io import BytesIO
    from PIL import Image as PILImage

    img_bytes = await image.read()
    img = np.array(PILImage.open(BytesIO(img_bytes)).convert("RGB"))
    img_bgr = cv2.cvtColor(img, cv2.COLOR_RGB2BGR)
    h, w = img_bgr.shape[:2]

    previews = []
    aug_names = []

    for i in range(min(count, 9)):
        augmented = img_bgr.copy()
        applied = []

        # Random horizontal flip
        if random.random() < flip_h:
            augmented = cv2.flip(augmented, 1)
            applied.append("H-Flip")

        # Random vertical flip
        if random.random() < flip_v:
            augmented = cv2.flip(augmented, 0)
            applied.append("V-Flip")

        # Random rotation
        if rotation > 0:
            angle = random.uniform(-rotation, rotation)
            M = cv2.getRotationMatrix2D((w/2, h/2), angle, 1.0)
            augmented = cv2.warpAffine(augmented, M, (w, h), borderMode=cv2.BORDER_REFLECT)
            applied.append(f"Rot {angle:.0f}°")

        # Random brightness
        if brightness > 0:
            factor = 1.0 + random.uniform(-brightness, brightness)
            augmented = np.clip(augmented * factor, 0, 255).astype(np.uint8)
            applied.append(f"Bright {factor:.2f}")

        # Random Gaussian noise
        if noise > 0 and random.random() < 0.5:
            gauss = np.random.normal(0, noise * 255, augmented.shape).astype(np.int16)
            augmented = np.clip(augmented.astype(np.int16) + gauss, 0, 255).astype(np.uint8)
            applied.append("Noise")

        # Add label to image
        label = " + ".join(applied) if applied else "Original"
        cv2.putText(augmented, label, (10, 25), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 1)

        _, buf = cv2.imencode(".jpg", augmented, [cv2.IMWRITE_JPEG_QUALITY, 85])
        previews.append(base64.b64encode(buf).decode())
        aug_names.append(label)

    return {
        "original_size": {"width": w, "height": h},
        "augmentation_config": {
            "flip_h": flip_h, "flip_v": flip_v,
            "rotation": rotation, "brightness": brightness, "noise": noise,
        },
        "count": len(previews),
        "previews": [{"index": i, "augmentations": aug_names[i], "image_b64": p} for i, p in enumerate(previews)],
    }


# ═══════════════════════════════════════════════════════════════════════════════
# IMAGE NAVIGATION — Defect Navigator
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/navigate/defects/{dataset_id}")
async def navigate_defects(
    dataset_id: UUID,
    defect_class: Optional[str] = None,
    severity: Optional[str] = None,
    page: int = 1,
    per_page: int = 20,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    """
    Defect navigator — browse through all annotated defects in a dataset.
    Supports filtering by class and severity.
    Returns image info + annotation details for each defect.
    UI uses this for "Next defect" / "Previous defect" navigation.
    """
    from sqlalchemy import and_

    # Get images in dataset
    imgs = await db.execute(select(Image).where(Image.dataset_id == dataset_id))
    image_map = {str(i.id): i for i in imgs.scalars().all()}
    if not image_map:
        raise HTTPException(404, "No images in dataset")

    # Build annotation query with filters
    query = select(Annotation).where(
        Annotation.image_id.in_(list(image_map.keys()))
    )
    if defect_class:
        query = query.where(Annotation.defect_class == defect_class)
    if severity:
        query = query.where(Annotation.severity == severity)
    query = query.order_by(Annotation.created_at.desc())

    # Count total
    from sqlalchemy import func as sqlfunc
    count_q = select(sqlfunc.count(Annotation.id)).where(
        Annotation.image_id.in_(list(image_map.keys()))
    )
    if defect_class:
        count_q = count_q.where(Annotation.defect_class == defect_class)
    if severity:
        count_q = count_q.where(Annotation.severity == severity)
    total = (await db.execute(count_q)).scalar() or 0

    # Paginate
    offset = (page - 1) * per_page
    query = query.offset(offset).limit(per_page)
    anns = (await db.execute(query)).scalars().all()

    # Build navigation list
    defects = []
    for ann in anns:
        img = image_map.get(str(ann.image_id))
        coords = ann.coordinates if isinstance(ann.coordinates, dict) else {}
        defects.append({
            "annotation_id": str(ann.id),
            "image_id": str(ann.image_id),
            "image_filename": img.filename if img else "unknown",
            "defect_class": ann.defect_class,
            "severity": ann.severity,
            "description": ann.description,
            "bbox": {
                "x": coords.get("nx", 0),
                "y": coords.get("ny", 0),
                "w": coords.get("nw", 0),
                "h": coords.get("nh", 0),
            },
            "created_at": ann.created_at.isoformat() if ann.created_at else None,
        })

    # Summary stats
    all_anns = await db.execute(
        select(Annotation.defect_class, sqlfunc.count(Annotation.id).label("count"))
        .where(Annotation.image_id.in_(list(image_map.keys())))
        .group_by(Annotation.defect_class)
    )
    class_counts = {r.defect_class: r.count for r in all_anns.fetchall()}

    sev_anns = await db.execute(
        select(Annotation.severity, sqlfunc.count(Annotation.id).label("count"))
        .where(Annotation.image_id.in_(list(image_map.keys())))
        .group_by(Annotation.severity)
    )
    severity_counts = {r.severity: r.count for r in sev_anns.fetchall()}

    return {
        "dataset_id": str(dataset_id),
        "total_defects": total,
        "page": page,
        "per_page": per_page,
        "total_pages": (total + per_page - 1) // per_page,
        "defects": defects,
        "filters": {
            "classes": class_counts,
            "severities": severity_counts,
        },
        "has_next": page * per_page < total,
        "has_prev": page > 1,
    }


# ═══════════════════════════════════════════════════════════════════════════════
# DEFECT HEATMAP PER BATCH
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/heatmap/defects/{dataset_id}")
async def defect_heatmap(
    dataset_id: UUID,
    width: int = 512,
    height: int = 512,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    """
    Generate a defect density heatmap for a dataset.
    Shows where defects appear most frequently on the part geometry.
    If 70% of porosity is in upper-left, the mold has a problem there.
    Turns VISTA from detection tool into diagnostic tool.
    """
    import numpy as np
    import cv2
    import base64

    # Get all annotations for this dataset
    imgs = await db.execute(select(Image).where(Image.dataset_id == dataset_id))
    image_ids = [str(i.id) for i in imgs.scalars().all()]
    if not image_ids:
        raise HTTPException(404, "No images in dataset")

    anns = await db.execute(
        select(Annotation).where(Annotation.image_id.in_(image_ids))
    )
    annotations = anns.scalars().all()
    if not annotations:
        return {"message": "No annotations found", "heatmap_b64": None}

    # Build density map
    density = np.zeros((height, width), dtype=np.float32)

    class_density = {}
    for ann in annotations:
        coords = ann.coordinates if isinstance(ann.coordinates, dict) else {}
        nx = coords.get("nx", 0)
        ny = coords.get("ny", 0)
        nw = coords.get("nw", 0.1)
        nh = coords.get("nh", 0.1)

        x1 = int(nx * width)
        y1 = int(ny * height)
        x2 = int((nx + nw) * width)
        y2 = int((ny + nh) * height)
        x1, y1 = max(0, x1), max(0, y1)
        x2, y2 = min(width, x2), min(height, y2)

        density[y1:y2, x1:x2] += 1.0

        cls = ann.defect_class
        if cls not in class_density:
            class_density[cls] = np.zeros((height, width), dtype=np.float32)
        class_density[cls][y1:y2, x1:x2] += 1.0

    # Normalize and colorize
    if density.max() > 0:
        density_norm = (density / density.max() * 255).astype(np.uint8)
    else:
        density_norm = density.astype(np.uint8)

    heatmap = cv2.applyColorMap(density_norm, cv2.COLORMAP_JET)
    _, buf = cv2.imencode(".png", heatmap)
    heatmap_b64 = base64.b64encode(buf).decode()

    # Find hotspots (zones with highest density)
    hotspots = []
    thresh = density.max() * 0.5
    if thresh > 0:
        binary = (density > thresh).astype(np.uint8) * 255
        contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        for c in contours:
            if cv2.contourArea(c) < 100:
                continue
            x, y, w, h = cv2.boundingRect(c)
            hotspots.append({
                "bbox": [x, y, x+w, y+h],
                "center": [x + w//2, y + h//2],
                "intensity": round(float(density[y:y+h, x:x+w].mean()), 2),
                "area_percent": round(cv2.contourArea(c) / (width * height) * 100, 1),
            })

    # Per-class summary
    class_summary = {}
    for cls, dens in class_density.items():
        total = float(dens.sum())
        if total > 0:
            ys, xs = np.where(dens > 0)
            class_summary[cls] = {
                "count": int(len([a for a in annotations if a.defect_class == cls])),
                "center_of_mass": [int(xs.mean()), int(ys.mean())],
                "spread_percent": round(np.count_nonzero(dens) / (width * height) * 100, 1),
            }

    return {
        "dataset_id": str(dataset_id),
        "total_annotations": len(annotations),
        "image_size": {"width": width, "height": height},
        "heatmap_b64": heatmap_b64,
        "hotspots": sorted(hotspots, key=lambda h: h["intensity"], reverse=True),
        "class_summary": class_summary,
        "diagnostic": f"{len(hotspots)} hotspot(s) detected — check mold/tooling in those zones" if hotspots else "Defects evenly distributed — no tooling issue detected",
    }


# ═══════════════════════════════════════════════════════════════════════════════
# WEBHOOK / API CALLBACKS
# ═══════════════════════════════════════════════════════════════════════════════

@router.post("/webhooks")
async def create_webhook(
    url: str,
    event: str = "defect_detected",
    name: str = "My Webhook",
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    """
    Register a webhook. VISTA calls this URL when events occur.
    Events: defect_detected, training_completed, drift_alert, batch_complete.
    Integration with Slack, Teams, ERP, PLC systems.
    """
    from sqlalchemy import text
    webhook_id = str(__import__("uuid").uuid4())
    org_id = user.get("organization_id") if user else None

    await db.execute(text("""
        CREATE TABLE IF NOT EXISTS webhooks (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            name VARCHAR(255),
            url VARCHAR(1024) NOT NULL,
            event VARCHAR(100) NOT NULL,
            organization_id UUID,
            is_active BOOLEAN DEFAULT true,
            secret VARCHAR(255),
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
    """))

    await db.execute(text("""
        INSERT INTO webhooks (id, name, url, event, organization_id)
        VALUES (:id, :name, :url, :event, :org)
    """), {"id": webhook_id, "name": name, "url": url, "event": event, "org": org_id})

    return {
        "id": webhook_id,
        "name": name,
        "url": url,
        "event": event,
        "message": f"Webhook registered — VISTA will POST to {url} on '{event}' events",
    }


@router.get("/webhooks")
async def list_webhooks(
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    """List all registered webhooks."""
    from sqlalchemy import text
    try:
        result = await db.execute(text("SELECT id, name, url, event, is_active, created_at FROM webhooks ORDER BY created_at DESC"))
        return [dict(r) for r in result.mappings().fetchall()]
    except Exception:
        return []


@router.delete("/webhooks/{webhook_id}")
async def delete_webhook(
    webhook_id: UUID,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    """Delete a webhook."""
    from sqlalchemy import text
    await db.execute(text("DELETE FROM webhooks WHERE id = :id"), {"id": str(webhook_id)})
    return {"message": "Webhook deleted"}


@router.post("/webhooks/test/{webhook_id}")
async def test_webhook(
    webhook_id: UUID,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    """Send a test payload to a webhook URL."""
    import requests as req
    from sqlalchemy import text
    from datetime import datetime

    result = await db.execute(text("SELECT url, event FROM webhooks WHERE id = :id"), {"id": str(webhook_id)})
    wh = result.mappings().fetchone()
    if not wh:
        raise HTTPException(404, "Webhook not found")

    payload = {
        "event": wh["event"],
        "timestamp": datetime.utcnow().isoformat(),
        "source": "VISTA",
        "test": True,
        "data": {
            "message": "This is a test webhook from VISTA",
            "verdict": "anomaly",
            "confidence": 0.87,
            "defect_class": "Porosité",
        }
    }

    try:
        resp = req.post(wh["url"], json=payload, timeout=5)
        return {"status": resp.status_code, "success": resp.ok, "message": f"Webhook called — response: {resp.status_code}"}
    except Exception as e:
        return {"status": 0, "success": False, "message": f"Failed: {str(e)}"}


# ═══════════════════════════════════════════════════════════════════════════════
# AUGMENTATION PREVIEW
# ═══════════════════════════════════════════════════════════════════════════════

@router.post("/augmentation/preview")
async def augmentation_preview(
    image: UploadFile = File(...),
    flip_h: float = 0.5,
    flip_v: float = 0.0,
    rotation: float = 15.0,
    brightness: float = 0.2,
    noise: float = 0.1,
    count: int = 6,
):
    """
    Preview data augmentation on an image before training.
    Shows what augmented images look like (rotated, flipped, color-shifted).
    Engineers verify augmentations don't create unrealistic images.
    Returns base64-encoded previews.
    """
    import numpy as np
    import cv2
    import base64
    import random
    from io import BytesIO
    from PIL import Image as PILImage

    img_bytes = await image.read()
    img = np.array(PILImage.open(BytesIO(img_bytes)).convert("RGB"))
    img_bgr = cv2.cvtColor(img, cv2.COLOR_RGB2BGR)
    h, w = img_bgr.shape[:2]

    previews = []
    aug_names = []

    for i in range(min(count, 9)):
        augmented = img_bgr.copy()
        applied = []

        # Random horizontal flip
        if random.random() < flip_h:
            augmented = cv2.flip(augmented, 1)
            applied.append("H-Flip")

        # Random vertical flip
        if random.random() < flip_v:
            augmented = cv2.flip(augmented, 0)
            applied.append("V-Flip")

        # Random rotation
        if rotation > 0:
            angle = random.uniform(-rotation, rotation)
            M = cv2.getRotationMatrix2D((w/2, h/2), angle, 1.0)
            augmented = cv2.warpAffine(augmented, M, (w, h), borderMode=cv2.BORDER_REFLECT)
            applied.append(f"Rot {angle:.0f}°")

        # Random brightness
        if brightness > 0:
            factor = 1.0 + random.uniform(-brightness, brightness)
            augmented = np.clip(augmented * factor, 0, 255).astype(np.uint8)
            applied.append(f"Bright {factor:.2f}")

        # Random Gaussian noise
        if noise > 0 and random.random() < 0.5:
            gauss = np.random.normal(0, noise * 255, augmented.shape).astype(np.int16)
            augmented = np.clip(augmented.astype(np.int16) + gauss, 0, 255).astype(np.uint8)
            applied.append("Noise")

        # Add label to image
        label = " + ".join(applied) if applied else "Original"
        cv2.putText(augmented, label, (10, 25), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 1)

        _, buf = cv2.imencode(".jpg", augmented, [cv2.IMWRITE_JPEG_QUALITY, 85])
        previews.append(base64.b64encode(buf).decode())
        aug_names.append(label)

    return {
        "original_size": {"width": w, "height": h},
        "augmentation_config": {
            "flip_h": flip_h, "flip_v": flip_v,
            "rotation": rotation, "brightness": brightness, "noise": noise,
        },
        "count": len(previews),
        "previews": [{"index": i, "augmentations": aug_names[i], "image_b64": p} for i, p in enumerate(previews)],
    }


# ═══════════════════════════════════════════════════════════════════════════════
# IMAGE NAVIGATION — Defect Navigator
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/navigate/defects/{dataset_id}")
async def navigate_defects(
    dataset_id: UUID,
    defect_class: Optional[str] = None,
    severity: Optional[str] = None,
    page: int = 1,
    per_page: int = 20,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    """
    Defect navigator — browse through all annotated defects in a dataset.
    Supports filtering by class and severity.
    Returns image info + annotation details for each defect.
    UI uses this for "Next defect" / "Previous defect" navigation.
    """
    from sqlalchemy import and_

    # Get images in dataset
    imgs = await db.execute(select(Image).where(Image.dataset_id == dataset_id))
    image_map = {str(i.id): i for i in imgs.scalars().all()}
    if not image_map:
        raise HTTPException(404, "No images in dataset")

    # Build annotation query with filters
    query = select(Annotation).where(
        Annotation.image_id.in_(list(image_map.keys()))
    )
    if defect_class:
        query = query.where(Annotation.defect_class == defect_class)
    if severity:
        query = query.where(Annotation.severity == severity)
    query = query.order_by(Annotation.created_at.desc())

    # Count total
    from sqlalchemy import func as sqlfunc
    count_q = select(sqlfunc.count(Annotation.id)).where(
        Annotation.image_id.in_(list(image_map.keys()))
    )
    if defect_class:
        count_q = count_q.where(Annotation.defect_class == defect_class)
    if severity:
        count_q = count_q.where(Annotation.severity == severity)
    total = (await db.execute(count_q)).scalar() or 0

    # Paginate
    offset = (page - 1) * per_page
    query = query.offset(offset).limit(per_page)
    anns = (await db.execute(query)).scalars().all()

    # Build navigation list
    defects = []
    for ann in anns:
        img = image_map.get(str(ann.image_id))
        coords = ann.coordinates if isinstance(ann.coordinates, dict) else {}
        defects.append({
            "annotation_id": str(ann.id),
            "image_id": str(ann.image_id),
            "image_filename": img.filename if img else "unknown",
            "defect_class": ann.defect_class,
            "severity": ann.severity,
            "description": ann.description,
            "bbox": {
                "x": coords.get("nx", 0),
                "y": coords.get("ny", 0),
                "w": coords.get("nw", 0),
                "h": coords.get("nh", 0),
            },
            "created_at": ann.created_at.isoformat() if ann.created_at else None,
        })

    # Summary stats
    all_anns = await db.execute(
        select(Annotation.defect_class, sqlfunc.count(Annotation.id).label("count"))
        .where(Annotation.image_id.in_(list(image_map.keys())))
        .group_by(Annotation.defect_class)
    )
    class_counts = {r.defect_class: r.count for r in all_anns.fetchall()}

    sev_anns = await db.execute(
        select(Annotation.severity, sqlfunc.count(Annotation.id).label("count"))
        .where(Annotation.image_id.in_(list(image_map.keys())))
        .group_by(Annotation.severity)
    )
    severity_counts = {r.severity: r.count for r in sev_anns.fetchall()}

    return {
        "dataset_id": str(dataset_id),
        "total_defects": total,
        "page": page,
        "per_page": per_page,
        "total_pages": (total + per_page - 1) // per_page,
        "defects": defects,
        "filters": {
            "classes": class_counts,
            "severities": severity_counts,
        },
        "has_next": page * per_page < total,
        "has_prev": page > 1,
    }


# ═══════════════════════════════════════════════════════════════════════════════
# MODEL A/B TESTING
# ═══════════════════════════════════════════════════════════════════════════════

@router.post("/ab-test/create")
async def create_ab_test(
    model_a_id: UUID,
    model_b_id: UUID,
    name: str = "A/B Test",
    split_ratio: float = 0.5,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    """
    Create an A/B test between two models.
    Images are randomly routed: split_ratio to Model A, rest to Model B.
    After enough samples, compare which model performs better.
    """
    from sqlalchemy import text

    # Verify both models exist
    ma = await db.execute(select(MLModel).where(MLModel.id == model_a_id))
    mb = await db.execute(select(MLModel).where(MLModel.id == model_b_id))
    model_a = ma.scalar_one_or_none()
    model_b = mb.scalar_one_or_none()
    if not model_a or not model_b:
        raise HTTPException(404, "One or both models not found")

    # Create ab_tests table if not exists
    await db.execute(text("""
        CREATE TABLE IF NOT EXISTS ab_tests (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            name VARCHAR(255),
            model_a_id UUID NOT NULL,
            model_b_id UUID NOT NULL,
            split_ratio FLOAT DEFAULT 0.5,
            status VARCHAR(20) DEFAULT 'active',
            organization_id UUID,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
    """))
    await db.execute(text("""
        CREATE TABLE IF NOT EXISTS ab_test_results (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            ab_test_id UUID NOT NULL,
            model_id UUID NOT NULL,
            image_filename VARCHAR(512),
            verdict VARCHAR(20),
            detections_count INTEGER DEFAULT 0,
            confidence_avg FLOAT,
            latency_ms FLOAT,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
    """))

    test_id = str(__import__("uuid").uuid4())
    org_id = user.get("organization_id") if user else None
    await db.execute(text("""
        INSERT INTO ab_tests (id, name, model_a_id, model_b_id, split_ratio, organization_id)
        VALUES (:id, :name, :a, :b, :ratio, :org)
    """), {"id": test_id, "name": name, "a": str(model_a_id), "b": str(model_b_id), "ratio": split_ratio, "org": org_id})

    return {
        "id": test_id,
        "name": name,
        "model_a": {"id": str(model_a.id), "name": model_a.name, "map50": model_a.map50},
        "model_b": {"id": str(model_b.id), "name": model_b.name, "map50": model_b.map50},
        "split_ratio": split_ratio,
        "status": "active",
        "message": f"A/B test created — {split_ratio:.0%} to {model_a.name}, {1-split_ratio:.0%} to {model_b.name}",
    }


@router.post("/ab-test/{test_id}/run")
async def run_ab_test_inference(
    test_id: UUID,
    image: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    """
    Run inference through the A/B test.
    Randomly routes to Model A or B based on split ratio.
    Records results for comparison.
    """
    import random
    import base64
    from sqlalchemy import text

    # Get test config
    result = await db.execute(text("SELECT * FROM ab_tests WHERE id = :id"), {"id": str(test_id)})
    test = result.mappings().fetchone()
    if not test:
        raise HTTPException(404, "A/B test not found")

    # Choose model based on split ratio
    use_a = random.random() < test["split_ratio"]
    chosen_model_id = str(test["model_a_id"] if use_a else test["model_b_id"])
    chosen_label = "A" if use_a else "B"

    # Run inference
    image_bytes = await image.read()
    image_b64 = base64.b64encode(image_bytes).decode()

    task = celery_app.send_task(
        "tasks.run_inference",
        args=[chosen_model_id, image_b64, False],
        queue="gpu",
    )
    inf_result = task.get(timeout=120)

    detections = inf_result.get("detections", [])
    avg_conf = sum(d["confidence"] for d in detections) / len(detections) if detections else 0

    # Record result
    await db.execute(text("""
        INSERT INTO ab_test_results (ab_test_id, model_id, image_filename, verdict, detections_count, confidence_avg, latency_ms)
        VALUES (:tid, :mid, :fname, :verdict, :dets, :conf, :lat)
    """), {
        "tid": str(test_id), "mid": chosen_model_id, "fname": image.filename,
        "verdict": inf_result.get("verdict", "ok"), "dets": len(detections),
        "conf": round(avg_conf, 4), "lat": inf_result.get("latency_ms", 0),
    })

    return {
        "ab_test_id": str(test_id),
        "routed_to": f"Model {chosen_label}",
        "model_id": chosen_model_id,
        "verdict": inf_result.get("verdict", "ok"),
        "detections": detections,
        "latency_ms": inf_result.get("latency_ms", 0),
    }


@router.get("/ab-test/{test_id}/results")
async def get_ab_test_results(
    test_id: UUID,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    """
    Get A/B test comparison results.
    Shows per-model stats: total inferences, defect rate, avg confidence,
    avg latency, and a recommendation of which model to promote.
    """
    from sqlalchemy import text

    # Get test info
    test = (await db.execute(text("SELECT * FROM ab_tests WHERE id = :id"), {"id": str(test_id)})).mappings().fetchone()
    if not test:
        raise HTTPException(404, "A/B test not found")

    # Get model names
    ma = await db.execute(select(MLModel).where(MLModel.id == test["model_a_id"]))
    mb = await db.execute(select(MLModel).where(MLModel.id == test["model_b_id"]))
    model_a = ma.scalar_one_or_none()
    model_b = mb.scalar_one_or_none()

    # Aggregate results per model
    stats = {}
    for label, mid in [("A", str(test["model_a_id"])), ("B", str(test["model_b_id"]))]:
        r = await db.execute(text("""
            SELECT COUNT(*) as total,
                   COUNT(*) FILTER (WHERE verdict = 'anomaly') as anomalies,
                   AVG(confidence_avg) as avg_conf,
                   AVG(latency_ms) as avg_lat,
                   AVG(detections_count) as avg_dets
            FROM ab_test_results WHERE ab_test_id = :tid AND model_id = :mid
        """), {"tid": str(test_id), "mid": mid})
        row = r.mappings().fetchone()
        total = row["total"] or 0
        stats[label] = {
            "model_id": mid,
            "model_name": (model_a.name if label == "A" else model_b.name) if (model_a and model_b) else mid,
            "total_inferences": total,
            "anomalies": row["anomalies"] or 0,
            "defect_rate": round((row["anomalies"] or 0) / max(total, 1) * 100, 1),
            "avg_confidence": round(row["avg_conf"] or 0, 3),
            "avg_latency_ms": round(row["avg_lat"] or 0, 1),
            "avg_detections": round(row["avg_dets"] or 0, 2),
        }

    # Recommendation
    total_samples = stats["A"]["total_inferences"] + stats["B"]["total_inferences"]
    recommendation = "Need more data (minimum 50 samples per model)" if total_samples < 100 else None
    if total_samples >= 100:
        score_a = stats["A"]["avg_confidence"] * 100 - stats["A"]["avg_latency_ms"] * 0.01
        score_b = stats["B"]["avg_confidence"] * 100 - stats["B"]["avg_latency_ms"] * 0.01
        winner = "A" if score_a > score_b else "B"
        recommendation = f"Model {winner} ({stats[winner]['model_name']}) performs better — promote to production"

    return {
        "ab_test_id": str(test_id),
        "name": test["name"],
        "status": test["status"],
        "total_inferences": total_samples,
        "model_a": stats["A"],
        "model_b": stats["B"],
        "recommendation": recommendation,
    }


@router.get("/ab-test")
async def list_ab_tests(
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    """List all A/B tests."""
    from sqlalchemy import text
    try:
        result = await db.execute(text("SELECT id, name, model_a_id, model_b_id, split_ratio, status, created_at FROM ab_tests ORDER BY created_at DESC"))
        return [dict(r) for r in result.mappings().fetchall()]
    except Exception:
        return []


# ═══════════════════════════════════════════════════════════════════════════════
# BATCH INFERENCE
# ═══════════════════════════════════════════════════════════════════════════════

@router.post("/inference/batch")
async def batch_inference(
    model_id: UUID,
    images: list[UploadFile] = File(...),
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    """
    Batch inference — upload multiple images at once.
    Returns results for all images with summary statistics.
    Useful for end-of-shift batch inspection of 50-500 parts.
    """
    import base64

    if len(images) > 100:
        raise HTTPException(400, "Maximum 100 images per batch")

    # Verify model exists
    m = await db.execute(select(MLModel).where(MLModel.id == model_id))
    model = m.scalar_one_or_none()
    if not model:
        raise HTTPException(404, "Model not found")

    results = []
    total_ok = 0
    total_anomaly = 0
    total_latency = 0

    for img in images:
        try:
            img_bytes = await img.read()
            img_b64 = base64.b64encode(img_bytes).decode()

            task = celery_app.send_task(
                "tasks.run_inference",
                args=[str(model_id), img_b64, False],
                queue="gpu",
            )
            inf_result = task.get(timeout=120)

            verdict = inf_result.get("verdict", "ok")
            latency = inf_result.get("latency_ms", 0)
            detections = inf_result.get("detections", [])

            if verdict == "ok":
                total_ok += 1
            else:
                total_anomaly += 1
            total_latency += latency

            results.append({
                "filename": img.filename,
                "verdict": verdict,
                "detections": len(detections),
                "details": detections,
                "latency_ms": round(latency, 1),
            })

            # Log to database
            log = InferenceLog(
                model_id=model_id,
                input_image_path=img.filename,
                detections=detections,
                verdict=verdict,
                latency_ms=latency,
            )
            if user and user.get("id"):
                log.user_id = user["id"]
            if user and user.get("organization_id"):
                log.organization_id = user["organization_id"]
            db.add(log)

        except Exception as e:
            results.append({
                "filename": img.filename,
                "verdict": "error",
                "detections": 0,
                "details": [],
                "latency_ms": 0,
                "error": str(e),
            })

    await db.flush()

    total = len(results)
    errors = len([r for r in results if r["verdict"] == "error"])

    return {
        "model": {"id": str(model.id), "name": model.name},
        "batch_size": total,
        "summary": {
            "ok": total_ok,
            "anomaly": total_anomaly,
            "errors": errors,
            "pass_rate": round(total_ok / max(total - errors, 1) * 100, 1),
            "defect_rate": round(total_anomaly / max(total - errors, 1) * 100, 1),
            "avg_latency_ms": round(total_latency / max(total, 1), 1),
            "total_defects_found": sum(r["detections"] for r in results),
        },
        "results": results,
    }


@router.post("/inference/batch-dataset/{dataset_id}")
async def batch_inference_dataset(
    dataset_id: UUID,
    model_id: UUID,
    limit: int = 50,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    """
    Run batch inference on images from an existing dataset.
    No upload needed — uses images already in MinIO.
    Great for validating a model on the full test set.
    """
    import base64

    # Get images
    imgs = await db.execute(
        select(Image).where(Image.dataset_id == dataset_id).order_by(Image.uploaded_at).limit(limit)
    )
    images = imgs.scalars().all()
    if not images:
        raise HTTPException(404, "No images in dataset")

    # Get model
    m = await db.execute(select(MLModel).where(MLModel.id == model_id))
    model = m.scalar_one_or_none()
    if not model:
        raise HTTPException(404, "Model not found")

    from app.core.storage import get_s3_client
    s3 = get_s3_client()
    bucket = settings.minio_bucket_images

    results = []
    total_ok = 0
    total_anomaly = 0
    total_latency = 0

    for img in images:
        try:
            # Download from MinIO
            response = s3.get_object(Bucket=bucket, Key=img.storage_path)
            img_bytes = response["Body"].read()
            img_b64 = base64.b64encode(img_bytes).decode()

            task = celery_app.send_task(
                "tasks.run_inference",
                args=[str(model_id), img_b64, False],
                queue="gpu",
            )
            inf_result = task.get(timeout=120)

            verdict = inf_result.get("verdict", "ok")
            latency = inf_result.get("latency_ms", 0)
            detections = inf_result.get("detections", [])

            if verdict == "ok":
                total_ok += 1
            else:
                total_anomaly += 1
            total_latency += latency

            results.append({
                "filename": img.filename,
                "image_id": str(img.id),
                "verdict": verdict,
                "detections": len(detections),
                "details": detections,
                "latency_ms": round(latency, 1),
            })

        except Exception as e:
            results.append({
                "filename": img.filename,
                "image_id": str(img.id),
                "verdict": "error",
                "error": str(e),
            })

    total = len(results)
    errors = len([r for r in results if r["verdict"] == "error"])

    return {
        "model": {"id": str(model.id), "name": model.name},
        "dataset": dataset_id,
        "batch_size": total,
        "summary": {
            "ok": total_ok,
            "anomaly": total_anomaly,
            "errors": errors,
            "pass_rate": round(total_ok / max(total - errors, 1) * 100, 1),
            "defect_rate": round(total_anomaly / max(total - errors, 1) * 100, 1),
            "avg_latency_ms": round(total_latency / max(total, 1), 1),
        },
        "results": results,
    }


# ═══════════════════════════════════════════════════════════════════════════════
# REAL-TIME WEBSOCKET DASHBOARD
# ═══════════════════════════════════════════════════════════════════════════════

@router.websocket("/ws/factory-monitor")
async def factory_monitor_ws(websocket: WebSocket):
    """
    Real-time factory monitoring via WebSocket.
    Pushes live updates: part inspected, defect detected, hourly stats.
    Connect from a factory TV screen or monitoring dashboard.
    """
    await websocket.accept()
    import asyncio
    import json
    from datetime import datetime, timedelta
    from sqlalchemy import text, func as sqlfunc, and_

    try:
        while True:
            # Get live stats
            from app.core.database import engine
            async with engine.connect() as conn:
                now = datetime.utcnow()
                today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
                hour_ago = now - timedelta(hours=1)

                # Today totals
                today = await conn.execute(text(
                    "SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE verdict='anomaly') as defects, "
                    "AVG(latency_ms) as avg_lat FROM inference_logs WHERE created_at >= :ts"
                ), {"ts": today_start})
                row = today.mappings().fetchone()

                # Last hour
                hour = await conn.execute(text(
                    "SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE verdict='anomaly') as defects "
                    "FROM inference_logs WHERE created_at >= :ts"
                ), {"ts": hour_ago})
                hour_row = hour.mappings().fetchone()

                # Last 5 inferences
                recent = await conn.execute(text(
                    "SELECT verdict, latency_ms, created_at FROM inference_logs "
                    "ORDER BY created_at DESC LIMIT 5"
                ))
                recent_list = [
                    {"verdict": r["verdict"], "latency": round(r["latency_ms"] or 0, 1),
                     "time": r["created_at"].strftime("%H:%M:%S") if r["created_at"] else ""}
                    for r in recent.mappings().fetchall()
                ]

                # Hourly trend (last 12 hours)
                hourly = []
                for i in range(12):
                    h_start = now - timedelta(hours=11-i)
                    h_end = h_start + timedelta(hours=1)
                    h_start = h_start.replace(minute=0, second=0, microsecond=0)
                    h_end = h_end.replace(minute=0, second=0, microsecond=0)
                    hr = await conn.execute(text(
                        "SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE verdict='anomaly') as defects "
                        "FROM inference_logs WHERE created_at >= :s AND created_at < :e"
                    ), {"s": h_start, "e": h_end})
                    hr_row = hr.mappings().fetchone()
                    hourly.append({
                        "hour": h_start.strftime("%H:00"),
                        "inspections": hr_row["total"] or 0,
                        "defects": hr_row["defects"] or 0,
                    })

            t_total = row["total"] or 0
            t_defects = row["defects"] or 0

            payload = {
                "type": "factory_update",
                "timestamp": now.isoformat(),
                "today": {
                    "inspections": t_total,
                    "defects": t_defects,
                    "pass_rate": round((1 - t_defects / max(t_total, 1)) * 100, 1),
                    "avg_latency_ms": round(row["avg_lat"] or 0, 1),
                },
                "last_hour": {
                    "inspections": hour_row["total"] or 0,
                    "defects": hour_row["defects"] or 0,
                },
                "recent": recent_list,
                "hourly_trend": hourly,
            }

            await websocket.send_json(payload)
            await asyncio.sleep(3)

    except Exception:
        pass


# ═══════════════════════════════════════════════════════════════════════════════
# IMAGE SEGMENTATION — Pixel-level defect masks
# ═══════════════════════════════════════════════════════════════════════════════

@router.post("/segment/{image_id}")
async def segment_defects(
    image_id: UUID,
    model_id: Optional[UUID] = None,
    threshold: float = 0.5,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    """
    Pixel-level defect segmentation.
    Uses edge detection + thresholding for anomaly regions,
    then refines with morphological operations.
    Returns a binary mask and contour polygons.
    More precise than bounding boxes for irregular defects.
    """
    import numpy as np
    import cv2
    import base64
    from io import BytesIO

    # Get image from MinIO
    result = await db.execute(select(Image).where(Image.id == image_id))
    image_obj = result.scalar_one_or_none()
    if not image_obj:
        raise HTTPException(404, "Image not found")

    from app.core.storage import get_s3_client
    s3 = get_s3_client()
    response = s3.get_object(Bucket=settings.minio_bucket_images, Key=image_obj.storage_path)
    img_bytes = response["Body"].read()

    img = cv2.imdecode(np.frombuffer(img_bytes, np.uint8), cv2.IMREAD_COLOR)
    h, w = img.shape[:2]
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    # Multi-scale anomaly detection
    # 1. Adaptive thresholding for local anomalies
    adaptive = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 21, 10)

    # 2. Edge detection for structural defects
    edges = cv2.Canny(gray, 50, 150)
    edges_dilated = cv2.dilate(edges, np.ones((3, 3), np.uint8), iterations=2)

    # 3. Texture analysis — local standard deviation
    blur = cv2.GaussianBlur(gray.astype(np.float32), (15, 15), 0)
    blur_sq = cv2.GaussianBlur((gray.astype(np.float32))**2, (15, 15), 0)
    local_std = np.sqrt(np.maximum(blur_sq - blur**2, 0))
    std_norm = ((local_std / (local_std.max() + 1e-8)) * 255).astype(np.uint8)
    _, texture_mask = cv2.threshold(std_norm, int(threshold * 100), 255, cv2.THRESH_BINARY)

    # Combine masks
    combined = cv2.bitwise_or(adaptive, edges_dilated)
    combined = cv2.bitwise_or(combined, texture_mask)

    # Morphological cleanup
    kernel = np.ones((5, 5), np.uint8)
    combined = cv2.morphologyEx(combined, cv2.MORPH_CLOSE, kernel, iterations=2)
    combined = cv2.morphologyEx(combined, cv2.MORPH_OPEN, kernel, iterations=1)

    # Find contours (defect regions)
    contours, _ = cv2.findContours(combined, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    # Filter by area
    min_area = (w * h) * 0.001  # Minimum 0.1% of image
    defect_regions = []
    mask_overlay = img.copy()

    for i, contour in enumerate(contours):
        area = cv2.contourArea(contour)
        if area < min_area:
            continue

        # Draw filled contour on overlay
        color = (0, 0, 255) if area > (w * h * 0.01) else (0, 165, 255)  # Red for large, orange for small
        cv2.drawContours(mask_overlay, [contour], -1, color, -1)

        # Get contour polygon (simplified)
        epsilon = 0.02 * cv2.arcLength(contour, True)
        approx = cv2.approxPolyDP(contour, epsilon, True)
        polygon = [[int(p[0][0]), int(p[0][1])] for p in approx]

        x, y, cw, ch = cv2.boundingRect(contour)
        defect_regions.append({
            "id": len(defect_regions) + 1,
            "bbox": [int(x), int(y), int(x + cw), int(y + ch)],
            "polygon": polygon,
            "area_pixels": int(area),
            "area_percent": round(area / (w * h) * 100, 2),
            "perimeter": round(cv2.arcLength(contour, True), 1),
            "circularity": round(4 * 3.14159 * area / (cv2.arcLength(contour, True)**2 + 1e-8), 3),
            "severity": "high" if area > (w * h * 0.01) else "medium" if area > (w * h * 0.005) else "low",
        })

    # Create overlay image (50% transparent)
    overlay = cv2.addWeighted(img, 0.6, mask_overlay, 0.4, 0)

    # Draw contour outlines
    for contour in contours:
        if cv2.contourArea(contour) >= min_area:
            cv2.drawContours(overlay, [contour], -1, (0, 255, 255), 2)

    # Encode images
    _, mask_buf = cv2.imencode(".png", combined)
    mask_b64 = base64.b64encode(mask_buf).decode()

    _, overlay_buf = cv2.imencode(".png", overlay)
    overlay_b64 = base64.b64encode(overlay_buf).decode()

    # Save overlay to MinIO
    from datetime import datetime
    seg_key = f"segmentation/{image_id}/{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.png"
    from app.core.storage import generate_presigned_url
    s3.put_object(Bucket="exports", Key=seg_key, Body=overlay_buf.tobytes(), ContentType="image/png")
    overlay_url = generate_presigned_url("exports", seg_key)

    total_defect_area = sum(r["area_pixels"] for r in defect_regions)
    defect_coverage = round(total_defect_area / (w * h) * 100, 2)

    return {
        "image_id": str(image_id),
        "image_size": {"width": w, "height": h},
        "defect_regions": defect_regions,
        "total_regions": len(defect_regions),
        "defect_coverage_percent": defect_coverage,
        "mask_b64": mask_b64,
        "overlay_b64": overlay_b64,
        "overlay_url": overlay_url,
        "threshold": threshold,
        "verdict": "DEFECTIVE" if defect_regions else "OK",
        "severity_summary": {
            "high": len([r for r in defect_regions if r["severity"] == "high"]),
            "medium": len([r for r in defect_regions if r["severity"] == "medium"]),
            "low": len([r for r in defect_regions if r["severity"] == "low"]),
        },
    }


# ═══════════════════════════════════════════════════════════════════════════════
# AUDIT LOG — Track every action
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/audit-log")
async def get_audit_log(
    action: Optional[str] = None,
    user_email: Optional[str] = None,
    days: int = 7,
    page: int = 1,
    per_page: int = 50,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    """
    View the audit log — every action tracked with who, what, when.
    Required for ISO 9001 compliance and security audits.
    Filterable by action type, user, and time range.
    """
    from sqlalchemy import text, and_
    from datetime import datetime, timedelta

    # Create audit_logs table if not exists
    await db.execute(text("""
        CREATE TABLE IF NOT EXISTS audit_logs (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            user_id UUID,
            user_email VARCHAR(255),
            user_role VARCHAR(50),
            organization_id UUID,
            action VARCHAR(100) NOT NULL,
            resource_type VARCHAR(100),
            resource_id VARCHAR(255),
            details JSONB DEFAULT '{}',
            ip_address VARCHAR(50),
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
    """))
    await db.execute(text("""
        CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC)
    """))

    since = datetime.utcnow() - timedelta(days=days)
    org_id = user.get("organization_id") if user else None

    # Build query
    where_clauses = ["created_at >= :since"]
    params = {"since": since}

    if org_id:
        where_clauses.append("organization_id = :org")
        params["org"] = str(org_id)
    if action:
        where_clauses.append("action = :action")
        params["action"] = action
    if user_email:
        where_clauses.append("user_email LIKE :email")
        params["email"] = f"%{user_email}%"

    where_sql = " AND ".join(where_clauses)

    # Count
    count_result = await db.execute(text(f"SELECT COUNT(*) FROM audit_logs WHERE {where_sql}"), params)
    total = count_result.scalar() or 0

    # Fetch page
    offset = (page - 1) * per_page
    result = await db.execute(text(
        f"SELECT * FROM audit_logs WHERE {where_sql} ORDER BY created_at DESC LIMIT :lim OFFSET :off"
    ), {**params, "lim": per_page, "off": offset})
    logs = [dict(r) for r in result.mappings().fetchall()]

    # Summary
    summary_result = await db.execute(text(
        f"SELECT action, COUNT(*) as count FROM audit_logs WHERE {where_sql} GROUP BY action ORDER BY count DESC"
    ), params)
    action_summary = {r["action"]: r["count"] for r in summary_result.mappings().fetchall()}

    return {
        "total": total,
        "page": page,
        "per_page": per_page,
        "total_pages": (total + per_page - 1) // per_page,
        "filters": {"action": action, "user_email": user_email, "days": days},
        "action_summary": action_summary,
        "logs": logs,
    }


@router.post("/audit-log")
async def create_audit_entry(
    action: str,
    resource_type: str = "",
    resource_id: str = "",
    details: dict = {},
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    """
    Manually create an audit log entry.
    Most entries are created automatically by the system.
    """
    from sqlalchemy import text

    await db.execute(text("""
        CREATE TABLE IF NOT EXISTS audit_logs (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            user_id UUID, user_email VARCHAR(255), user_role VARCHAR(50),
            organization_id UUID, action VARCHAR(100) NOT NULL,
            resource_type VARCHAR(100), resource_id VARCHAR(255),
            details JSONB DEFAULT '{}', ip_address VARCHAR(50),
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
    """))

    entry_id = str(__import__("uuid").uuid4())
    await db.execute(text("""
        INSERT INTO audit_logs (id, user_id, user_email, user_role, organization_id, action, resource_type, resource_id, details)
        VALUES (:id, :uid, :email, :role, :org, :action, :rtype, :rid, :details)
    """), {
        "id": entry_id,
        "uid": user.get("id") if user else None,
        "email": user.get("email") if user else "system",
        "role": user.get("role") if user else "system",
        "org": user.get("organization_id") if user else None,
        "action": action,
        "rtype": resource_type,
        "rid": resource_id,
        "details": json.dumps(details),
    })

    return {"id": entry_id, "action": action, "message": "Audit entry created"}


@router.get("/audit-log/actions")
async def list_audit_actions(
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    """List all unique action types in the audit log."""
    from sqlalchemy import text
    try:
        result = await db.execute(text(
            "SELECT DISTINCT action, COUNT(*) as count FROM audit_logs GROUP BY action ORDER BY count DESC"
        ))
        return [{"action": r["action"], "count": r["count"]} for r in result.mappings().fetchall()]
    except Exception:
        return []


# ═══════════════════════════════════════════════════════════════════════════════
# ROLE-BASED UI — Different views per role
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/ui/config")
async def get_ui_config(
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    """
    Returns UI configuration based on user role.
    Operator: simple pass/fail screen, inference only
    Engineer: full tools — annotation, training, testing, deployment
    Manager/Admin: dashboards, reports, user management, audit log
    Client: read-only viewer, testing, reports

    The frontend uses this to show/hide menu items and features.
    """
    role = user.get("role", "client") if user else "client"

    # Define permissions per role
    role_configs = {
        "admin": {
            "role": "admin",
            "label": "Administrateur",
            "nav": ["home", "viewer", "analysis", "training", "testing", "deployment"],
            "features": {
                "can_annotate": True,
                "can_train": True,
                "can_deploy": True,
                "can_manage_users": True,
                "can_manage_org": True,
                "can_view_audit": True,
                "can_export": True,
                "can_configure_webhooks": True,
                "can_ab_test": True,
                "can_retrain": True,
                "can_delete": True,
                "can_batch_inference": True,
                "can_segment": True,
            },
            "dashboard_widgets": ["kpis", "defect_rate", "model_performance", "hourly_trend", "audit_recent", "user_activity"],
            "default_page": "/",
        },
        "engineer": {
            "role": "engineer",
            "label": "Ingénieur Qualité",
            "nav": ["home", "viewer", "analysis", "training", "testing", "deployment"],
            "features": {
                "can_annotate": True,
                "can_train": True,
                "can_deploy": True,
                "can_manage_users": False,
                "can_manage_org": False,
                "can_view_audit": True,
                "can_export": True,
                "can_configure_webhooks": True,
                "can_ab_test": True,
                "can_retrain": True,
                "can_delete": False,
                "can_batch_inference": True,
                "can_segment": True,
            },
            "dashboard_widgets": ["kpis", "defect_rate", "model_performance", "hourly_trend"],
            "default_page": "/viewer",
        },
        "operator": {
            "role": "operator",
            "label": "Opérateur",
            "nav": ["home", "testing"],
            "features": {
                "can_annotate": False,
                "can_train": False,
                "can_deploy": False,
                "can_manage_users": False,
                "can_manage_org": False,
                "can_view_audit": False,
                "can_export": False,
                "can_configure_webhooks": False,
                "can_ab_test": False,
                "can_retrain": False,
                "can_delete": False,
                "can_batch_inference": True,
                "can_segment": False,
            },
            "dashboard_widgets": ["pass_fail_big", "defect_count_today"],
            "default_page": "/testing",
            "simplified_ui": True,
        },
        "client": {
            "role": "client",
            "label": "Client",
            "nav": ["home", "viewer", "testing", "deployment"],
            "features": {
                "can_annotate": True,
                "can_train": False,
                "can_deploy": False,
                "can_manage_users": False,
                "can_manage_org": False,
                "can_view_audit": False,
                "can_export": True,
                "can_configure_webhooks": False,
                "can_ab_test": False,
                "can_retrain": False,
                "can_delete": False,
                "can_batch_inference": True,
                "can_segment": True,
            },
            "dashboard_widgets": ["kpis", "defect_rate"],
            "default_page": "/viewer",
        },
    }

    config = role_configs.get(role, role_configs["client"])

    # Add org info
    org = None
    if user and user.get("organization_id"):
        from sqlalchemy import text
        org_result = await db.execute(
            text("SELECT name, plan, max_images, max_models, max_users FROM organizations WHERE id = :id"),
            {"id": str(user["organization_id"])}
        )
        org_row = org_result.mappings().fetchone()
        if org_row:
            org = dict(org_row)

    return {
        "user": {
            "email": user.get("email") if user else None,
            "full_name": user.get("full_name") if user else None,
            "role": role,
        },
        "organization": org,
        "ui": config,
    }


# ═══════════════════════════════════════════════════════════════════════════════
# REAL ONNX EXPORT — Convert YOLOv8 to ONNX for edge deployment
# ═══════════════════════════════════════════════════════════════════════════════

@router.post("/models/{model_id}/export-onnx")
async def export_model_onnx(
    model_id: UUID,
    imgsz: int = 640,
    simplify: bool = True,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    """
    Export a trained YOLOv8 model to ONNX format.
    ONNX runs on any device: NVIDIA Jetson, Intel NCS, mobile, browser.
    10-50x faster inference than PyTorch on edge hardware.

    Returns: download URL for the .onnx file.
    """
    # Get model info
    m = await db.execute(select(MLModel).where(MLModel.id == model_id))
    model = m.scalar_one_or_none()
    if not model:
        raise HTTPException(404, "Model not found")

    # Dispatch export to GPU worker
    task = celery_app.send_task(
        "tasks.export_onnx",
        args=[str(model_id), str(model.weights_path), model.architecture, imgsz, simplify],
        queue="gpu",
    )

    try:
        result = task.get(timeout=300)
        return {
            "model_id": str(model_id),
            "model_name": model.name,
            "format": "onnx",
            "imgsz": imgsz,
            "simplified": simplify,
            "onnx_path": result.get("onnx_path", ""),
            "onnx_url": result.get("onnx_url", ""),
            "file_size_mb": result.get("file_size_mb", 0),
            "message": f"Model exported to ONNX — ready for edge deployment",
        }
    except Exception as e:
        raise HTTPException(500, f"ONNX export failed: {str(e)}")


@router.get("/models/{model_id}/export-formats")
async def list_export_formats(
    model_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """List available export formats for a model."""
    m = await db.execute(select(MLModel).where(MLModel.id == model_id))
    model = m.scalar_one_or_none()
    if not model:
        raise HTTPException(404, "Model not found")

    return {
        "model_id": str(model_id),
        "model_name": model.name,
        "formats": [
            {"format": "onnx", "description": "Universal — runs on any device", "endpoint": f"/api/v1/models/{model_id}/export-onnx"},
            {"format": "torchscript", "description": "PyTorch optimized — fast on GPU servers", "status": "available"},
            {"format": "tflite", "description": "TensorFlow Lite — mobile and microcontrollers", "status": "coming_soon"},
            {"format": "tensorrt", "description": "NVIDIA TensorRT — fastest on NVIDIA GPUs", "status": "coming_soon"},
            {"format": "openvino", "description": "Intel OpenVINO — optimized for Intel hardware", "status": "coming_soon"},
        ],
    }


# ═══════════════════════════════════════════════════════════════════════════════
# VIDEO STREAM INFERENCE — Real-time video processing
# ═══════════════════════════════════════════════════════════════════════════════

@router.post("/inference/video")
async def inference_video(
    model_id: UUID,
    video: UploadFile = File(...),
    fps_sample: int = 1,
    confidence: float = 0.25,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    """
    Run inference on a video file.
    Samples frames at specified FPS, runs YOLOv8 on each frame.
    Returns per-frame results + summary statistics.

    fps_sample=1 means analyze 1 frame per second.
    fps_sample=5 means analyze 5 frames per second (slower but more thorough).
    """
    import base64

    if not video.filename.lower().endswith(('.mp4', '.avi', '.mov', '.mkv', '.webm')):
        raise HTTPException(400, "Supported formats: mp4, avi, mov, mkv, webm")

    # Save video to temp file
    video_bytes = await video.read()
    if len(video_bytes) > 100 * 1024 * 1024:
        raise HTTPException(400, "Video too large (max 100MB)")

    # Dispatch to GPU worker
    video_b64 = base64.b64encode(video_bytes).decode()

    task = celery_app.send_task(
        "tasks.inference_video",
        args=[str(model_id), video_b64, fps_sample, confidence],
        queue="gpu",
    )

    try:
        result = task.get(timeout=600)
        return result
    except Exception as e:
        raise HTTPException(500, f"Video inference failed: {str(e)}")


@router.post("/inference/video-url")
async def inference_video_url(
    model_id: UUID,
    video_url: str = "",
    fps_sample: int = 1,
    confidence: float = 0.25,
    max_frames: int = 100,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    """
    Run inference on a video from URL or RTSP stream.
    Supports: RTSP cameras, HTTP video URLs, local file paths.

    Example RTSP: rtsp://camera_ip:554/stream
    Example HTTP: https://example.com/video.mp4
    """
    task = celery_app.send_task(
        "tasks.inference_video_stream",
        args=[str(model_id), video_url, fps_sample, confidence, max_frames],
        queue="gpu",
    )

    try:
        result = task.get(timeout=600)
        return result
    except Exception as e:
        raise HTTPException(500, f"Video stream inference failed: {str(e)}")


# ═══════════════════════════════════════════════════════════════════════════════
# EMAIL NOTIFICATIONS
# ═══════════════════════════════════════════════════════════════════════════════

@router.post("/notifications/email/config")
async def configure_email(
    smtp_host: str = "smtp.gmail.com",
    smtp_port: int = 587,
    smtp_user: str = "",
    smtp_password: str = "",
    from_email: str = "",
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    """
    Configure SMTP settings for email notifications.
    Supports Gmail, Outlook, SendGrid, or any SMTP server.
    """
    from sqlalchemy import text
    org_id = user.get("organization_id") if user else None

    await db.execute(text("""
        CREATE TABLE IF NOT EXISTS email_config (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            organization_id UUID,
            smtp_host VARCHAR(255) NOT NULL,
            smtp_port INTEGER DEFAULT 587,
            smtp_user VARCHAR(255),
            smtp_password VARCHAR(255),
            from_email VARCHAR(255),
            is_active BOOLEAN DEFAULT true,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
    """))

    # Upsert config
    await db.execute(text("DELETE FROM email_config WHERE organization_id = :org"), {"org": org_id})
    await db.execute(text("""
        INSERT INTO email_config (organization_id, smtp_host, smtp_port, smtp_user, smtp_password, from_email)
        VALUES (:org, :host, :port, :user, :pwd, :from_email)
    """), {"org": org_id, "host": smtp_host, "port": smtp_port, "user": smtp_user, "pwd": smtp_password, "from_email": from_email})

    return {"message": "Email configuration saved", "smtp_host": smtp_host, "from_email": from_email}


@router.post("/notifications/email/send")
async def send_email_notification(
    to: str,
    subject: str = "VISTA — Inspection Report",
    body: str = "",
    include_daily_report: bool = False,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    """
    Send an email notification.
    Can include the daily inspection report automatically.
    """
    import smtplib
    from email.mime.text import MIMEText
    from email.mime.multipart import MIMEMultipart
    from sqlalchemy import text
    from datetime import datetime, timedelta

    org_id = user.get("organization_id") if user else None

    # Get SMTP config
    try:
        config_result = await db.execute(text(
            "SELECT * FROM email_config WHERE organization_id = :org AND is_active = true LIMIT 1"
        ), {"org": org_id})
        config = config_result.mappings().fetchone()
    except Exception:
        config = None

    # Build email body
    if include_daily_report:
        from sqlalchemy import func as sqlfunc, and_
        now = datetime.utcnow()
        today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)

        total_r = await db.execute(text(
            "SELECT COUNT(*) FROM inference_logs WHERE created_at >= :ts"
        ), {"ts": today_start})
        total = total_r.scalar() or 0

        defects_r = await db.execute(text(
            "SELECT COUNT(*) FROM inference_logs WHERE created_at >= :ts AND verdict = 'anomaly'"
        ), {"ts": today_start})
        defects = defects_r.scalar() or 0

        lat_r = await db.execute(text(
            "SELECT AVG(latency_ms) FROM inference_logs WHERE created_at >= :ts"
        ), {"ts": today_start})
        avg_lat = round(lat_r.scalar() or 0, 1)

        body = f"""
VISTA — Daily Inspection Report
================================
Date: {now.strftime('%Y-%m-%d %H:%M UTC')}
Organization: {user.get('full_name', 'N/A')}

Today's Summary:
  Parts inspected: {total}
  Defects detected: {defects}
  Pass rate: {round((1 - defects / max(total, 1)) * 100, 1)}%
  Defect rate: {round(defects / max(total, 1) * 100, 1)}%
  Average latency: {avg_lat} ms

{'⚠️ ALERT: Defect rate exceeds 10%!' if defects / max(total, 1) > 0.1 else '✅ All metrics within normal range.'}

---
This report was generated automatically by VISTA.
"""

    # Try to send email
    if config:
        try:
            msg = MIMEMultipart()
            msg["From"] = config["from_email"] or config["smtp_user"]
            msg["To"] = to
            msg["Subject"] = subject
            msg.attach(MIMEText(body, "plain"))

            with smtplib.SMTP(config["smtp_host"], config["smtp_port"]) as server:
                server.starttls()
                server.login(config["smtp_user"], config["smtp_password"])
                server.send_message(msg)

            return {
                "status": "sent",
                "to": to,
                "subject": subject,
                "message": "Email sent successfully",
            }
        except Exception as e:
            return {
                "status": "failed",
                "to": to,
                "subject": subject,
                "error": str(e),
                "body_preview": body[:200],
                "message": "Email sending failed — check SMTP configuration",
            }
    else:
        return {
            "status": "no_config",
            "to": to,
            "subject": subject,
            "body_preview": body[:500] if body else "No body",
            "message": "No SMTP configured — email content generated but not sent. Configure SMTP at /notifications/email/config",
        }


@router.post("/notifications/email/test")
async def test_email(
    to: str,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    """Send a test email to verify SMTP configuration."""
    return await send_email_notification(
        to=to,
        subject="VISTA — Test Email",
        body=f"This is a test email from VISTA.\n\nIf you received this, email notifications are working correctly.\n\nSent by: {user.get('full_name', 'System')}",
        db=db,
        user=user,
    )


@router.get("/notifications/email/preview-daily")
async def preview_daily_report(
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    """Preview the daily report email without sending."""
    return await send_email_notification(
        to="preview@example.com",
        subject="VISTA — Daily Report Preview",
        include_daily_report=True,
        db=db,
        user=user,
    )


# ═══════════════════════════════════════════════════════════════════════════════
# PROMETHEUS METRICS
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/metrics")
async def prometheus_metrics(
    db: AsyncSession = Depends(get_db),
):
    """
    Prometheus-compatible metrics endpoint.
    Scraped by Prometheus every 15 seconds.
    Visualized in Grafana dashboards.
    """
    from fastapi.responses import PlainTextResponse
    from sqlalchemy import text, func as sqlfunc
    from datetime import datetime, timedelta

    now = datetime.utcnow()
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    hour_ago = now - timedelta(hours=1)

    # Collect metrics
    metrics = []

    # Total inferences today
    total_r = await db.execute(text("SELECT COUNT(*) FROM inference_logs WHERE created_at >= :ts"), {"ts": today})
    total = total_r.scalar() or 0
    metrics.append(f'vista_inferences_today_total {total}')

    # Defects today
    def_r = await db.execute(text("SELECT COUNT(*) FROM inference_logs WHERE created_at >= :ts AND verdict = 'anomaly'"), {"ts": today})
    defects = def_r.scalar() or 0
    metrics.append(f'vista_defects_today_total {defects}')

    # Defect rate
    defect_rate = round(defects / max(total, 1) * 100, 2)
    metrics.append(f'vista_defect_rate_percent {defect_rate}')

    # Average latency
    lat_r = await db.execute(text("SELECT AVG(latency_ms) FROM inference_logs WHERE created_at >= :ts"), {"ts": hour_ago})
    avg_lat = round(lat_r.scalar() or 0, 2)
    metrics.append(f'vista_inference_latency_avg_ms {avg_lat}')

    # Total models
    model_r = await db.execute(text("SELECT COUNT(*) FROM ml_models"))
    metrics.append(f'vista_models_total {model_r.scalar() or 0}')

    # Total datasets
    ds_r = await db.execute(text("SELECT COUNT(*) FROM datasets"))
    metrics.append(f'vista_datasets_total {ds_r.scalar() or 0}')

    # Total images
    img_r = await db.execute(text("SELECT COUNT(*) FROM images"))
    metrics.append(f'vista_images_total {img_r.scalar() or 0}')

    # Total annotations
    ann_r = await db.execute(text("SELECT COUNT(*) FROM annotations"))
    metrics.append(f'vista_annotations_total {ann_r.scalar() or 0}')

    # Total users
    usr_r = await db.execute(text("SELECT COUNT(*) FROM users"))
    metrics.append(f'vista_users_total {usr_r.scalar() or 0}')

    # Total organizations
    org_r = await db.execute(text("SELECT COUNT(*) FROM organizations"))
    metrics.append(f'vista_organizations_total {org_r.scalar() or 0}')

    # Training jobs by status
    for status in ["queued", "running", "completed", "failed"]:
        job_r = await db.execute(text("SELECT COUNT(*) FROM training_jobs WHERE status = :s"), {"s": status})
        metrics.append(f'vista_training_jobs{{status="{status}"}} {job_r.scalar() or 0}')

    # Last hour inferences
    hour_r = await db.execute(text("SELECT COUNT(*) FROM inference_logs WHERE created_at >= :ts"), {"ts": hour_ago})
    metrics.append(f'vista_inferences_last_hour {hour_r.scalar() or 0}')

    # System info
    metrics.append(f'vista_info{{version="12.0"}} 1')

    output = "# VISTA Prometheus Metrics\n" + "\n".join(metrics) + "\n"
    return PlainTextResponse(output, media_type="text/plain")
