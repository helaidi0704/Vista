"""
VISTA MLOps — Dataset Versioning
Tracks dataset snapshots for reproducibility.
Each version records: image list, annotation count, class distribution,
split config, and a hash for integrity verification.

Lightweight alternative to DVC — no external tool needed,
uses MinIO + PostgreSQL to store version metadata.
"""
import os
import json
import hashlib
import logging
from datetime import datetime
from typing import Optional

logger = logging.getLogger(__name__)


class DatasetVersioner:
    """
    Creates and manages dataset snapshots for reproducibility.

    Usage:
        versioner = DatasetVersioner()
        version = versioner.create_snapshot(
            dataset_id="uuid",
            name="carter_moteur_v3",
            description="Added 200 new annotated images from batch 2024-12"
        )
        # Later, for reproducibility:
        info = versioner.get_version(version_id)
        # info = {"images": [...], "hash": "abc123", "annotations": 4200, ...}
    """

    def __init__(self, db_connection=None, s3_client=None):
        self.conn = db_connection
        self.s3 = s3_client

    def create_snapshot(self, dataset_id: str, name: str,
                        description: str = "") -> Optional[dict]:
        """
        Create a point-in-time snapshot of a dataset.
        Records: all image paths, annotation counts, class distribution,
                 split config, and a content hash.
        """
        try:
            conn = self.conn or self._get_db_connection()
            from sqlalchemy import text

            # Fetch dataset metadata
            ds_result = conn.execute(
                text("SELECT * FROM datasets WHERE id = :id"),
                {"id": dataset_id}
            )
            dataset = ds_result.mappings().fetchone()
            if not dataset:
                logger.error(f"Dataset {dataset_id} not found")
                return None

            # Fetch all images
            img_result = conn.execute(
                text("""
                    SELECT id, filename, storage_path, width, height, split,
                           file_size_bytes
                    FROM images WHERE dataset_id = :ds_id
                    ORDER BY filename
                """),
                {"ds_id": dataset_id}
            )
            images = [dict(r) for r in img_result.mappings().fetchall()]

            # Fetch annotation stats
            ann_result = conn.execute(
                text("""
                    SELECT a.defect_class, a.severity, COUNT(*) as count
                    FROM annotations a
                    JOIN images i ON a.image_id = i.id
                    WHERE i.dataset_id = :ds_id
                    GROUP BY a.defect_class, a.severity
                    ORDER BY count DESC
                """),
                {"ds_id": dataset_id}
            )
            annotation_stats = [dict(r) for r in ann_result.mappings().fetchall()]

            # Total annotations
            total_ann = sum(s["count"] for s in annotation_stats)

            # Split distribution
            split_dist = {}
            for img in images:
                sp = img.get("split", "train")
                split_dist[sp] = split_dist.get(sp, 0) + 1

            # Compute content hash (based on filenames + sizes for speed)
            hash_input = json.dumps(
                [(i["filename"], i.get("file_size_bytes", 0)) for i in images],
                sort_keys=True
            )
            content_hash = hashlib.sha256(hash_input.encode()).hexdigest()[:16]

            # Build version record
            version = {
                "dataset_id": dataset_id,
                "dataset_name": dataset["name"],
                "version_name": name,
                "description": description,
                "created_at": datetime.utcnow().isoformat(),
                "content_hash": content_hash,
                "stats": {
                    "total_images": len(images),
                    "total_annotations": total_ann,
                    "split_distribution": split_dist,
                    "class_distribution": {
                        s["defect_class"]: s["count"] for s in annotation_stats
                    },
                    "total_size_bytes": sum(
                        i.get("file_size_bytes", 0) or 0 for i in images
                    ),
                },
                "images": [
                    {
                        "id": str(i["id"]),
                        "filename": i["filename"],
                        "storage_path": i["storage_path"],
                        "split": i.get("split", "train"),
                    }
                    for i in images
                ],
                "defect_classes": dataset.get("defect_classes", []),
                "split_config": dataset.get("split_config",
                                            {"train": 0.7, "val": 0.2, "test": 0.1}),
            }

            # Save to MinIO as JSON
            s3 = self.s3 or self._get_s3_client()
            version_key = f"dataset-versions/{dataset_id}/{name}_{content_hash}.json"
            s3.put_object(
                Bucket=os.environ.get("MINIO_BUCKET_EXPORTS", "exports"),
                Key=version_key,
                Body=json.dumps(version, indent=2, default=str).encode(),
                ContentType="application/json",
            )

            logger.info(
                f"Dataset snapshot created: {name} "
                f"({len(images)} images, {total_ann} annotations, "
                f"hash={content_hash})"
            )

            if not self.conn:
                conn.close()

            return version

        except Exception as e:
            logger.error(f"Failed to create dataset snapshot: {e}")
            return None

    def list_versions(self, dataset_id: str) -> list:
        """List all snapshots for a dataset."""
        try:
            s3 = self.s3 or self._get_s3_client()
            prefix = f"dataset-versions/{dataset_id}/"
            response = s3.list_objects_v2(
                Bucket=os.environ.get("MINIO_BUCKET_EXPORTS", "exports"),
                Prefix=prefix,
            )
            versions = []
            for obj in response.get("Contents", []):
                body = s3.get_object(
                    Bucket=os.environ.get("MINIO_BUCKET_EXPORTS", "exports"),
                    Key=obj["Key"],
                )
                data = json.loads(body["Body"].read().decode())
                versions.append({
                    "version_name": data.get("version_name"),
                    "created_at": data.get("created_at"),
                    "content_hash": data.get("content_hash"),
                    "total_images": data.get("stats", {}).get("total_images", 0),
                    "total_annotations": data.get("stats", {}).get("total_annotations", 0),
                    "key": obj["Key"],
                })
            return sorted(versions, key=lambda v: v["created_at"], reverse=True)
        except Exception as e:
            logger.error(f"Failed to list versions: {e}")
            return []

    def get_version(self, dataset_id: str, version_name: str) -> Optional[dict]:
        """Retrieve a specific dataset version."""
        try:
            s3 = self.s3 or self._get_s3_client()
            versions = self.list_versions(dataset_id)
            match = next(
                (v for v in versions if v["version_name"] == version_name), None
            )
            if not match:
                return None

            body = s3.get_object(
                Bucket=os.environ.get("MINIO_BUCKET_EXPORTS", "exports"),
                Key=match["key"],
            )
            return json.loads(body["Body"].read().decode())
        except Exception as e:
            logger.error(f"Failed to get version: {e}")
            return None

    def compare_versions(self, dataset_id: str,
                         version_a: str, version_b: str) -> dict:
        """Compare two dataset versions — show what changed."""
        a = self.get_version(dataset_id, version_a)
        b = self.get_version(dataset_id, version_b)

        if not a or not b:
            return {"error": "One or both versions not found"}

        a_files = {i["filename"] for i in a.get("images", [])}
        b_files = {i["filename"] for i in b.get("images", [])}

        return {
            "version_a": version_a,
            "version_b": version_b,
            "images_added": list(b_files - a_files),
            "images_removed": list(a_files - b_files),
            "images_unchanged": len(a_files & b_files),
            "annotation_delta": (
                b["stats"]["total_annotations"] - a["stats"]["total_annotations"]
            ),
            "class_changes": {
                "before": a["stats"].get("class_distribution", {}),
                "after": b["stats"].get("class_distribution", {}),
            },
        }

    def _get_db_connection(self):
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

    def _get_s3_client(self):
        import boto3
        from botocore.config import Config
        return boto3.client(
            "s3",
            endpoint_url=f"http://{os.environ.get('MINIO_ENDPOINT', 'minio:9000')}",
            aws_access_key_id=os.environ.get("MINIO_ACCESS_KEY", "vistaadmin"),
            aws_secret_access_key=os.environ.get("MINIO_SECRET_KEY", "vistaSecretKey2024"),
            config=Config(signature_version="s3v4"),
            region_name="us-east-1",
        )
