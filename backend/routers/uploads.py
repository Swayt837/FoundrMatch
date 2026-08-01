"""
Signed upload URLs for user images.

The client asks here for permission to upload, then sends the bytes straight to
R2. Two reasons the API stays out of the transfer: a 2 MB upload proxied through
a small instance holds a worker for its whole duration, and object storage is
better at receiving files than we are.

What this endpoint is really doing is authorisation. Anyone can PUT to the
returned URL, so the checks that matter happen before it is issued — the caller
must be authenticated, the key is namespaced to their own user id, the content
type is validated against an allowlist and baked into the signature, and the URL
expires in minutes.
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

import storage
from auth import get_current_user
from rate_limit import RateLimiter

router = APIRouter(prefix="/api", tags=["uploads"])


class PhotoUploadRequest(BaseModel):
    # Declared by the client and signed into the URL, so it cannot be swapped
    # for something else at upload time.
    content_type: str = "image/jpeg"


@router.post(
    "/uploads/photo",
    dependencies=[Depends(RateLimiter("uploads", limit=40, window=60))],
)
async def create_photo_upload(
    payload: PhotoUploadRequest,
    current_user: dict = Depends(get_current_user),
):
    """
    Authorise one image upload and return where to send it.

    503 rather than 500 when storage is unconfigured: it is a deployment that
    has not been set up, not a failure, and the client reads that status as
    "fall back to inline base64" so the app keeps working either way.
    """
    if not storage.configured():
        raise HTTPException(
            status_code=503,
            detail=(
                "Object storage is not configured on this server. Missing: "
                + ", ".join(storage.missing_settings())
            ),
        )

    try:
        return storage.presign_photo_upload(
            current_user["user_id"], payload.content_type
        )
    except storage.StorageError as exc:
        # An unsupported content type is the caller's mistake; anything else
        # coming out of here is ours.
        status = 400 if "Unsupported image type" in str(exc) else 502
        raise HTTPException(status_code=status, detail=str(exc))


@router.get("/uploads/config")
async def upload_config(current_user: dict = Depends(get_current_user)):
    """
    Whether uploads are available, so the client can choose its path before
    picking an image rather than discovering it mid-flow.
    """
    return {
        "storage_configured": storage.configured(),
        "accepted_types": sorted(storage.CONTENT_TYPES),
        "max_bytes": storage.MAX_UPLOAD_BYTES,
    }
