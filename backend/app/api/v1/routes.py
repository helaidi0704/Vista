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


# ═══════════════════════════════════════════════════════════════════════════════
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
