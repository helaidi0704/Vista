"""
VISTA MLOps — MLflow Integration
Tracks experiments, logs metrics/artifacts, registers models.
Used by the GPU Worker during training.
"""
import os
import json
import logging
from typing import Optional

logger = logging.getLogger(__name__)

MLFLOW_TRACKING_URI = os.environ.get("MLFLOW_TRACKING_URI", "http://mlflow:5000")
MLFLOW_ENABLED = os.environ.get("MLFLOW_ENABLED", "true").lower() == "true"


class ExperimentTracker:
    """
    Wraps MLflow to track training experiments.

    Usage in GPU worker:
        tracker = ExperimentTracker("YOLOv8_Carter_Moteur")
        tracker.start_run(run_name="yolov8s_lr001_bs16")
        tracker.log_params({"lr": 0.001, "batch_size": 16, ...})
        for epoch in range(100):
            tracker.log_metrics({"train_loss": 0.5, "val_loss": 0.4, "map50": 0.82}, step=epoch)
        tracker.log_model(model_path="/app/best.pt", model_name="YOLOv8_Detect_v3")
        tracker.end_run()
    """

    def __init__(self, experiment_name: str = "vista-default"):
        self.enabled = MLFLOW_ENABLED
        self.experiment_name = experiment_name
        self.run = None
        self.mlflow = None

        if self.enabled:
            try:
                import mlflow
                mlflow.set_tracking_uri(MLFLOW_TRACKING_URI)
                mlflow.set_experiment(experiment_name)
                self.mlflow = mlflow
                logger.info(f"MLflow tracking enabled — experiment: {experiment_name}")
            except Exception as e:
                logger.warning(f"MLflow unavailable, continuing without tracking: {e}")
                self.enabled = False

    def start_run(self, run_name: Optional[str] = None, tags: Optional[dict] = None):
        """Start a new MLflow run."""
        if not self.enabled:
            return
        try:
            self.run = self.mlflow.start_run(run_name=run_name, tags=tags or {})
            logger.info(f"MLflow run started: {run_name} (id: {self.run.info.run_id})")
        except Exception as e:
            logger.warning(f"Failed to start MLflow run: {e}")

    def log_params(self, params: dict):
        """Log hyperparameters."""
        if not self.enabled or not self.run:
            return
        try:
            self.mlflow.log_params(params)
        except Exception as e:
            logger.warning(f"Failed to log params: {e}")

    def log_metrics(self, metrics: dict, step: Optional[int] = None):
        """Log metrics for a given step (epoch)."""
        if not self.enabled or not self.run:
            return
        try:
            self.mlflow.log_metrics(metrics, step=step)
        except Exception as e:
            logger.warning(f"Failed to log metrics: {e}")

    def log_artifact(self, local_path: str, artifact_path: Optional[str] = None):
        """Log a file as an artifact (weights, config, plots)."""
        if not self.enabled or not self.run:
            return
        try:
            self.mlflow.log_artifact(local_path, artifact_path)
            logger.info(f"Artifact logged: {local_path}")
        except Exception as e:
            logger.warning(f"Failed to log artifact: {e}")

    def log_model(self, model_path: str, model_name: str,
                  metrics: Optional[dict] = None):
        """
        Register a trained model in the MLflow Model Registry.
        Enables versioning: YOLOv8_Detect_v1, v2, v3...
        """
        if not self.enabled or not self.run:
            return
        try:
            # Log the model artifact
            self.mlflow.log_artifact(model_path, "model")

            # Register in Model Registry
            run_id = self.run.info.run_id
            model_uri = f"runs:/{run_id}/model"
            result = self.mlflow.register_model(model_uri, model_name)
            logger.info(
                f"Model registered: {model_name} v{result.version}"
            )

            # Tag with performance metrics
            if metrics:
                from mlflow.tracking import MlflowClient
                client = MlflowClient(MLFLOW_TRACKING_URI)
                for key, value in metrics.items():
                    client.set_model_version_tag(
                        model_name, result.version, key, str(round(value, 4))
                    )

            return result.version
        except Exception as e:
            logger.warning(f"Failed to register model: {e}")
            return None

    def log_dataset_info(self, dataset_name: str, image_count: int,
                         classes: list, split_config: dict):
        """Log dataset metadata for reproducibility."""
        if not self.enabled or not self.run:
            return
        try:
            self.mlflow.log_params({
                "dataset_name": dataset_name,
                "dataset_images": image_count,
                "dataset_classes": json.dumps(classes),
                "split_train": split_config.get("train", 0.7),
                "split_val": split_config.get("val", 0.2),
                "split_test": split_config.get("test", 0.1),
            })
        except Exception as e:
            logger.warning(f"Failed to log dataset info: {e}")

    def set_model_stage(self, model_name: str, version: int,
                        stage: str = "Production"):
        """
        Transition a model version to a stage.
        Stages: None → Staging → Production → Archived
        """
        if not self.enabled:
            return
        try:
            from mlflow.tracking import MlflowClient
            client = MlflowClient(MLFLOW_TRACKING_URI)
            client.transition_model_version_stage(
                name=model_name,
                version=version,
                stage=stage,
            )
            logger.info(f"Model {model_name} v{version} → {stage}")
        except Exception as e:
            logger.warning(f"Failed to transition model stage: {e}")

    def end_run(self, status: str = "FINISHED"):
        """End the current run."""
        if not self.enabled or not self.run:
            return
        try:
            self.mlflow.end_run(status=status)
            logger.info(f"MLflow run ended: {status}")
        except Exception as e:
            logger.warning(f"Failed to end MLflow run: {e}")
        finally:
            self.run = None


def compare_runs(experiment_name: str, metric: str = "map50",
                 top_n: int = 5) -> list:
    """
    Compare the top N runs of an experiment by a given metric.
    Returns a list of dicts with run_id, params, and metrics.
    """
    try:
        import mlflow
        mlflow.set_tracking_uri(MLFLOW_TRACKING_URI)
        experiment = mlflow.get_experiment_by_name(experiment_name)
        if not experiment:
            return []

        runs = mlflow.search_runs(
            experiment_ids=[experiment.experiment_id],
            order_by=[f"metrics.{metric} DESC"],
            max_results=top_n,
        )

        results = []
        for _, row in runs.iterrows():
            results.append({
                "run_id": row["run_id"],
                "run_name": row.get("tags.mlflow.runName", ""),
                "status": row["status"],
                metric: row.get(f"metrics.{metric}"),
                "params": {
                    k.replace("params.", ""): v
                    for k, v in row.items()
                    if k.startswith("params.")
                },
            })
        return results
    except Exception as e:
        logger.warning(f"Failed to compare runs: {e}")
        return []
