"""
Response shaping tests.

The existing suites all talk to a deployed preview URL with hardcoded accounts, so
nothing could be verified locally or in CI. This one has no dependencies at all.

Run with: pytest backend/tests -o addopts=''
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from serializers import private_user, public_user, public_users  # noqa: E402


FULL_USER = {
    "_id": "mongo-object-id",
    "user_id": "user_abc123",
    "email": "founder@example.com",
    "password_hash": "$2b$12$hash",
    "google_id": "google-1234",
    "profile": {"name": "Sarah Chen", "age": 28, "city": "San Francisco", "skills": ["React"]},
    "premium": True,
    "premium_plan": "lifetime",
    "verification": {"email_verified": True},
    "gamification": {"level": 3, "badges": ["builder"]},
    "settings": {"show_age": True, "notifications_enabled": True},
    "daily_swipes_used": 7,
    "daily_swipes_date": "2026-07-30",
    "onboarding_completed": True,
}


class TestPublicUser:
    def test_never_leaks_credentials_or_contact_details(self):
        shaped = public_user(FULL_USER)

        # Email leaked through every discovery card and match before this existed.
        for forbidden in ("email", "password_hash", "google_id", "_id"):
            assert forbidden not in shaped, f"{forbidden} must not be exposed to other users"

    def test_hides_internal_bookkeeping(self):
        shaped = public_user(FULL_USER)
        for forbidden in ("daily_swipes_used", "daily_swipes_date", "settings", "premium_plan"):
            assert forbidden not in shaped

    def test_keeps_what_the_ui_renders(self):
        shaped = public_user(FULL_USER)
        assert shaped["user_id"] == "user_abc123"
        assert shaped["profile"]["name"] == "Sarah Chen"
        assert shaped["profile"]["skills"] == ["React"]
        # Drives the premium badge on cards, matches and public profiles
        assert shaped["premium"] is True
        assert shaped["verification"] == {"email_verified": True}
        assert shaped["gamification"]["level"] == 3

    def test_honours_show_age_preference(self):
        hidden = {**FULL_USER, "settings": {"show_age": False}}
        assert "age" not in public_user(hidden)["profile"]
        # The preference was stored but never applied before
        assert public_user(FULL_USER)["profile"]["age"] == 28

    def test_missing_show_age_defaults_to_visible(self):
        no_settings = {k: v for k, v in FULL_USER.items() if k != "settings"}
        assert public_user(no_settings)["profile"]["age"] == 28

    def test_premium_defaults_to_false(self):
        no_premium = {k: v for k, v in FULL_USER.items() if k != "premium"}
        assert public_user(no_premium)["premium"] is False

    def test_does_not_mutate_the_source_document(self):
        source = {**FULL_USER, "settings": {"show_age": False}}
        public_user(source)
        assert source["profile"]["age"] == 28

    def test_none_passes_through(self):
        assert public_user(None) is None

    def test_public_users_drops_unloadable_entries(self):
        assert public_users([FULL_USER, None]) == [public_user(FULL_USER)]


class TestPrivateUser:
    def test_keeps_own_email_and_settings(self):
        shaped = private_user(FULL_USER)
        assert shaped["email"] == "founder@example.com"
        assert shaped["settings"]["notifications_enabled"] is True

    def test_exposes_premium_for_the_paywall_ui(self):
        assert private_user(FULL_USER)["premium"] is True

    def test_still_strips_secrets_and_counters(self):
        shaped = private_user(FULL_USER)
        for forbidden in (
            "password_hash", "google_id", "_id", "daily_swipes_used", "daily_swipes_date",
        ):
            assert forbidden not in shaped

    def test_none_passes_through(self):
        assert private_user(None) is None
