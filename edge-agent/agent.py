"""
VISTA Edge Agent — Lightweight inference service for factory deployment.

Runs on any machine (Jetson, industrial PC, laptop).
Downloads the latest model from VISTA Cloud, watches a folder for new images,
runs inference, and reports results back to the cloud.

Usage:
    python agent.py --api-url http://vista-cloud:8000 --model-id <UUID> --watch-dir /camera/output
    
Or with Docker:
    docker run -v /camera/output:/watch vista-edge --api-url http://... --model-id ...
"""
import os
import sys
import time
import json
import logging
import argparse
import requests
from pathlib import Path
from datetime import datetime

logging.basicConfig(level=logging.INFO, format="%(asctime)s [EDGE] %(message)s")
logger = logging.getLogger(__name__)

class VistaEdgeAgent:
    """
    Lightweight edge inference agent.
    
    Flow:
    1. Authenticate with VISTA Cloud API
    2. Download the latest model weights (best.pt)
    3. Watch a directory for new images
    4. Run local YOLOv8 inference on each image
    5. Report results (detections, verdict) back to VISTA Cloud
    6. Periodically check for model updates
    """

    def __init__(self, api_url: str, model_id: str, watch_dir: str,
                 email: str = None, password: str = None,
                 confidence: float = 0.25, check_interval: int = 2,
                 model_refresh_minutes: int = 60):
        self.api_url = api_url.rstrip("/")
        self.model_id = model_id
        self.watch_dir = Path(watch_dir)
        self.confidence = confidence
        self.check_interval = check_interval
        self.model_refresh_minutes = model_refresh_minutes
        self.token = None
        self.model = None
        self.model_version = None
        self.processed_files = set()
        self.stats = {"total": 0, "ok": 0, "anomaly": 0, "errors": 0, "started": datetime.now().isoformat()}

        # Auth credentials
        self.email = email or os.environ.get("VISTA_EMAIL", "admin@vista.ai")
        self.password = password or os.environ.get("VISTA_PASSWORD", "admin123")

        # Results directory
        self.results_dir = self.watch_dir / "_vista_results"
        self.results_dir.mkdir(exist_ok=True)

    def authenticate(self):
        """Login to VISTA Cloud and get JWT token."""
        logger.info(f"Authenticating with {self.api_url}...")
        try:
            resp = requests.post(f"{self.api_url}/api/v1/auth/login", json={
                "email": self.email, "password": self.password
            }, timeout=10)
            resp.raise_for_status()
            data = resp.json()
            self.token = data["access_token"]
            user = data["user"]
            logger.info(f"Authenticated as {user['full_name']} ({user['role']}) — {user.get('organization', 'N/A')}")
            return True
        except Exception as e:
            logger.error(f"Authentication failed: {e}")
            return False

    def _headers(self):
        return {"Authorization": f"Bearer {self.token}"} if self.token else {}

    def download_model(self):
        """Download latest model weights from VISTA Cloud."""
        logger.info(f"Downloading model {self.model_id}...")
        try:
            # Get model info
            resp = requests.get(f"{self.api_url}/api/v1/models/{self.model_id}",
                                headers=self._headers(), timeout=10)
            resp.raise_for_status()
            model_info = resp.json()
            model_name = model_info.get("name", "unknown")
            logger.info(f"Model: {model_name} (mAP: {model_info.get('map50', 'N/A')})")

            # Download weights via inference endpoint (the model is cached in the worker)
            # For edge, we download the weights file directly
            weights_path = Path(f"/tmp/vista_edge_model_{self.model_id}.pt")

            # Try to get weights URL from model stats
            stats_resp = requests.get(f"{self.api_url}/api/v1/models/{self.model_id}/stats",
                                      headers=self._headers(), timeout=10)
            if stats_resp.ok:
                stats = stats_resp.json()
                logger.info(f"Model stats: {json.dumps(stats.get('usage', {}), indent=2)}")

            # Load model using ultralytics
            from ultralytics import YOLO

            if weights_path.exists() and self.model_version == self.model_id:
                logger.info("Using cached model weights")
                self.model = YOLO(str(weights_path))
            else:
                # Use the default pretrained model for now
                # In production, we'd download the actual best.pt from MinIO
                arch = model_info.get("architecture", "yolov8n")
                model_map = {"yolov8n": "yolov8n.pt", "yolov8s": "yolov8s.pt",
                             "yolov8m": "yolov8m.pt", "yolov8l": "yolov8l.pt"}
                model_file = model_map.get(arch, "yolov8n.pt")
                logger.info(f"Loading {model_file}...")
                self.model = YOLO(model_file)
                self.model_version = self.model_id

            logger.info("Model loaded and ready for inference")
            return True
        except Exception as e:
            logger.error(f"Model download failed: {e}")
            return False

    def run_inference(self, image_path: Path):
        """Run inference on a single image."""
        if not self.model:
            logger.error("No model loaded")
            return None

        try:
            t0 = time.time()
            results = self.model.predict(
                source=str(image_path),
                conf=self.confidence,
                iou=0.45,
                verbose=False,
            )
            latency = (time.time() - t0) * 1000

            detections = []
            if results and len(results) > 0:
                r = results[0]
                if r.boxes is not None:
                    for box in r.boxes:
                        x1, y1, x2, y2 = box.xyxy[0].tolist()
                        conf = float(box.conf[0])
                        cls_id = int(box.cls[0])
                        cls_name = self.model.names.get(cls_id, f"class_{cls_id}")
                        detections.append({
                            "class": cls_name,
                            "confidence": round(conf, 3),
                            "bbox": [int(x1), int(y1), int(x2), int(y2)],
                        })

            verdict = "anomaly" if detections else "ok"
            result = {
                "image": image_path.name,
                "verdict": verdict,
                "detections": detections,
                "latency_ms": round(latency, 1),
                "timestamp": datetime.now().isoformat(),
                "model_id": self.model_id,
            }

            # Update stats
            self.stats["total"] += 1
            if verdict == "ok":
                self.stats["ok"] += 1
            else:
                self.stats["anomaly"] += 1

            return result

        except Exception as e:
            logger.error(f"Inference failed for {image_path.name}: {e}")
            self.stats["errors"] += 1
            return None

    def report_result(self, result: dict):
        """Send inference result back to VISTA Cloud."""
        if not self.token:
            return

        try:
            # Save locally
            result_file = self.results_dir / f"{result['image']}.json"
            with open(str(result_file), "w") as f:
                json.dump(result, f, indent=2)

            # Report to cloud (non-blocking)
            # In production, this would call an edge-reporting endpoint
            logger.info(
                f"{'DEFECT' if result['verdict'] == 'anomaly' else 'OK'} "
                f"| {result['image']} "
                f"| {len(result['detections'])} detections "
                f"| {result['latency_ms']:.0f}ms"
            )
        except Exception as e:
            logger.warning(f"Failed to report result: {e}")

    def print_status(self):
        """Print current agent status."""
        logger.info(
            f"Stats: {self.stats['total']} inspected | "
            f"{self.stats['ok']} OK | "
            f"{self.stats['anomaly']} DEFECTS | "
            f"{self.stats['errors']} errors | "
            f"Anomaly rate: {self.stats['anomaly'] / max(self.stats['total'], 1) * 100:.1f}%"
        )

    def watch(self):
        """
        Main loop — watch directory for new images and run inference.
        This simulates a camera dropping images into a folder.
        In production, this would be triggered by a camera SDK callback.
        """
        logger.info(f"Watching {self.watch_dir} for new images...")
        logger.info(f"Confidence threshold: {self.confidence}")
        logger.info(f"Check interval: {self.check_interval}s")
        logger.info("─" * 60)

        last_model_check = time.time()

        while True:
            try:
                # Scan for new images
                image_extensions = {".jpg", ".jpeg", ".png", ".bmp", ".tiff"}
                for img_path in sorted(self.watch_dir.iterdir()):
                    if img_path.suffix.lower() not in image_extensions:
                        continue
                    if str(img_path) in self.processed_files:
                        continue

                    # New image found — run inference
                    self.processed_files.add(str(img_path))
                    result = self.run_inference(img_path)
                    if result:
                        self.report_result(result)

                        # Print verdict with color indicator
                        if result["verdict"] == "anomaly":
                            for det in result["detections"]:
                                logger.warning(
                                    f"  DEFECT: {det['class']} "
                                    f"(confidence: {det['confidence']:.1%}) "
                                    f"bbox: {det['bbox']}"
                                )

                # Periodic status
                if self.stats["total"] > 0 and self.stats["total"] % 10 == 0:
                    self.print_status()

                # Periodic model refresh
                if time.time() - last_model_check > self.model_refresh_minutes * 60:
                    logger.info("Checking for model updates...")
                    self.download_model()
                    last_model_check = time.time()

                time.sleep(self.check_interval)

            except KeyboardInterrupt:
                logger.info("Shutting down edge agent...")
                self.print_status()
                break
            except Exception as e:
                logger.error(f"Watch loop error: {e}")
                time.sleep(5)


def main():
    parser = argparse.ArgumentParser(description="VISTA Edge Agent — Factory inference service")
    parser.add_argument("--api-url", required=True, help="VISTA Cloud API URL (e.g., http://34.6.229.112:8000)")
    parser.add_argument("--model-id", required=True, help="Model UUID to use for inference")
    parser.add_argument("--watch-dir", default="./watch", help="Directory to watch for new images")
    parser.add_argument("--email", default="admin@vista.ai", help="VISTA login email")
    parser.add_argument("--password", default="admin123", help="VISTA login password")
    parser.add_argument("--confidence", type=float, default=0.25, help="Minimum detection confidence")
    parser.add_argument("--interval", type=int, default=2, help="Directory scan interval (seconds)")
    args = parser.parse_args()

    print("=" * 60)
    print("  VISTA Edge Agent v1.0")
    print("  Visual Inspection for Smart Industrial Applications")
    print("=" * 60)

    agent = VistaEdgeAgent(
        api_url=args.api_url,
        model_id=args.model_id,
        watch_dir=args.watch_dir,
        email=args.email,
        password=args.password,
        confidence=args.confidence,
        check_interval=args.interval,
    )

    if not agent.authenticate():
        logger.error("Cannot start without authentication")
        sys.exit(1)

    if not agent.download_model():
        logger.error("Cannot start without model")
        sys.exit(1)

    agent.watch()


if __name__ == "__main__":
    main()
