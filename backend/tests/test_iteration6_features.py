"""
Iteration 6 tests:
- POST /api/projects/create
- GET  /api/projects
- GET  /api/profile/{user_id}
- Regression: /api/auth/login, /api/discovery/cards, /api/matches
"""
import os
import uuid
import pytest
import requests

# conftest.py skips this suite unless the variable is set, so there is no default.
BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def auth_token(client):
    """Login or register test account and return token."""
    email = "test@cofound.com"
    password = "test123"
    r = client.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password})
    if r.status_code != 200:
        # try to register
        r = client.post(f"{BASE_URL}/api/auth/register", json={
            "email": email, "password": password, "name": "Test User"
        })
        assert r.status_code == 200, f"register failed: {r.status_code} {r.text}"
    data = r.json()
    token = data.get("token") or data.get("access_token")
    assert token, f"no token in response: {data}"
    return token


@pytest.fixture(scope="module")
def me(client, auth_token):
    r = client.get(f"{BASE_URL}/api/auth/me", headers={"Authorization": f"Bearer {auth_token}"})
    assert r.status_code == 200, r.text
    return r.json()


# ---------- Projects ----------

def test_create_project_success(client, auth_token):
    payload = {
        "title": f"TEST_Project_{uuid.uuid4().hex[:6]}",
        "description": "TEST cofounder opportunity",
        "looking_for": "developer",
        "hours_per_week": 20,
        "equity_percentage": 10,
        "skills_needed": ["React", "Node.js"],
    }
    r = client.post(
        f"{BASE_URL}/api/projects/create",
        json=payload,
        headers={"Authorization": f"Bearer {auth_token}"},
    )
    assert r.status_code == 200, f"{r.status_code}: {r.text}"
    body = r.json()
    # returned project should contain the input fields (either directly or under 'project')
    project = body.get("project", body)
    assert project.get("title") == payload["title"]
    assert project.get("looking_for") == "developer"
    assert int(project.get("hours_per_week", -1)) == 20
    # persist project_id for cross-test list check
    pytest.CREATED_PROJECT_TITLE = payload["title"]


def test_get_projects_lists_created(client, auth_token):
    r = client.get(
        f"{BASE_URL}/api/projects?status=open&limit=20",
        headers={"Authorization": f"Bearer {auth_token}"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    projects = body.get("projects", [])
    assert isinstance(projects, list)
    titles = [p.get("title") for p in projects]
    assert getattr(pytest, "CREATED_PROJECT_TITLE", None) in titles, \
        f"created project not returned in list. got: {titles[:5]}"


def test_create_project_missing_fields(client, auth_token):
    # missing required fields -> should be 4xx
    r = client.post(
        f"{BASE_URL}/api/projects/create",
        json={"title": "TEST"},
        headers={"Authorization": f"Bearer {auth_token}"},
    )
    assert r.status_code in (400, 422), f"expected 4xx got {r.status_code}: {r.text}"


# ---------- Profile detail (GET /api/profile/{user_id}) ----------

def test_get_own_profile_by_id(client, auth_token, me):
    user_id = me.get("user_id")
    assert user_id
    r = client.get(
        f"{BASE_URL}/api/profile/{user_id}",
        headers={"Authorization": f"Bearer {auth_token}"},
    )
    assert r.status_code == 200, r.text
    data = r.json()
    # Check top-level and nested shape to inform frontend integration
    assert "user_id" in data
    # Document existence of profile nested vs flat
    has_flat_bio = "bio" in data
    has_nested_profile = isinstance(data.get("profile"), dict)
    print("SHAPE:", {
        "has_flat_bio": has_flat_bio,
        "has_nested_profile": has_nested_profile,
        "top_keys": sorted(list(data.keys()))[:20],
    })
    # Frontend profile detail screen expects flat: profile.name/bio/city/etc
    # Backend returns user doc with profile nested. This assertion documents mismatch.
    if has_nested_profile:
        inner = data["profile"]
        assert "name" in inner or "bio" in inner or "city" in inner


def test_get_profile_not_found(client, auth_token):
    r = client.get(
        f"{BASE_URL}/api/profile/nonexistent_user_id_TEST",
        headers={"Authorization": f"Bearer {auth_token}"},
    )
    assert r.status_code == 404, r.text


def test_get_profile_requires_auth(client):
    r = client.get(f"{BASE_URL}/api/profile/any_id")
    assert r.status_code in (401, 403), r.text


# ---------- Regressions ----------

def test_discovery_cards(client, auth_token):
    r = client.get(
        f"{BASE_URL}/api/discovery/cards?limit=3",
        headers={"Authorization": f"Bearer {auth_token}"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert "cards" in body


def test_matches(client, auth_token):
    r = client.get(
        f"{BASE_URL}/api/matches",
        headers={"Authorization": f"Bearer {auth_token}"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert "matches" in body
