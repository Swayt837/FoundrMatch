"""
Iteration 8 backend tests: Premium (Stripe) + Discovery/Projects filters.
Uses test@cofound.com / test123. Uses EXPO_PUBLIC_BACKEND_URL.
"""
import os
import time
import pytest
import requests
from motor.motor_asyncio import AsyncIOMotorClient
import asyncio

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL").rstrip("/")
TEST_EMAIL = "test@cofound.com"
TEST_PASSWORD = "test123"

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = "cofound_db"  # NOTE: backend/database.py hardcodes client.cofound_db (ignores DB_NAME env)


# ----- Fixtures -----

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
def me(api, auth_headers):
    r = api.get(f"{BASE_URL}/api/auth/me", headers=auth_headers, timeout=15)
    assert r.status_code == 200
    return r.json()


# Helper: async mongo access to reset premium flag / swipes
async def _mongo_update_user(user_id, set_op=None, unset_op=None):
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]
    ops = {}
    if set_op:
        ops["$set"] = set_op
    if unset_op:
        ops["$unset"] = unset_op
    await db.users.update_one({"user_id": user_id}, ops)
    client.close()


async def _mongo_delete_txn(session_id):
    client = AsyncIOMotorClient(MONGO_URL)
    await client[DB_NAME].payment_transactions.delete_one({"session_id": session_id})
    client.close()


async def _mongo_find_txn(session_id):
    client = AsyncIOMotorClient(MONGO_URL)
    doc = await client[DB_NAME].payment_transactions.find_one({"session_id": session_id}, {"_id": 0})
    client.close()
    return doc


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro) if not asyncio.get_event_loop().is_running() \
        else asyncio.new_event_loop().run_until_complete(coro)


# ----- Reset user state before session -----
@pytest.fixture(scope="session", autouse=True)
def reset_user_state(me):
    """Clear premium & swipe counters before starting."""
    async def _reset():
        client = AsyncIOMotorClient(MONGO_URL)
        db = client[DB_NAME]
        await db.users.update_one(
            {"user_id": me["user_id"]},
            {"$set": {"premium": False, "daily_swipes_used": 0, "daily_swipes_date": None},
             "$unset": {"premium_plan": "", "premium_since": ""}},
        )
        # Also clear existing swipes to allow fresh limit testing
        await db.swipes.delete_many({"user_id": me["user_id"]})
        client.close()

    asyncio.new_event_loop().run_until_complete(_reset())
    yield


# ============ Premium checkout ============

class TestPremiumCheckout:
    lifetime_session_id = None
    monthly_session_id = None

    def test_lifetime_checkout_creates_session(self, api, auth_headers):
        r = api.post(f"{BASE_URL}/api/premium/checkout",
                     json={"plan": "lifetime", "origin_url": "https://example.com"},
                     headers=auth_headers, timeout=30)
        assert r.status_code == 200, f"got {r.status_code}: {r.text}"
        body = r.json()
        assert "url" in body and body["url"].startswith("http")
        assert "session_id" in body and body["session_id"]
        TestPremiumCheckout.lifetime_session_id = body["session_id"]

        # Verify txn recorded as pending
        txn = asyncio.new_event_loop().run_until_complete(_mongo_find_txn(body["session_id"]))
        assert txn is not None, "payment_transactions record not created"
        assert txn["payment_status"] == "pending"
        assert txn["plan"] == "lifetime"
        assert txn["amount"] == 29.00

    def test_monthly_checkout_creates_session(self, api, auth_headers):
        r = api.post(f"{BASE_URL}/api/premium/checkout",
                     json={"plan": "monthly", "origin_url": "https://example.com"},
                     headers=auth_headers, timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["url"].startswith("http")
        TestPremiumCheckout.monthly_session_id = body["session_id"]

    def test_invalid_plan_returns_400(self, api, auth_headers):
        r = api.post(f"{BASE_URL}/api/premium/checkout",
                     json={"plan": "invalid_x", "origin_url": "https://example.com"},
                     headers=auth_headers, timeout=15)
        assert r.status_code == 400, r.text

    def test_status_own_session_ok(self, api, auth_headers):
        sid = TestPremiumCheckout.lifetime_session_id
        if not sid:
            pytest.skip("no session created")
        r = api.get(f"{BASE_URL}/api/premium/status/{sid}", headers=auth_headers, timeout=30)
        # Might be 200 with status='open' since not paid; accept any 2xx
        assert r.status_code == 200, r.text
        body = r.json()
        assert "payment_status" in body
        assert body["payment_status"] in ("unpaid", "no_payment_required", "paid", "pending", "open")

    def test_status_other_user_session_forbidden(self, api, auth_headers):
        """Simulate: create a txn for another user and try to access it → 403."""
        fake_sid = f"cs_test_fake_{int(time.time())}"

        async def _seed():
            client = AsyncIOMotorClient(MONGO_URL)
            await client[DB_NAME].payment_transactions.insert_one({
                "session_id": fake_sid,
                "user_id": "SOMEBODY_ELSE",
                "plan": "lifetime",
                "amount": 29.0,
                "currency": "usd",
                "payment_status": "pending",
                "status": "open",
            })
            client.close()

        asyncio.new_event_loop().run_until_complete(_seed())
        r = api.get(f"{BASE_URL}/api/premium/status/{fake_sid}", headers=auth_headers, timeout=15)
        assert r.status_code == 403, r.text
        # cleanup
        asyncio.new_event_loop().run_until_complete(_mongo_delete_txn(fake_sid))


# ============ /premium/me + swipe limit ============

class TestPremiumMeAndLimit:
    def test_premium_me_default_free(self, api, auth_headers):
        r = api.get(f"{BASE_URL}/api/premium/me", headers=auth_headers, timeout=15)
        assert r.status_code == 200
        b = r.json()
        assert b["premium"] is False
        assert b["daily_swipes_limit"] == 10
        assert b["remaining_swipes"] >= 0

    def test_swipe_decrements_remaining(self, api, auth_headers, me):
        # Fetch discovery cards
        r = api.get(f"{BASE_URL}/api/discovery/cards?limit=3",
                    headers=auth_headers, timeout=60)
        assert r.status_code == 200
        cards = r.json().get("cards", [])
        if not cards:
            pytest.skip("no discovery cards available")

        before = api.get(f"{BASE_URL}/api/premium/me", headers=auth_headers, timeout=15).json()
        before_remaining = before["remaining_swipes"]

        # Do one left-swipe
        target = cards[0]["user"]["user_id"]
        sr = api.post(f"{BASE_URL}/api/swipe",
                      json={"target_user_id": target, "direction": "left"},
                      headers=auth_headers, timeout=15)
        assert sr.status_code == 200, sr.text

        after = api.get(f"{BASE_URL}/api/premium/me", headers=auth_headers, timeout=15).json()
        assert after["remaining_swipes"] == before_remaining - 1
        assert after["daily_swipes_used"] == before["daily_swipes_used"] + 1

    def test_daily_limit_402(self, api, auth_headers, me):
        # Force user to 10 swipes today
        today = time.strftime("%Y-%m-%d")

        async def _set_limit():
            client = AsyncIOMotorClient(MONGO_URL)
            await client[DB_NAME].users.update_one(
                {"user_id": me["user_id"]},
                {"$set": {"daily_swipes_used": 10, "daily_swipes_date": today, "premium": False}},
            )
            client.close()

        asyncio.new_event_loop().run_until_complete(_set_limit())

        # Any swipe must now 402
        # Use a random target; even if invalid, limit check runs first
        sr = api.post(f"{BASE_URL}/api/swipe",
                      json={"target_user_id": "user_does_not_exist_xyz", "direction": "left"},
                      headers=auth_headers, timeout=15)
        assert sr.status_code == 402, f"expected 402, got {sr.status_code}: {sr.text}"
        assert "daily swipe limit" in sr.text.lower()

    def test_premium_bypasses_limit(self, api, auth_headers, me):
        today = time.strftime("%Y-%m-%d")

        async def _make_premium():
            client = AsyncIOMotorClient(MONGO_URL)
            await client[DB_NAME].users.update_one(
                {"user_id": me["user_id"]},
                {"$set": {"premium": True, "daily_swipes_used": 10, "daily_swipes_date": today}},
            )
            client.close()

        asyncio.new_event_loop().run_until_complete(_make_premium())

        # /premium/me shows premium:true, remaining_swipes:null
        r = api.get(f"{BASE_URL}/api/premium/me", headers=auth_headers, timeout=15)
        b = r.json()
        assert b["premium"] is True
        assert b["remaining_swipes"] is None
        assert b["daily_swipes_limit"] is None

        # Get a real discover card & swipe past the limit
        r = api.get(f"{BASE_URL}/api/discovery/cards?limit=3",
                    headers=auth_headers, timeout=60)
        cards = r.json().get("cards", [])
        if cards:
            target = cards[0]["user"]["user_id"]
            sr = api.post(f"{BASE_URL}/api/swipe",
                          json={"target_user_id": target, "direction": "left"},
                          headers=auth_headers, timeout=15)
            assert sr.status_code == 200, f"premium user should bypass 402: {sr.status_code} {sr.text}"

    def test_reset_free_after(self, me):
        """Cleanup: return the test user to free with 0 swipes."""
        async def _reset():
            client = AsyncIOMotorClient(MONGO_URL)
            await client[DB_NAME].users.update_one(
                {"user_id": me["user_id"]},
                {"$set": {"premium": False, "daily_swipes_used": 0, "daily_swipes_date": None},
                 "$unset": {"premium_plan": "", "premium_since": ""}},
            )
            client.close()
        asyncio.new_event_loop().run_until_complete(_reset())


# ============ Discovery filters ============

class TestDiscoveryFilters:
    def test_no_filter_sorted(self, api, auth_headers):
        r = api.get(f"{BASE_URL}/api/discovery/cards?limit=10",
                    headers=auth_headers, timeout=90)
        assert r.status_code == 200
        cards = r.json().get("cards", [])
        # Verify sort: premium first, then compat score desc
        prev_key = None
        for c in cards:
            is_prem = 1 if c["user"].get("premium") else 0
            score = c["compatibility"]["overall_score"]
            key = (-is_prem, -score)
            if prev_key is not None:
                assert key >= prev_key, f"sort broken: prev={prev_key} cur={key}"
            prev_key = key

    def test_profession_filter(self, api, auth_headers):
        r = api.get(f"{BASE_URL}/api/discovery/cards?profession=developer&limit=10",
                    headers=auth_headers, timeout=90)
        assert r.status_code == 200
        cards = r.json().get("cards", [])
        for c in cards:
            assert c["user"]["profile"]["profession"] == "developer", \
                f"non-developer leaked: {c['user']['profile'].get('profession')}"

    def test_profession_availability_filter(self, api, auth_headers):
        r = api.get(f"{BASE_URL}/api/discovery/cards?profession=developer&availability=full_time&limit=10",
                    headers=auth_headers, timeout=90)
        assert r.status_code == 200
        cards = r.json().get("cards", [])
        for c in cards:
            p = c["user"]["profile"]
            assert p["profession"] == "developer"
            assert p["availability"] == "full_time"


# ============ Projects filters ============

class TestProjectFilters:
    seeded_ids = []

    @classmethod
    def teardown_class(cls):
        async def _clean():
            client = AsyncIOMotorClient(MONGO_URL)
            await client[DB_NAME].projects.delete_many({"project_id": {"$in": cls.seeded_ids}})
            client.close()
        if cls.seeded_ids:
            asyncio.new_event_loop().run_until_complete(_clean())

    def _create(self, api, auth_headers, **kwargs):
        payload = {
            "title": f"TEST_iter8_{int(time.time() * 1000)}",
            "description": "iter8 filter seed",
            "looking_for": "designer",
            "hours_per_week": 20,
            "equity_percentage": 10.0,
            "skills_needed": ["Figma"],
        }
        payload.update(kwargs)
        r = api.post(f"{BASE_URL}/api/projects/create", json=payload,
                     headers=auth_headers, timeout=15)
        assert r.status_code == 200, r.text
        pid = r.json()["project_id"]
        TestProjectFilters.seeded_ids.append(pid)
        return r.json()

    def test_seed_and_filter(self, api, auth_headers):
        # 3 seeds: designer 20h/10%; developer 40h/25%; designer 5h/30%
        self._create(api, auth_headers, looking_for="designer", hours_per_week=20, equity_percentage=10.0)
        self._create(api, auth_headers, looking_for="developer", hours_per_week=40, equity_percentage=25.0)
        self._create(api, auth_headers, looking_for="designer", hours_per_week=5, equity_percentage=30.0)

        # Filter: designer + min_equity=5 max_equity=20 min_hours=10 max_hours=30
        r = api.get(f"{BASE_URL}/api/projects"
                    f"?looking_for=designer&min_equity=5&max_equity=20&min_hours=10&max_hours=30",
                    headers=auth_headers, timeout=15)
        assert r.status_code == 200
        projs = r.json()["projects"]
        # None of the 3 seeded should violate; and the third designer (5h/30%) should NOT appear
        for p in projs:
            assert p["looking_for"] == "designer", p
            assert 5 <= p["equity_percentage"] <= 20, p
            assert 10 <= p["hours_per_week"] <= 30, p

    def test_my_city_only(self, api, auth_headers, me):
        # Set my city, create a project matching
        my_city = "TESTCITY_iter8"

        async def _set_city():
            client = AsyncIOMotorClient(MONGO_URL)
            await client[DB_NAME].users.update_one(
                {"user_id": me["user_id"]},
                {"$set": {"profile.city": my_city}},
            )
            client.close()
        asyncio.new_event_loop().run_until_complete(_set_city())

        self._create(api, auth_headers, looking_for="marketer", hours_per_week=15, equity_percentage=12.0)

        r = api.get(f"{BASE_URL}/api/projects?my_city_only=true&limit=50",
                    headers=auth_headers, timeout=15)
        assert r.status_code == 200
        projs = r.json()["projects"]
        # All returned projects must be from users in TESTCITY_iter8 (which is only me)
        for p in projs:
            assert p["user_id"] == me["user_id"], \
                f"my_city_only leaked non-me project from user {p['user_id']}"


# ============ Health smoke ============

def test_health(api):
    r = api.get(f"{BASE_URL}/api/health", timeout=10)
    assert r.status_code == 200
