"""
VISTA — CPU Worker Tasks (Celery)
Handles: thumbnail generation, FFT analysis, image filters,
         annotation export (COCO/YOLO), PDF report generation.
"""
import os
import json
import time
import logging
from io import BytesIO

from celery import Celery
import boto3
from botocore.config import Config as BotoConfig

logger = logging.getLogger(__name__)

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
)


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


# ═══════════════════════════════════════════════════════════════════════════════
# TASK: Generate Thumbnail (SEQ 1, Step 1.5)
# ═══════════════════════════════════════════════════════════════════════════════

@app.task(name="tasks.generate_thumbnail")
def generate_thumbnail(image_id: str):
    """
    Download image from MinIO → resize to 256px → upload thumbnail → update DB.
    """
    logger.info(f"🖼️ Generating thumbnail for image {image_id}")

    try:
        from PIL import Image
        from sqlalchemy import text

        conn = get_db_connection()
        result = conn.execute(
            text("SELECT storage_path, dataset_id FROM images WHERE id = :id"),
            {"id": image_id}
        )
        row = result.mappings().fetchone()
        if not row:
            logger.warning(f"Image {image_id} not found")
            return

        storage_path = row["storage_path"]
        bucket = os.environ.get("MINIO_BUCKET_IMAGES", "images-raw")

        # Download from MinIO
        s3 = get_s3()
        response = s3.get_object(Bucket=bucket, Key=storage_path)
        image_bytes = response["Body"].read()

        # Resize
        img = Image.open(BytesIO(image_bytes))
        img.thumbnail((256, 256), Image.Resampling.LANCZOS)

        # Extract dimensions of original
        orig_img = Image.open(BytesIO(image_bytes))
        width, height = orig_img.size

        # Save thumbnail
        thumb_buffer = BytesIO()
        img.save(thumb_buffer, format="JPEG", quality=85)
        thumb_buffer.seek(0)

        thumb_key = storage_path.rsplit(".", 1)[0] + "_thumb.jpg"
        s3.put_object(
            Bucket=bucket,
            Key=thumb_key,
            Body=thumb_buffer.getvalue(),
            ContentType="image/jpeg",
        )

        # Update DB
        conn.execute(
            text("""
                UPDATE images
                SET thumbnail_path = :thumb, width = :w, height = :h
                WHERE id = :id
            """),
            {"thumb": thumb_key, "w": width, "h": height, "id": image_id}
        )
        conn.commit()
        conn.close()

        logger.info(f"✅ Thumbnail created: {thumb_key}")
        return {"thumbnail_path": thumb_key}

    except Exception as e:
        logger.error(f"❌ Thumbnail generation failed for {image_id}: {e}")
        raise


# ═══════════════════════════════════════════════════════════════════════════════
# TASK: Apply Image Filter (Sobel, Canny, EqHist)
# ═══════════════════════════════════════════════════════════════════════════════

@app.task(name="tasks.apply_filter")
def apply_filter(image_id: str, filter_type: str):
    """Apply a CV filter to an image and return the result."""
    logger.info(f"🖊️ Applying {filter_type} filter to image {image_id}")

    try:
        import cv2
        import numpy as np
        from sqlalchemy import text

        conn = get_db_connection()
        result = conn.execute(
            text("SELECT storage_path FROM images WHERE id = :id"),
            {"id": image_id}
        )
        row = result.mappings().fetchone()
        conn.close()

        if not row:
            raise ValueError(f"Image {image_id} not found")

        # Download
        s3 = get_s3()
        bucket = os.environ.get("MINIO_BUCKET_IMAGES", "images-raw")
        response = s3.get_object(Bucket=bucket, Key=row["storage_path"])
        img_array = np.frombuffer(response["Body"].read(), dtype=np.uint8)
        img = cv2.imdecode(img_array, cv2.IMREAD_COLOR)

        # Apply filter
        if filter_type == "sobel":
            gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
            sobelx = cv2.Sobel(gray, cv2.CV_64F, 1, 0, ksize=3)
            sobely = cv2.Sobel(gray, cv2.CV_64F, 0, 1, ksize=3)
            result_img = cv2.magnitude(sobelx, sobely)
            result_img = np.uint8(np.clip(result_img, 0, 255))
        elif filter_type == "canny":
            gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
            result_img = cv2.Canny(gray, 100, 200)
        elif filter_type == "equalize":
            gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
            result_img = cv2.equalizeHist(gray)
        else:
            raise ValueError(f"Unknown filter: {filter_type}")

        # Encode & upload
        _, buffer = cv2.imencode(".png", result_img)
        result_key = row["storage_path"].rsplit(".", 1)[0] + f"_{filter_type}.png"
        s3.put_object(
            Bucket=bucket,
            Key=result_key,
            Body=buffer.tobytes(),
            ContentType="image/png",
        )

        logger.info(f"✅ Filter {filter_type} applied: {result_key}")
        return {"result_path": result_key}

    except Exception as e:
        logger.error(f"❌ Filter failed: {e}")
        raise


# ═══════════════════════════════════════════════════════════════════════════════
# TASK: Compute FFT (spectral analysis)
# ═══════════════════════════════════════════════════════════════════════════════

@app.task(name="tasks.compute_fft")
def compute_fft(image_id: str):
    """Compute FFT magnitude spectrum of an image."""
    logger.info(f"📊 Computing FFT for image {image_id}")

    try:
        import cv2
        import numpy as np
        from sqlalchemy import text

        conn = get_db_connection()
        result = conn.execute(
            text("SELECT storage_path FROM images WHERE id = :id"),
            {"id": image_id}
        )
        row = result.mappings().fetchone()
        conn.close()

        s3 = get_s3()
        bucket = os.environ.get("MINIO_BUCKET_IMAGES", "images-raw")
        response = s3.get_object(Bucket=bucket, Key=row["storage_path"])
        img_array = np.frombuffer(response["Body"].read(), dtype=np.uint8)
        img = cv2.imdecode(img_array, cv2.IMREAD_GRAYSCALE)

        # FFT
        f = np.fft.fft2(img)
        fshift = np.fft.fftshift(f)
        magnitude = 20 * np.log(np.abs(fshift) + 1)
        magnitude = np.uint8(255 * magnitude / magnitude.max())

        # Upload
        _, buffer = cv2.imencode(".png", magnitude)
        fft_key = row["storage_path"].rsplit(".", 1)[0] + "_fft.png"
        s3.put_object(
            Bucket=bucket,
            Key=fft_key,
            Body=buffer.tobytes(),
            ContentType="image/png",
        )

        logger.info(f"✅ FFT computed: {fft_key}")
        return {"fft_path": fft_key}

    except Exception as e:
        logger.error(f"❌ FFT failed: {e}")
        raise


# ═══════════════════════════════════════════════════════════════════════════════
# TASK: Export Annotations (COCO / YOLO format)
# ═══════════════════════════════════════════════════════════════════════════════

@app.task(name="tasks.export_annotations")
def export_annotations(dataset_id: str, export_format: str = "coco"):
    """Export all annotations for a dataset in COCO or YOLO format."""
    logger.info(f"📤 Exporting annotations for dataset {dataset_id} as {export_format}")

    try:
        from sqlalchemy import text

        conn = get_db_connection()

        # Fetch all images + annotations
        result = conn.execute(
            text("""
                SELECT i.id as image_id, i.filename, i.width, i.height,
                       a.coordinates, a.defect_class, a.shape
                FROM images i
                LEFT JOIN annotations a ON a.image_id = i.id
                WHERE i.dataset_id = :ds_id
                ORDER BY i.filename
            """),
            {"ds_id": dataset_id}
        )
        rows = result.mappings().fetchall()
        conn.close()

        if export_format == "coco":
            coco = _build_coco_json(rows)
            content = json.dumps(coco, indent=2).encode()
            filename = "annotations_coco.json"
        elif export_format == "yolo":
            content = _build_yolo_txt(rows).encode()
            filename = "annotations_yolo.txt"
        else:
            raise ValueError(f"Unknown format: {export_format}")

        # Upload to MinIO
        s3 = get_s3()
        export_key = f"exports/{dataset_id}/{filename}"
        s3.put_object(
            Bucket=os.environ.get("MINIO_BUCKET_EXPORTS", "exports"),
            Key=export_key,
            Body=content,
        )

        logger.info(f"✅ Annotations exported: {export_key}")
        return {"export_path": export_key}

    except Exception as e:
        logger.error(f"❌ Annotation export failed: {e}")
        raise


def _build_coco_json(rows):
    """Build COCO-format JSON from annotation rows."""
    images = {}
    annotations = []
    categories = {}
    ann_id = 1

    for row in rows:
        img_id = str(row["image_id"])
        if img_id not in images:
            images[img_id] = {
                "id": len(images) + 1,
                "file_name": row["filename"],
                "width": row["width"] or 640,
                "height": row["height"] or 640,
            }

        if row["coordinates"]:
            cls = row["defect_class"]
            if cls not in categories:
                categories[cls] = {"id": len(categories) + 1, "name": cls}

            coords = row["coordinates"] if isinstance(row["coordinates"], dict) else json.loads(row["coordinates"])
            w_img = row["width"] or 640
            h_img = row["height"] or 640

            annotations.append({
                "id": ann_id,
                "image_id": images[img_id]["id"],
                "category_id": categories[cls]["id"],
                "bbox": [
                    coords.get("nx", 0) * w_img,
                    coords.get("ny", 0) * h_img,
                    coords.get("nw", 0) * w_img,
                    coords.get("nh", 0) * h_img,
                ],
                "area": coords.get("nw", 0) * w_img * coords.get("nh", 0) * h_img,
                "iscrowd": 0,
            })
            ann_id += 1

    return {
        "images": list(images.values()),
        "annotations": annotations,
        "categories": list(categories.values()),
    }


def _build_yolo_txt(rows):
    """Build YOLO-format labels."""
    classes = {}
    lines = []
    for row in rows:
        if row["coordinates"]:
            cls = row["defect_class"]
            if cls not in classes:
                classes[cls] = len(classes)
            coords = row["coordinates"] if isinstance(row["coordinates"], dict) else json.loads(row["coordinates"])
            cx = coords.get("nx", 0) + coords.get("nw", 0) / 2
            cy = coords.get("ny", 0) + coords.get("nh", 0) / 2
            lines.append(
                f"# {row['filename']}\n"
                f"{classes[cls]} {cx:.6f} {cy:.6f} {coords.get('nw', 0):.6f} {coords.get('nh', 0):.6f}"
            )
    return "\n".join(lines)


# ═══════════════════════════════════════════════════════════════════════════════
# TASK: Preview Augmentations (Brique 02)
# ═══════════════════════════════════════════════════════════════════════════════

@app.task(name="tasks.preview_augmentation")
def preview_augmentation(image_id: str, augmentations: list):
    """
    Apply a chain of augmentations to an image and return the result.
    Augmentations: [{"type": "HorizontalFlip", "p": 1.0}, {"type": "RandomRotate90"}, ...]
    """
    logger.info(f"🔄 Previewing augmentations for image {image_id}")

    try:
        import cv2
        import numpy as np
        from sqlalchemy import text

        conn = get_db_connection()
        result = conn.execute(
            text("SELECT storage_path FROM images WHERE id = :id"),
            {"id": image_id}
        )
        row = result.mappings().fetchone()
        conn.close()

        if not row:
            raise ValueError(f"Image {image_id} not found")

        s3 = get_s3()
        bucket = os.environ.get("MINIO_BUCKET_IMAGES", "images-raw")
        response = s3.get_object(Bucket=bucket, Key=row["storage_path"])
        img_array = np.frombuffer(response["Body"].read(), dtype=np.uint8)
        img = cv2.imdecode(img_array, cv2.IMREAD_COLOR)

        # Apply augmentations sequentially
        result_img = img.copy()
        for aug in augmentations:
            aug_type = aug.get("type", "")
            p = aug.get("p", 1.0)

            if np.random.random() > p:
                continue

            if aug_type == "HorizontalFlip":
                result_img = cv2.flip(result_img, 1)
            elif aug_type == "VerticalFlip":
                result_img = cv2.flip(result_img, 0)
            elif aug_type == "RandomRotate90":
                k = np.random.randint(1, 4)
                result_img = np.rot90(result_img, k)
            elif aug_type == "Rotate":
                angle = aug.get("limit", 45)
                angle = np.random.uniform(-angle, angle)
                h, w = result_img.shape[:2]
                M = cv2.getRotationMatrix2D((w / 2, h / 2), angle, 1.0)
                result_img = cv2.warpAffine(result_img, M, (w, h))
            elif aug_type == "GaussianBlur":
                ksize = aug.get("blur_limit", 7)
                if ksize % 2 == 0:
                    ksize += 1
                result_img = cv2.GaussianBlur(result_img, (ksize, ksize), 0)
            elif aug_type == "GaussianNoise":
                sigma = aug.get("var_limit", 25)
                noise = np.random.randn(*result_img.shape) * sigma
                result_img = np.clip(result_img + noise, 0, 255).astype(np.uint8)
            elif aug_type == "Brightness":
                factor = aug.get("limit", 0.3)
                delta = np.random.uniform(-factor, factor)
                result_img = np.clip(result_img.astype(np.float32) + delta * 255, 0, 255).astype(np.uint8)
            elif aug_type == "Contrast":
                factor = 1.0 + np.random.uniform(-0.3, 0.3)
                mean = result_img.mean()
                result_img = np.clip((result_img - mean) * factor + mean, 0, 255).astype(np.uint8)
            elif aug_type == "CLAHE":
                lab = cv2.cvtColor(result_img, cv2.COLOR_BGR2LAB)
                clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
                lab[:, :, 0] = clahe.apply(lab[:, :, 0])
                result_img = cv2.cvtColor(lab, cv2.COLOR_LAB2BGR)

        # Encode & upload
        _, buffer = cv2.imencode(".jpg", result_img, [cv2.IMWRITE_JPEG_QUALITY, 90])
        result_key = row["storage_path"].rsplit(".", 1)[0] + f"_aug_{int(time.time())}.jpg"
        s3.put_object(
            Bucket=bucket,
            Key=result_key,
            Body=buffer.tobytes(),
            ContentType="image/jpeg",
        )

        logger.info(f"✅ Augmentation preview: {result_key}")
        return {"result_path": result_key}

    except Exception as e:
        logger.error(f"❌ Augmentation preview failed: {e}")
        raise


# ═══════════════════════════════════════════════════════════════════════════════
# TASK: Compute Image Difference (Brique 02)
# ═══════════════════════════════════════════════════════════════════════════════

@app.task(name="tasks.compute_diff")
def compute_diff(image_id_a: str, image_id_b: str):
    """Compute absolute pixel difference between two images."""
    logger.info(f"⚖️ Computing diff between {image_id_a} and {image_id_b}")

    try:
        import cv2
        import numpy as np
        from sqlalchemy import text

        conn = get_db_connection()

        def load_image(img_id):
            result = conn.execute(
                text("SELECT storage_path FROM images WHERE id = :id"),
                {"id": img_id}
            )
            row = result.mappings().fetchone()
            if not row:
                raise ValueError(f"Image {img_id} not found")
            s3 = get_s3()
            bucket = os.environ.get("MINIO_BUCKET_IMAGES", "images-raw")
            response = s3.get_object(Bucket=bucket, Key=row["storage_path"])
            arr = np.frombuffer(response["Body"].read(), dtype=np.uint8)
            return cv2.imdecode(arr, cv2.IMREAD_COLOR), row["storage_path"]

        img_a, path_a = load_image(image_id_a)
        img_b, path_b = load_image(image_id_b)
        conn.close()

        # Resize to same dimensions
        h = min(img_a.shape[0], img_b.shape[0])
        w = min(img_a.shape[1], img_b.shape[1])
        img_a = cv2.resize(img_a, (w, h))
        img_b = cv2.resize(img_b, (w, h))

        # Absolute difference
        diff = cv2.absdiff(img_a, img_b)

        # Enhance difference visibility
        diff_gray = cv2.cvtColor(diff, cv2.COLOR_BGR2GRAY)
        _, diff_thresh = cv2.threshold(diff_gray, 30, 255, cv2.THRESH_BINARY)

        # Apply colormap for visualization
        diff_colored = cv2.applyColorMap(diff_gray * 3, cv2.COLORMAP_JET)

        # Upload
        s3 = get_s3()
        bucket = os.environ.get("MINIO_BUCKET_IMAGES", "images-raw")

        _, buf = cv2.imencode(".png", diff_colored)
        diff_key = path_a.rsplit(".", 1)[0] + f"_diff_{int(time.time())}.png"
        s3.put_object(Bucket=bucket, Key=diff_key, Body=buf.tobytes(), ContentType="image/png")

        # Compute similarity score (SSIM-like)
        similarity = 1.0 - (diff_gray.mean() / 255.0)

        logger.info(f"✅ Diff computed: similarity={similarity:.4f}")
        return {"diff_path": diff_key, "similarity": round(similarity, 4)}

    except Exception as e:
        logger.error(f"❌ Diff failed: {e}")
        raise


# ═══════════════════════════════════════════════════════════════════════════════
# MLOPS TASKS
# ═══════════════════════════════════════════════════════════════════════════════

@app.task(name="tasks.run_drift_analysis")
def run_drift_analysis(model_id: str, window_days: int = 7):
    """Run data drift detection and store report."""
    logger.info(f"📊 Running drift analysis for model {model_id}")
    try:
        import sys
        sys.path.insert(0, "/app")

        from sqlalchemy import text

        conn = get_db_connection()

        # Fetch recent inferences
        from datetime import datetime, timedelta
        cutoff = (datetime.utcnow() - timedelta(days=window_days)).isoformat()
        result = conn.execute(
            text("""
                SELECT detections, verdict, latency_ms, created_at
                FROM inference_logs
                WHERE model_id = :model_id AND created_at > :cutoff
                ORDER BY created_at DESC
            """),
            {"model_id": model_id, "cutoff": cutoff}
        )
        rows = result.mappings().fetchall()

        # Reference period
        ref_cutoff = (datetime.utcnow() - timedelta(days=window_days * 2)).isoformat()
        ref_result = conn.execute(
            text("""
                SELECT detections, verdict, latency_ms, created_at
                FROM inference_logs
                WHERE model_id = :model_id
                  AND created_at > :ref_cutoff AND created_at <= :cutoff
            """),
            {"model_id": model_id, "ref_cutoff": ref_cutoff, "cutoff": cutoff}
        )
        ref_rows = ref_result.mappings().fetchall()

        # Analyze
        alerts = []
        drift_score = 0.0
        details = {}

        if len(rows) >= 5 and len(ref_rows) >= 5:
            # Confidence drift
            import numpy as np
            curr_confs = []
            ref_confs = []
            for r in rows:
                dets = r["detections"] if isinstance(r["detections"], list) else json.loads(r["detections"] or "[]")
                curr_confs.extend([d.get("confidence", 0) for d in dets if isinstance(d, dict)])
            for r in ref_rows:
                dets = r["detections"] if isinstance(r["detections"], list) else json.loads(r["detections"] or "[]")
                ref_confs.extend([d.get("confidence", 0) for d in dets if isinstance(d, dict)])

            if curr_confs and ref_confs:
                shift = abs(np.mean(curr_confs) - np.mean(ref_confs))
                details["confidence_shift"] = round(float(shift), 4)
                if shift > 0.1:
                    alerts.append(f"Confidence shifted by {shift:.2%}")
                    drift_score += 0.3

            # Anomaly rate drift
            curr_rate = sum(1 for r in rows if r["verdict"] == "anomaly") / len(rows)
            ref_rate = sum(1 for r in ref_rows if r["verdict"] == "anomaly") / len(ref_rows)
            rate_shift = abs(curr_rate - ref_rate)
            details["anomaly_rate_shift"] = round(float(rate_shift), 4)
            if rate_shift > 0.15:
                alerts.append(f"Anomaly rate shifted: {ref_rate:.1%} → {curr_rate:.1%}")
                drift_score += 0.3

            # Latency drift
            curr_lats = [r["latency_ms"] for r in rows if r["latency_ms"]]
            ref_lats = [r["latency_ms"] for r in ref_rows if r["latency_ms"]]
            if curr_lats and ref_lats:
                lat_ratio = np.percentile(curr_lats, 95) / max(np.percentile(ref_lats, 95), 0.1)
                details["latency_p95_ratio"] = round(float(lat_ratio), 2)
                if lat_ratio > 2.0:
                    alerts.append(f"Latency spike: P95 ratio = {lat_ratio:.1f}x")
                    drift_score += 0.2

        drift_detected = drift_score > 0.3 or len(alerts) >= 2
        drift_score = min(1.0, drift_score)

        # Save report
        import uuid
        report_id = str(uuid.uuid4())
        conn.execute(
            text("""
                INSERT INTO drift_reports (id, model_id, window_days, drift_detected, drift_score, alerts, details)
                VALUES (:id, :model_id, :window, :detected, :score, :alerts, :details)
            """),
            {
                "id": report_id, "model_id": model_id, "window": window_days,
                "detected": drift_detected, "score": drift_score,
                "alerts": json.dumps(alerts), "details": json.dumps(details),
            }
        )
        conn.commit()
        conn.close()

        report = {
            "id": report_id, "model_id": model_id,
            "drift_detected": drift_detected, "drift_score": round(drift_score, 3),
            "alerts": alerts, "details": details,
            "total_inferences": len(rows), "window_days": window_days,
        }

        # Send alert if drift detected
        if drift_detected:
            r = __import__("redis").from_url(os.environ.get("REDIS_URL", "redis://redis:6379/0"))
            r.publish("vista:alerts", json.dumps({
                "severity": "warning" if drift_score < 0.7 else "critical",
                "source": "drift_detector",
                "title": f"Data drift detected (score: {drift_score:.2f})",
                "message": "; ".join(alerts),
                "model_id": model_id,
            }))

        logger.info(f"✅ Drift analysis done: detected={drift_detected}, score={drift_score:.2f}")
        return report

    except Exception as e:
        logger.error(f"❌ Drift analysis failed: {e}")
        raise


@app.task(name="tasks.create_dataset_snapshot")
def create_dataset_snapshot(dataset_id: str, name: str, description: str = ""):
    """Create a versioned snapshot of a dataset."""
    logger.info(f"📸 Creating dataset snapshot: {name}")
    try:
        from sqlalchemy import text
        import hashlib

        conn = get_db_connection()

        # Fetch images
        result = conn.execute(
            text("SELECT id, filename, storage_path, split, file_size_bytes FROM images WHERE dataset_id = :id ORDER BY filename"),
            {"id": dataset_id}
        )
        images = [dict(r) for r in result.mappings().fetchall()]

        # Annotation count
        ann_result = conn.execute(
            text("SELECT COUNT(*) as cnt FROM annotations a JOIN images i ON a.image_id = i.id WHERE i.dataset_id = :id"),
            {"id": dataset_id}
        )
        ann_count = ann_result.scalar() or 0

        # Hash
        hash_input = json.dumps([(i["filename"], i.get("file_size_bytes", 0)) for i in images], sort_keys=True)
        content_hash = hashlib.sha256(hash_input.encode()).hexdigest()[:16]

        # Save snapshot to MinIO
        snapshot = {
            "dataset_id": dataset_id, "version_name": name,
            "description": description, "content_hash": content_hash,
            "image_count": len(images), "annotation_count": ann_count,
            "images": [{"filename": i["filename"], "path": i["storage_path"], "split": i.get("split", "train")} for i in images],
            "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ"),
        }

        s3 = get_s3()
        key = f"dataset-versions/{dataset_id}/{name}_{content_hash}.json"
        s3.put_object(
            Bucket=os.environ.get("MINIO_BUCKET_EXPORTS", "exports"),
            Key=key, Body=json.dumps(snapshot, indent=2, default=str).encode(),
            ContentType="application/json",
        )

        # Record in DB
        import uuid
        conn.execute(
            text("""
                INSERT INTO dataset_versions (id, dataset_id, version_name, description, content_hash, image_count, annotation_count, snapshot_path)
                VALUES (:id, :ds, :name, :desc, :hash, :imgs, :anns, :path)
            """),
            {"id": str(uuid.uuid4()), "ds": dataset_id, "name": name, "desc": description,
             "hash": content_hash, "imgs": len(images), "anns": ann_count, "path": key}
        )
        conn.commit()
        conn.close()

        logger.info(f"✅ Snapshot created: {name} ({len(images)} images, {ann_count} annotations, hash={content_hash})")
        return snapshot

    except Exception as e:
        logger.error(f"❌ Snapshot failed: {e}")
        raise


@app.task(name="tasks.list_dataset_versions")
def list_dataset_versions(dataset_id: str):
    """List all versions of a dataset."""
    try:
        from sqlalchemy import text
        conn = get_db_connection()
        result = conn.execute(
            text("SELECT * FROM dataset_versions WHERE dataset_id = :id ORDER BY created_at DESC"),
            {"id": dataset_id}
        )
        versions = [dict(r) for r in result.mappings().fetchall()]
        conn.close()
        return [{"version_name": v["version_name"], "content_hash": v["content_hash"],
                 "image_count": v["image_count"], "annotation_count": v["annotation_count"],
                 "created_at": str(v["created_at"])} for v in versions]
    except Exception as e:
        logger.error(f"❌ List versions failed: {e}")
        return []
