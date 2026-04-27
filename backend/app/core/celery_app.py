"""
VISTA — Celery Configuration
Two queues: 'gpu' (concurrency=1) and 'cpu' (concurrency=4).
"""
from celery import Celery
from app.core.config import get_settings

settings = get_settings()

celery_app = Celery(
    "vista",
    broker=settings.celery_broker_url,
    backend=settings.celery_result_backend,
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    task_routes={
        "tasks.train_model": {"queue": "gpu"},
        "tasks.run_inference": {"queue": "gpu"},
        "tasks.export_model": {"queue": "gpu"},
        "tasks.compute_gradcam": {"queue": "gpu"},
        "tasks.generate_thumbnail": {"queue": "cpu"},
        "tasks.apply_filter": {"queue": "cpu"},
        "tasks.compute_fft": {"queue": "cpu"},
        "tasks.export_annotations": {"queue": "cpu"},
        "tasks.preview_augmentation": {"queue": "cpu"},
        "tasks.compute_diff": {"queue": "cpu"},
        "tasks.run_drift_analysis": {"queue": "cpu"},
        "tasks.create_dataset_snapshot": {"queue": "cpu"},
        "tasks.list_dataset_versions": {"queue": "cpu"},
    },
    task_default_queue="cpu",
)
