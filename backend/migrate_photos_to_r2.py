"""
Move inline base64 profile photos into object storage.

Every `data:` URI in a profile is decoded, uploaded to R2 and replaced by its
URL. Safe to run repeatedly: entries that are already storage URLs are skipped,
and each user is written back only once their photos have all uploaded — a
failure mid-user leaves that profile exactly as it was rather than half moved.

Entries that are neither `data:` nor ours are left alone and reported. The demo
founders carry Unsplash URLs, and rewriting those is not this script's job.

Run:  python migrate_photos_to_r2.py            # report only, changes nothing
      python migrate_photos_to_r2.py --apply    # perform the migration
"""
import asyncio
import base64
import sys

import storage
from database import users_collection, get_utc_now

# data:image/jpeg;base64,AAAA...
PREFIX = "data:"


def decode(entry: str):
    """(bytes, content_type) for a data URI, or None if it is not one."""
    if not entry.startswith(PREFIX):
        return None
    try:
        header, payload = entry.split(",", 1)
        content_type = header[len(PREFIX):].split(";")[0] or "image/jpeg"
        return base64.b64decode(payload), content_type
    except Exception:
        return None


async def main(apply: bool) -> int:
    if not storage.configured():
        print("Object storage is not configured. Missing: "
              + ", ".join(storage.missing_settings()))
        return 1

    cursor = users_collection.find(
        {"profile.photos.0": {"$exists": True}},
        {"_id": 0, "user_id": 1, "profile.photos": 1},
    )

    users = inline = moved = skipped_external = failed = 0

    async for user in cursor:
        users += 1
        photos = (user.get("profile") or {}).get("photos") or []
        new_photos = []
        user_failed = False

        for entry in photos:
            if storage.is_managed_url(entry):
                new_photos.append(entry)
                continue

            decoded = decode(entry)
            if decoded is None:
                # An external URL, or something unparseable. Left as-is.
                skipped_external += 1
                new_photos.append(entry)
                continue

            inline += 1
            if not apply:
                new_photos.append(entry)
                continue

            data, content_type = decoded
            if content_type not in storage.CONTENT_TYPES:
                content_type = "image/jpeg"

            try:
                key = storage.photo_key(user["user_id"], content_type)
                new_photos.append(storage.put_bytes(key, data, content_type))
                moved += 1
            except storage.StorageError as exc:
                print(f"  ! {user['user_id']}: {exc}")
                failed += 1
                user_failed = True
                new_photos.append(entry)

        # Written once per user, and only if all of that user's photos uploaded.
        # Tracking failure per user rather than globally matters: a single bad
        # image should not stop every later profile from being written.
        if apply and not user_failed and new_photos != photos:
            await users_collection.update_one(
                {"user_id": user["user_id"]},
                {"$set": {"profile.photos": new_photos, "updated_at": get_utc_now()}},
            )

    print(f"\nusers with photos : {users}")
    print(f"inline photos     : {inline}")
    print(f"{'moved to storage' if apply else 'would be moved':<18}: {moved if apply else inline}")
    print(f"left as external  : {skipped_external}")
    print(f"failures          : {failed}")
    if not apply:
        print("\nDry run. Re-run with --apply to perform the migration.")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main("--apply" in sys.argv)))
