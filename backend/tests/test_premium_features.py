"""
Backend tests for CoFound Premium features (iteration 5).
Covers:
- AI Copilot chat (real Claude via /api/ai/copilot/chat)
- Profile Update (/api/profile/update partial + cache invalidation)
- Deal Room Tasks (POST + PATCH)
- Match -> Deal Room lookup (/api/matches/{match_id}/deal-room)
"""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://co-builder-1.preview.emergentagent.com").rstrip("/")

TEST_EMAIL = "speed_test@t.com"
TEST_PASSWORD = "test123"


# ---------- Fixtures ----------

@pytest.fixture(scope="session")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def token(api):
    r = api.post(f"{BASE_URL}/api/auth/login",
                 json={"email": TEST_EMAIL, "password": TEST_PASSWORD}, timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="session")
def auth_headers(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture(scope="session")
def current_user(api, auth_headers):
    r = api.get(f"{BASE_URL}/api/auth/me", headers=auth_headers, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


# ---------- Health / smoke ----------

def test_health(api):
    r = api.get(f"{BASE_URL}/api/health", timeout=15)
    assert r.status_code == 200
    assert r.json().get("status") == "healthy"


def test_login_ok(token):
    assert isinstance(token, str) and len(token) > 20


# ---------- Profile update ----------

class TestProfileUpdate:
    def test_partial_update_bio_and_city(self, api, auth_headers, current_user):
        new_bio = f"TEST_bio_{int(time.time())}"
        new_city = f"TEST_City_{int(time.time())}"
        r = api.post(f"{BASE_URL}/api/profile/update",
                     json={"bio": new_bio, "city": new_city},
                     headers=auth_headers, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("profile", {}).get("bio") == new_bio
        assert data.get("profile", {}).get("city") == new_city

        # GET to verify persistence
        r2 = api.get(f"{BASE_URL}/api/auth/me", headers=auth_headers, timeout=15)
        assert r2.status_code == 200
        prof = r2.json().get("profile", {})
        assert prof.get("bio") == new_bio
        assert prof.get("city") == new_city

    def test_partial_update_skills_array(self, api, auth_headers):
        skills = ["Python", "FastAPI", "MongoDB"]
        r = api.post(f"{BASE_URL}/api/profile/update",
                     json={"skills": skills},
                     headers=auth_headers, timeout=30)
        assert r.status_code == 200, r.text
        assert r.json().get("profile", {}).get("skills") == skills

    def test_reject_empty_or_invalid_only(self, api, auth_headers):
        # Fields not in whitelist should be rejected as "no valid fields"
        r = api.post(f"{BASE_URL}/api/profile/update",
                     json={"is_admin": True, "password_hash": "x"},
                     headers=auth_headers, timeout=15)
        assert r.status_code == 400, r.text

    def test_requires_auth(self, api):
        r = api.post(f"{BASE_URL}/api/profile/update",
                     json={"bio": "x"}, timeout=15)
        assert r.status_code in (401, 403)


# ---------- AI Copilot chat ----------

class TestAICopilot:
    def test_copilot_real_claude_response(self, api, auth_headers):
        r = api.post(f"{BASE_URL}/api/ai/copilot/chat",
                     json={"message": "Give me 3 SaaS ideas for solo founders."},
                     headers=auth_headers, timeout=90)
        assert r.status_code == 200, r.text
        body = r.json()
        text = body.get("response", "")
        assert isinstance(text, str) and len(text.strip()) > 50, f"empty AI text: {text!r}"
        # Should not be the old placeholder
        placeholder_marker = "validating the problem"
        assert placeholder_marker.lower() not in text.lower(), "response looks like the old MOCK placeholder"

    def test_copilot_requires_auth(self, api):
        r = api.post(f"{BASE_URL}/api/ai/copilot/chat",
                     json={"message": "hi"}, timeout=30)
        assert r.status_code in (401, 403)


# ---------- Match -> deal room lookup ----------

def _get_first_match_id(api, auth_headers):
    r = api.get(f"{BASE_URL}/api/matches", headers=auth_headers, timeout=15)
    assert r.status_code == 200, r.text
    matches = r.json().get("matches", [])
    return matches[0]["match_id"] if matches else None


class TestDealRoomLookup:
    def test_get_deal_room_by_match(self, api, auth_headers):
        match_id = _get_first_match_id(api, auth_headers)
        if not match_id:
            pytest.skip("no seeded match for speed_test@t.com")
        r = api.get(f"{BASE_URL}/api/matches/{match_id}/deal-room",
                    headers=auth_headers, timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "room" in body  # either None or an object


# ---------- Deal Room Tasks ----------

class TestDealRoomTasks:
    room_id = None

    def test_create_deal_room(self, api, auth_headers):
        match_id = _get_first_match_id(api, auth_headers)
        if not match_id:
            pytest.skip("no seeded match for speed_test@t.com")
        # If one already exists, reuse it
        r_look = api.get(f"{BASE_URL}/api/matches/{match_id}/deal-room",
                         headers=auth_headers, timeout=15)
        assert r_look.status_code == 200
        existing = r_look.json().get("room")
        if existing:
            TestDealRoomTasks.room_id = existing["room_id"]
            return

        r = api.post(f"{BASE_URL}/api/deal-rooms/create",
                     json={"match_id": match_id,
                           "project_name": "TEST_Project",
                           "vision": "TEST_Vision to validate deal room APIs"},
                     headers=auth_headers, timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("room_id")
        assert body.get("project_name") == "TEST_Project"
        assert body.get("vision", "").startswith("TEST_Vision")
        TestDealRoomTasks.room_id = body["room_id"]

    def test_add_task(self, api, auth_headers):
        room_id = TestDealRoomTasks.room_id
        if not room_id:
            pytest.skip("no deal room available")
        r = api.post(f"{BASE_URL}/api/deal-rooms/{room_id}/tasks",
                     json={"title": "TEST_Task_1"},
                     headers=auth_headers, timeout=15)
        assert r.status_code == 200, r.text
        task = r.json()
        assert task.get("task_id")
        assert task.get("title") == "TEST_Task_1"
        assert task.get("completed") is False
        TestDealRoomTasks.task_id = task["task_id"]

        # Verify via GET
        g = api.get(f"{BASE_URL}/api/deal-rooms/{room_id}",
                    headers=auth_headers, timeout=15)
        assert g.status_code == 200
        tasks = g.json().get("tasks", [])
        assert any(t["task_id"] == task["task_id"] for t in tasks)

    def test_toggle_task(self, api, auth_headers):
        room_id = TestDealRoomTasks.room_id
        task_id = getattr(TestDealRoomTasks, "task_id", None)
        if not (room_id and task_id):
            pytest.skip("no task available")
        r = api.patch(f"{BASE_URL}/api/deal-rooms/{room_id}/tasks/{task_id}",
                      headers=auth_headers, timeout=15)
        assert r.status_code == 200, r.text

        # Verify completion flipped to True
        g = api.get(f"{BASE_URL}/api/deal-rooms/{room_id}",
                    headers=auth_headers, timeout=15)
        assert g.status_code == 200
        tasks = g.json().get("tasks", [])
        target = next((t for t in tasks if t["task_id"] == task_id), None)
        assert target is not None
        assert target["completed"] is True

        # Toggle back to False
        r2 = api.patch(f"{BASE_URL}/api/deal-rooms/{room_id}/tasks/{task_id}",
                       headers=auth_headers, timeout=15)
        assert r2.status_code == 200
        g2 = api.get(f"{BASE_URL}/api/deal-rooms/{room_id}",
                     headers=auth_headers, timeout=15)
        target2 = next((t for t in g2.json().get("tasks", []) if t["task_id"] == task_id), None)
        assert target2 and target2["completed"] is False
