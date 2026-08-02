"""
Showcase validation: what a founder is allowed to put on their profile.

Two rules carry weight here. Only our own storage URLs are accepted, for the
same reason as profile photos — an arbitrary URL in a profile turns everyone who
views it into a request to a stranger's server, carrying their IP. And a video
must arrive with a thumbnail, or a gallery grid has to download video files to
draw itself.
"""
import pytest
from pydantic import ValidationError

import storage
from models import ShowcaseItem, ShowcaseUpdate

BASE = "https://cdn.example.test"


@pytest.fixture
def configured(monkeypatch):
    monkeypatch.setattr(storage, "R2_PUBLIC_BASE_URL", BASE)
    return storage


def image(name="shot.png", **kwargs):
    return {"url": f"{BASE}/showcase/u/{name}", **kwargs}


def video(name="demo.mp4", **kwargs):
    return {
        "url": f"{BASE}/showcase/u/{name}",
        "thumbnail_url": f"{BASE}/showcase/u/poster.jpg",
        **kwargs,
    }


# ===== kind is derived, not declared =====

def test_kind_comes_from_the_url(configured):
    assert ShowcaseItem(**image()).kind == "image"
    assert ShowcaseItem(**video()).kind == "video"
    # Query strings must not fool the check.
    assert ShowcaseItem(**video(name="demo.mov?v=2")).kind == "video"


def test_uppercase_extensions_still_count_as_video(configured):
    assert ShowcaseItem(**video(name="DEMO.MP4")).kind == "video"


# ===== ownership =====

def test_external_urls_are_refused(configured):
    with pytest.raises(ValidationError, match="uploaded through"):
        ShowcaseUpdate(items=[{"url": "https://evil.test/tracker.gif"}])


def test_external_thumbnails_are_refused(configured):
    item = video()
    item["thumbnail_url"] = "https://evil.test/poster.jpg"
    with pytest.raises(ValidationError, match="Thumbnails"):
        ShowcaseUpdate(items=[item])


# ===== video rules =====

def test_video_without_a_thumbnail_is_refused(configured):
    with pytest.raises(ValidationError, match="needs a thumbnail"):
        ShowcaseUpdate(items=[{"url": f"{BASE}/showcase/u/demo.mp4"}])


def test_long_videos_are_refused(configured):
    with pytest.raises(ValidationError, match="under 60 seconds"):
        ShowcaseUpdate(items=[video(duration_seconds=90)])


def test_a_short_video_is_accepted(configured):
    result = ShowcaseUpdate(items=[video(duration_seconds=18.4)])
    assert result.items[0].kind == "video"


def test_an_image_needs_no_thumbnail(configured):
    assert ShowcaseUpdate(items=[image()]).items[0].thumbnail_url is None


# ===== list limits =====

def test_eight_items_is_the_cap(configured):
    ShowcaseUpdate(items=[image(f"{i}.png") for i in range(8)])

    with pytest.raises(ValidationError):
        ShowcaseUpdate(items=[image(f"{i}.png") for i in range(9)])


def test_captions_are_bounded(configured):
    ShowcaseUpdate(items=[image(caption="Our landing page after the rewrite")])

    with pytest.raises(ValidationError):
        ShowcaseUpdate(items=[image(caption="x" * 141)])


def test_an_empty_showcase_is_valid(configured):
    """Removing everything has to be expressible, since this is a whole-list PUT."""
    assert ShowcaseUpdate(items=[]).items == []
