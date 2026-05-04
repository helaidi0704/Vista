"""
VISTA — MinIO / S3 Storage Service
Handles presigned URLs, uploads, bucket initialization.
"""
import os
import boto3
from botocore.config import Config as BotoConfig
from botocore.exceptions import ClientError
from app.core.config import get_settings
import logging

logger = logging.getLogger(__name__)
settings = get_settings()

BUCKETS = [
    settings.minio_bucket_images,
    settings.minio_bucket_models,
    settings.minio_bucket_exports,
]


def get_s3_client():
    """Create a boto3 S3 client pointing to MinIO (internal Docker network)."""
    return boto3.client(
        "s3",
        endpoint_url=f"http://{settings.minio_endpoint}",
        aws_access_key_id=settings.minio_access_key,
        aws_secret_access_key=settings.minio_secret_key,
        config=BotoConfig(signature_version="s3v4"),
        region_name="us-east-1",
    )


def get_public_s3_client():
    """Create a boto3 S3 client using the external IP for presigned URLs."""
    external_ip = os.environ.get("EXTERNAL_IP", "localhost")
    return boto3.client(
        "s3",
        endpoint_url=f"http://{external_ip}:9000",
        aws_access_key_id=settings.minio_access_key,
        aws_secret_access_key=settings.minio_secret_key,
        config=BotoConfig(signature_version="s3v4"),
        region_name="us-east-1",
    )


async def init_buckets():
    """Create default buckets if they don't exist."""
    s3 = get_s3_client()
    for bucket in BUCKETS:
        try:
            s3.head_bucket(Bucket=bucket)
            logger.info(f"Bucket '{bucket}' exists")
        except ClientError:
            s3.create_bucket(Bucket=bucket)
            logger.info(f"Bucket '{bucket}' created")


def generate_presigned_url(bucket: str, key: str, expires_in: int = 3600) -> str:
    """Generate a presigned GET URL using external IP (for browser access)."""
    s3 = get_public_s3_client()
    return s3.generate_presigned_url(
        "get_object",
        Params={"Bucket": bucket, "Key": key},
        ExpiresIn=expires_in,
    )


def generate_upload_url(bucket: str, key: str, content_type: str = "image/jpeg", expires_in: int = 3600) -> str:
    """Generate a presigned PUT URL using external IP."""
    s3 = get_public_s3_client()
    return s3.generate_presigned_url(
        "put_object",
        Params={"Bucket": bucket, "Key": key, "ContentType": content_type},
        ExpiresIn=expires_in,
    )
