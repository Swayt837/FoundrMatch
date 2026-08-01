"""
Object storage: key derivation, URL ownership, and what a photo list will accept.

The ownership check is the security-relevant one. Photo fields hold URLs, so if
anything other than our own storage were accepted, a client could point a
profile at a third-party server and turn every viewer into a request that leaks
their IP address to it.
"""
import pytest
from pydantic import ValidationError

import storage
from models import PhotosUpload

BASE = "https://cdn.example.test"


@pytest.fixture
def configured(monkeypatch):
    """A fully configured storage layer, without touching the network."""
    monkeypatch.setattr(storage, "R2_ACCOUNT_ID", "acct")
    monkeypatch.setattr(storage, "R2_ACCESS_KEY_ID", "key")
    monkeypatch.setattr(storage, "R2_SECRET_ACCESS_KEY", "secret")
    monkeypatch.setattr(storage, "R2_BUCKET", "bucket")
    monkeypatch.setattr(storage, "R2_PUBLIC_BASE_URL", BASE)
    monkeypatch.setattr(storage, "_client", None)
    return storage


# ===== configuration =====

def test_unconfigured_reports_every_missing_setting(monkeypatch):
    for name in ("R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY",
                 "R2_BUCKET", "R2_PUBLIC_BASE_URL"):
        monkeypatch.setattr(storage, name, "")

    assert storage.configured() is False
    assert len(storage.missing_settings()) == 5


def test_partial_configuration_is_not_configured(monkeypatch, configured):
    monkeypatch.setattr(storage, "R2_BUCKET", "")

    assert storage.configured() is False
    assert storage.missing_settings() == ["R2_BUCKET"]


# ===== keys =====

def test_photo_key_is_namespaced_and_unpredictable(configured):
    a = storage.photo_key("user_abc", "image/jpeg")
    b = storage.photo_key("user_abc", "image/jpeg")

    assert a.startswith("profiles/user_abc/")
    assert a.endswith(".jpg")
    # Sequential keys would let anyone enumerate a user's photos.
    assert a != b


def test_extension_comes_from_the_declared_type(configured):
    assert storage.photo_key("u", "image/png").endswith(".png")
    assert storage.photo_key("u", "image/webp").endswith(".webp")


def test_presign_rejects_types_outside_the_allowlist(configured):
    with pytest.raises(storage.StorageError, match="Unsupported image type"):
        storage.presign_photo_upload("user_abc", "image/svg+xml")


# ===== URL ownership =====

def test_managed_url_recognises_only_our_own_origin(configured):
    assert storage.is_managed_url(f"{BASE}/profiles/u/x.jpg") is True
    assert storage.is_managed_url("https://evil.test/x.jpg") is False
    # A prefix match alone is not enough: this host is not ours.
    assert storage.is_managed_url(f"{BASE}.evil.test/x.jpg") is False


def test_nothing_is_managed_when_storage_is_unconfigured(monkeypatch):
    monkeypatch.setattr(storage, "R2_PUBLIC_BASE_URL", "")
    assert storage.is_managed_url("https://anything.test/x.jpg") is False


def test_key_of_round_trips(configured):
    key = "profiles/user_abc/deadbeef.jpg"
    assert storage.key_of(f"{BASE}/{key}") == key
    assert storage.key_of("https://evil.test/x.jpg") is None


# ===== what a profile will store =====

def test_storage_urls_are_accepted(configured):
    photos = [f"{BASE}/profiles/u/a.jpg", f"{BASE}/profiles/u/b.png"]
    assert PhotosUpload(photos=photos).photos == photos


def test_inline_images_still_work_without_storage(monkeypatch):
    monkeypatch.setattr(storage, "R2_PUBLIC_BASE_URL", "")
    inline = "data:image/jpeg;base64,AAAA"

    assert PhotosUpload(photos=[inline]).photos == [inline]


def test_external_urls_are_refused(configured):
    with pytest.raises(ValidationError, match="external URLs are not accepted"):
        PhotosUpload(photos=["https://evil.test/tracker.jpg"])


def test_oversized_inline_image_is_refused(configured):
    with pytest.raises(ValidationError, match="under ~2MB"):
        PhotosUpload(photos=["data:image/jpeg;base64," + "A" * 3_000_001])


def test_inline_total_is_capped(configured):
    one = "data:image/jpeg;base64," + "A" * 2_900_000
    with pytest.raises(ValidationError, match="too large in total"):
        PhotosUpload(photos=[one, one, one, one])


def test_storage_urls_do_not_count_towards_the_inline_cap(configured):
    """Five stored photos are fine; the cap exists for document size only."""
    photos = [f"{BASE}/profiles/u/{i}.jpg" for i in range(5)]
    assert len(PhotosUpload(photos=photos).photos) == 5


def test_more_than_five_photos_is_refused(configured):
    with pytest.raises(ValidationError):
        PhotosUpload(photos=[f"{BASE}/profiles/u/{i}.jpg" for i in range(6)])

def test_endpoint_defaults_to_the_global_hostname(configured):
    assert storage.endpoint() == "https://acct.r2.cloudflarestorage.com"


def test_endpoint_override_wins(monkeypatch, configured):
    monkeypatch.setattr(storage, "R2_ENDPOINT", "https://acct.eu.r2.cloudflarestorage.com")
    assert storage.endpoint() == "https://acct.eu.r2.cloudflarestorage.com"
