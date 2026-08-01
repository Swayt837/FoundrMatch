"""
Object storage for user images (Cloudflare R2).

Photos used to live inside the user document as base64. That works until it
doesn't: every discovery card carried its images in full inside the JSON
response, and MongoDB's 16 MB document ceiling put a hard cap on how many a
profile could hold. Moving them out makes cards cheap to serve and lifts the
cap entirely.

Uploads are **presigned**: the client asks for a URL, then sends the bytes
straight to R2. The API never touches image data, which matters on a small
instance — proxying a 2 MB upload through it would occupy a worker for the
whole transfer.

R2 speaks the S3 API, so boto3 drives it unchanged; only the endpoint differs.

Unconfigured is a supported state. `configured()` is false until all five
variables are set, the upload route answers 503, and the client falls back to
base64 — the same graceful degradation Stripe, Google sign-in and Claude
already use here.
"""
import os
import uuid
from typing import Dict, Optional, Tuple

import boto3
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError

R2_ACCOUNT_ID = os.getenv("R2_ACCOUNT_ID", "")
R2_ACCESS_KEY_ID = os.getenv("R2_ACCESS_KEY_ID", "")
R2_SECRET_ACCESS_KEY = os.getenv("R2_SECRET_ACCESS_KEY", "")
R2_BUCKET = os.getenv("R2_BUCKET", "")
# Public origin the bucket is served from, e.g. https://cdn.example.com
R2_PUBLIC_BASE_URL = os.getenv("R2_PUBLIC_BASE_URL", "").rstrip("/")

# Long enough to survive a slow mobile connection, short enough that a leaked
# URL is worthless by the time anyone finds it.
UPLOAD_URL_TTL = 300

# Only formats every target decodes natively. The extension is derived from the
# declared type rather than from a client-supplied filename, which is how
# ".jpg.exe" style tricks get in.
CONTENT_TYPES = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
}

MAX_UPLOAD_BYTES = 5 * 1024 * 1024


class StorageError(RuntimeError):
    """Raised when R2 rejects an operation."""


def configured() -> bool:
    """True when every piece needed to sign and serve an upload is present."""
    return all([
        R2_ACCOUNT_ID,
        R2_ACCESS_KEY_ID,
        R2_SECRET_ACCESS_KEY,
        R2_BUCKET,
        R2_PUBLIC_BASE_URL,
    ])


def missing_settings() -> list:
    """Which variables are absent — surfaced so misconfiguration is diagnosable."""
    present = {
        "R2_ACCOUNT_ID": R2_ACCOUNT_ID,
        "R2_ACCESS_KEY_ID": R2_ACCESS_KEY_ID,
        "R2_SECRET_ACCESS_KEY": R2_SECRET_ACCESS_KEY,
        "R2_BUCKET": R2_BUCKET,
        "R2_PUBLIC_BASE_URL": R2_PUBLIC_BASE_URL,
    }
    return [name for name, value in present.items() if not value]


_client = None


def client():
    """
    Cached S3 client pointed at R2.

    `signature_version="s3v4"` is required — R2 rejects the older scheme — and
    the region is literally "auto": R2 has no regions but boto3 insists on one.
    """
    global _client
    if _client is None:
        if not configured():
            raise StorageError(
                "Object storage is not configured: " + ", ".join(missing_settings())
            )
        _client = boto3.client(
            "s3",
            endpoint_url=f"https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com",
            aws_access_key_id=R2_ACCESS_KEY_ID,
            aws_secret_access_key=R2_SECRET_ACCESS_KEY,
            region_name="auto",
            config=Config(signature_version="s3v4", retries={"max_attempts": 3}),
        )
    return _client


def public_url(key: str) -> str:
    return f"{R2_PUBLIC_BASE_URL}/{key}"


def is_managed_url(value: str) -> bool:
    """
    Whether a string is a URL this deployment produced.

    Photo fields accept URLs, so without this check a client could store any
    address it liked in a profile — turning every viewer of that profile into a
    request to a third-party server, complete with their IP address.
    """
    if not R2_PUBLIC_BASE_URL:
        return False
    return value.startswith(R2_PUBLIC_BASE_URL + "/")


def photo_key(user_id: str, content_type: str) -> str:
    """
    Storage key for one profile photo.

    Random rather than sequential: keys are visible in the URL, and predictable
    ones let anyone enumerate a user's photos by counting upwards.
    """
    extension = CONTENT_TYPES[content_type]
    return f"profiles/{user_id}/{uuid.uuid4().hex}.{extension}"


def presign_photo_upload(user_id: str, content_type: str) -> Dict[str, object]:
    """
    A one-shot URL the client can PUT a single image to.

    `ContentType` is part of what gets signed, so the client must send back the
    same header — it cannot declare a JPEG and upload something else.
    """
    if content_type not in CONTENT_TYPES:
        raise StorageError(
            f"Unsupported image type {content_type!r}; "
            f"expected one of {', '.join(sorted(CONTENT_TYPES))}"
        )

    key = photo_key(user_id, content_type)
    try:
        url = client().generate_presigned_url(
            "put_object",
            Params={"Bucket": R2_BUCKET, "Key": key, "ContentType": content_type},
            ExpiresIn=UPLOAD_URL_TTL,
        )
    except (BotoCoreError, ClientError) as exc:
        raise StorageError(f"Could not sign upload: {exc}") from exc

    return {
        "upload_url": url,
        "public_url": public_url(key),
        "key": key,
        "expires_in": UPLOAD_URL_TTL,
        "headers": {"Content-Type": content_type},
        "max_bytes": MAX_UPLOAD_BYTES,
    }


def put_bytes(key: str, data: bytes, content_type: str) -> str:
    """
    Upload directly from the server.

    Used by the migration, which already holds the decoded bytes and has no
    client to hand a signed URL to. Not used by the request path.
    """
    try:
        client().put_object(
            Bucket=R2_BUCKET, Key=key, Body=data, ContentType=content_type
        )
    except (BotoCoreError, ClientError) as exc:
        raise StorageError(f"Upload failed for {key}: {exc}") from exc
    return public_url(key)


def delete(key: str) -> None:
    """Best-effort removal; a missing object is not an error worth raising."""
    try:
        client().delete_object(Bucket=R2_BUCKET, Key=key)
    except (BotoCoreError, ClientError):
        pass


def key_of(url: str) -> Optional[str]:
    """The storage key behind a managed URL, or None if it is not one of ours."""
    if not is_managed_url(url):
        return None
    return url[len(R2_PUBLIC_BASE_URL) + 1:]
