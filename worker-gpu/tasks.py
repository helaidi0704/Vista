"""
VISTA — GPU Worker Tasks (Celery)
Handles: model training, inference, Grad-CAM, model export.
Each task runs on the 'gpu' queue with concurrency=1.
"""
import os
import json
import time
import logging
import base64
from io import BytesIO

from celery import Celery
import redis
import boto3
from botocore.config import Config as BotoConfig

logger = logging.getLogger(__name__)

# ─── Celery App ───────────────────────────────────────────────────────────────
app = Celery(
    "tasks",
    broker=os.environ.get("CELERY_BROKER_URL", "redis://redis:6379/0"),
    backend=os.environ.get("CELERY_RESULT_BACKEND", "redis://redis:6379/1"),
)
app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
)

# ─── Helpers ──────────────────────────────────────────────────────────────────

def get_redis():
    return redis.from_url(os.environ.get("REDIS_URL", "redis://redis:6379/0"))


def get_s3():
    return boto3.client(
        "s3",
        endpoint_url=f"http://{os.environ.get('MINIO_ENDPOINT', 'minio:9000')}",
        aws_access_key_id=os.environ.get("MINIO_ACCESS_KEY", "vistaadmin"),
        aws_secret_access_key=os.environ.get("MINIO_SECRET_KEY", "vistaSecretKey2024"),
        config=BotoConfig(signature_version="s3v4"),
        region_name="us-east-1",
    )


def get_db_connection():
    """Sync DB connection for workers (not async)."""
    import sqlalchemy
    url = (
        f"postgresql://{os.environ.get('POSTGRES_USER', 'vista')}"
        f":{os.environ.get('POSTGRES_PASSWORD', 'vista_dev_2024')}"
        f"@{os.environ.get('POSTGRES_HOST', 'db')}"
        f":{os.environ.get('POSTGRES_PORT', '5432')}"
        f"/{os.environ.get('POSTGRES_DB', 'vista')}"
    )
    engine = sqlalchemy.create_engine(url)
    return engine.connect()


def publish_metric(job_id: str, data: dict):
    """Publish training metrics to Redis Pub/Sub → relayed to WebSocket."""
    r = get_redis()
    r.publish(f"training:{job_id}", json.dumps(data))


# ═══════════════════════════════════════════════════════════════════════════════
# TASK: Train Model (SEQ 2, Phase 3)
# ═══════════════════════════════════════════════════════════════════════════════

@app.task(name="tasks.train_model", bind=True)
def train_model(self, job_id: str):
    """
    Full training pipeline with MLflow tracking.
    Logs: params, per-epoch metrics, model artifact, model registry.
    """
    logger.info(f"🚀 Starting training job {job_id}")
    mlflow_enabled = False
    mlflow_run = None

    try:
        import torch
        from sqlalchemy import text

        # Try to setup MLflow
        try:
            import mlflow
            tracking_uri = os.environ.get("MLFLOW_TRACKING_URI", "http://mlflow:5000")
            mlflow.set_tracking_uri(tracking_uri)
            mlflow.set_experiment("VISTA-Training")
            mlflow_enabled = True
            logger.info(f"MLflow tracking enabled: {tracking_uri}")
        except Exception as e:
            logger.warning(f"MLflow unavailable, continuing without tracking: {e}")

        conn = get_db_connection()

        # Fetch job config
        result = conn.execute(
            text("SELECT * FROM training_jobs WHERE id = :id"),
            {"id": job_id}
        )
        job = result.mappings().fetchone()
        if not job:
            raise ValueError(f"Job {job_id} not found")

        hyperparams = job["hyperparams"] if isinstance(job["hyperparams"], dict) else json.loads(job["hyperparams"])
        total_epochs = hyperparams.get("epochs", 100)
        architecture = job["architecture"]
        job_name = job["name"] or f"{architecture}_{job_id[:8]}"

        # Fetch dataset info for MLflow logging
        ds_result = conn.execute(
            text("SELECT name, image_count, defect_classes FROM datasets WHERE id = :id"),
            {"id": str(job["dataset_id"])}
        )
        dataset_info = ds_result.mappings().fetchone()

        # Update status → running
        conn.execute(
            text("UPDATE training_jobs SET status='running', started_at=NOW() WHERE id = :id"),
            {"id": job_id}
        )
        conn.commit()

        publish_metric(job_id, {"status": "running", "message": "Loading dataset..."})

        # ─── Start MLflow run ─────────────────────────────────────
        if mlflow_enabled:
            mlflow_run = mlflow.start_run(run_name=job_name)

            # Log all hyperparameters
            mlflow.log_params({
                "architecture": architecture,
                "task_type": job["task_type"],
                "epochs": total_epochs,
                "batch_size": hyperparams.get("batch_size", 16),
                "learning_rate": hyperparams.get("lr", 0.001),
                "optimizer": hyperparams.get("optimizer", "AdamW"),
                "weight_decay": hyperparams.get("weight_decay", 0.0005),
                "job_id": job_id,
            })

            # Log dataset info
            if dataset_info:
                mlflow.log_params({
                    "dataset_name": dataset_info["name"],
                    "dataset_images": dataset_info["image_count"],
                })

        # ─── Training loop ────────────────────────────────────────
        device = "cuda" if torch.cuda.is_available() else "cpu"
        logger.info(f"Training on device: {device}")
        if mlflow_enabled:
            mlflow.log_param("device", device)

        best_map = 0.0
        import random

        for epoch in range(1, total_epochs + 1):
            t0 = time.time()

            # Simulated training step (replace with real training)
            train_loss = max(0.05, 2.0 - (epoch * 0.018) + random.uniform(-0.05, 0.05))
            val_loss = max(0.08, 2.2 - (epoch * 0.019) + random.uniform(-0.04, 0.04))
            map50 = min(0.95, 0.3 + (epoch * 0.006) + random.uniform(-0.02, 0.02))
            precision = min(0.96, 0.35 + (epoch * 0.005) + random.uniform(-0.02, 0.02))
            recall = min(0.94, 0.32 + (epoch * 0.0055) + random.uniform(-0.02, 0.02))

            elapsed = time.time() - t0
            eta_seconds = elapsed * (total_epochs - epoch)

            if map50 > best_map:
                best_map = map50

            # Log to MLflow (every epoch)
            if mlflow_enabled:
                mlflow.log_metrics({
                    "train_loss": round(train_loss, 4),
                    "val_loss": round(val_loss, 4),
                    "map50": round(map50, 4),
                    "precision": round(precision, 4),
                    "recall": round(recall, 4),
                    "best_map50": round(best_map, 4),
                }, step=epoch)

            # Publish to Redis Pub/Sub (WebSocket streaming)
            metrics = {
                "epoch": epoch, "total_epochs": total_epochs,
                "train_loss": round(train_loss, 4), "val_loss": round(val_loss, 4),
                "map50": round(map50, 4), "precision": round(precision, 4),
                "recall": round(recall, 4), "best_map": round(best_map, 4),
                "eta_seconds": int(eta_seconds), "status": "running",
            }
            publish_metric(job_id, metrics)

            # Update DB periodically
            if epoch % 5 == 0 or epoch == total_epochs:
                conn.execute(
                    text("UPDATE training_jobs SET current_epoch=:epoch, best_metric=:best WHERE id=:id"),
                    {"epoch": epoch, "best": round(best_map, 4), "id": job_id}
                )
                conn.commit()

            time.sleep(0.5)

        # ─── Training complete ────────────────────────────────────
        weights_key = f"models/{job_id}/best.pt"
        s3 = get_s3()
        s3.put_object(
            Bucket=os.environ.get("MINIO_BUCKET_MODELS", "models-weights"),
            Key=weights_key,
            Body=b"placeholder-model-weights",
        )

        # Register model in DB
        import uuid
        model_id = str(uuid.uuid4())
        conn.execute(
            text("""
                INSERT INTO ml_models
                    (id, training_job_id, name, architecture, task_type,
                     weights_path, map50, precision_val, recall_val, status)
                VALUES
                    (:id, :job_id, :name, :arch, :task,
                     :weights, :map50, :prec, :rec, 'ready')
            """),
            {
                "id": model_id, "job_id": job_id,
                "name": f"{architecture}_v1", "arch": architecture,
                "task": job["task_type"], "weights": weights_key,
                "map50": round(best_map, 4),
                "prec": round(precision, 4), "rec": round(recall, 4),
            }
        )

        conn.execute(
            text("""
                UPDATE training_jobs
                SET status='completed', completed_at=NOW(),
                    current_epoch=:epochs, best_metric=:best
                WHERE id=:id
            """),
            {"epochs": total_epochs, "best": round(best_map, 4), "id": job_id}
        )
        conn.commit()
        conn.close()

        # ─── Log model to MLflow Registry ─────────────────────────
        if mlflow_enabled:
            mlflow.log_metrics({
                "final_map50": round(best_map, 4),
                "final_precision": round(precision, 4),
                "final_recall": round(recall, 4),
            })

            # Log model artifact
            try:
                # Create a temp file to log as artifact
                import tempfile
                with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
                    json.dump({
                        "model_id": model_id,
                        "architecture": architecture,
                        "map50": round(best_map, 4),
                        "weights_path": weights_key,
                    }, f)
                    mlflow.log_artifact(f.name, "model_info")

                # Register in Model Registry
                run_id = mlflow_run.info.run_id
                mlflow.register_model(
                    f"runs:/{run_id}/model_info",
                    job_name.replace(" ", "_")
                )
                logger.info(f"Model registered in MLflow: {job_name}")
            except Exception as e:
                logger.warning(f"MLflow model registration failed (non-critical): {e}")

            mlflow.end_run(status="FINISHED")

        # Final notification
        publish_metric(job_id, {
            "status": "completed",
            "final_map50": round(best_map, 4),
            "model_id": model_id,
            "message": "Training complete!",
        })

        logger.info(f"✅ Training job {job_id} completed — mAP@50: {best_map:.4f}")
        return {"status": "completed", "model_id": model_id, "best_map50": round(best_map, 4)}

    except Exception as e:
        logger.error(f"❌ Training job {job_id} failed: {e}")
        try:
            conn = get_db_connection()
            conn.execute(
                text("UPDATE training_jobs SET status='failed', error_message=:err WHERE id=:id"),
                {"err": str(e), "id": job_id}
            )
            conn.commit()
            conn.close()
        except Exception:
            pass
        if mlflow_enabled:
            try:
                import mlflow
                mlflow.end_run(status="FAILED")
            except Exception:
                pass
        publish_metric(job_id, {"status": "failed", "error": str(e)})
        raise


# ═══════════════════════════════════════════════════════════════════════════════
# TASK: Run Inference (SEQ 3, Phase 2)
# ═══════════════════════════════════════════════════════════════════════════════

@app.task(name="tasks.run_inference", bind=True)
def run_inference(self, model_id: str, image_b64: str, return_gradcam: bool = False):
    """
    Load model, run inference on image, optionally compute Grad-CAM.
    Returns detections + optional heatmap.
    """
    logger.info(f"🎯 Running inference with model {model_id}")
    t0 = time.time()

    try:
        import torch
        import numpy as np
        from PIL import Image as PILImage

        # Decode image
        image_bytes = base64.b64decode(image_b64)
        image = PILImage.open(BytesIO(image_bytes)).convert("RGB")

        # In production: load actual model from MinIO cache
        # model = torch.load(weights_path, map_location=device)
        # results = model(image)

        # Simulated detections
        import random
        num_detections = random.randint(0, 4)
        classes = ["Rayure", "Bavure", "Porosité", "Fissure"]
        detections = []
        for _ in range(num_detections):
            x1, y1 = random.randint(50, 400), random.randint(50, 400)
            detections.append({
                "class": random.choice(classes),
                "confidence": round(random.uniform(0.65, 0.98), 2),
                "bbox": [x1, y1, x1 + random.randint(30, 120), y1 + random.randint(30, 120)],
            })

        verdict = "anomaly" if detections else "ok"
        latency = (time.time() - t0) * 1000

        result = {
            "detections": detections,
            "verdict": verdict,
            "latency_ms": round(latency, 1),
        }

        # Grad-CAM (simulated)
        if return_gradcam and detections:
            # In production: pytorch-grad-cam → heatmap overlay → save to MinIO
            result["gradcam_url"] = None  # Would be a presigned URL
            result["gradcam_path"] = f"gradcam/{model_id}/{int(time.time())}.png"

        logger.info(f"✅ Inference done in {latency:.1f}ms — {len(detections)} detections")
        return result

    except Exception as e:
        logger.error(f"❌ Inference failed: {e}")
        raise


# ═══════════════════════════════════════════════════════════════════════════════
# TASK: Export Model (SEQ 3, Phase 4)
# ═══════════════════════════════════════════════════════════════════════════════

@app.task(name="tasks.export_model", bind=True)
def export_model(self, deployment_id: str, model_id: str, export_format: str):
    """
    Convert model to ONNX / TensorRT / Docker / API.
    """
    logger.info(f"📦 Exporting model {model_id} as {export_format}")

    try:
        from sqlalchemy import text
        conn = get_db_connection()

        # In production:
        # 1. Load .pt weights from MinIO
        # 2. Convert: torch.onnx.export() / tensorrt / build Docker image
        # 3. Upload result to MinIO exports bucket
        # 4. Update deployment record

        export_key = f"exports/{model_id}/model.{export_format}"

        # Simulate export
        time.sleep(5)

        s3 = get_s3()
        s3.put_object(
            Bucket=os.environ.get("MINIO_BUCKET_EXPORTS", "exports"),
            Key=export_key,
            Body=b"placeholder-exported-model",
        )

        conn.execute(
            text("""
                UPDATE deployments
                SET status='ready', export_path=:path
                WHERE id = :id
            """),
            {"path": export_key, "id": deployment_id}
        )
        conn.commit()
        conn.close()

        logger.info(f"✅ Export complete: {export_key}")
        return {"status": "ready", "export_path": export_key}

    except Exception as e:
        logger.error(f"❌ Export failed: {e}")
        try:
            conn = get_db_connection()
            conn.execute(
                text("UPDATE deployments SET status='failed' WHERE id = :id"),
                {"id": deployment_id}
            )
            conn.commit()
            conn.close()
        except Exception:
            pass
        raise


# ═══════════════════════════════════════════════════════════════════════════════
# TASK: Compute Grad-CAM
# ═══════════════════════════════════════════════════════════════════════════════

@app.task(name="tasks.compute_gradcam")
def compute_gradcam(model_id: str, image_b64: str):
    """Standalone Grad-CAM computation."""
    logger.info(f"🔥 Computing Grad-CAM for model {model_id}")
    # In production: pytorch-grad-cam library
    # cam = GradCAM(model=model, target_layers=[model.layer4[-1]])
    # grayscale_cam = cam(input_tensor=input_tensor)
    time.sleep(2)
    return {"gradcam_path": f"gradcam/{model_id}/{int(time.time())}.png"}
