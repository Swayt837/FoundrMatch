"""
Entitlement tests.

`premium_active` decides who gets deal rooms, the copilot, the deep report,
unlimited swipes and the discovery boost. Reading the raw `premium` boolean instead
would keep a cancelled or lapsed subscriber premium forever, so the expiry logic is
worth pinning down.

Run with: pytest backend/tests -o addopts=''
"""
import os
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from entitlements import (  # noqa: E402
    FREE_DAILY_SWIPES,
    FREE_MAX_MATCHES,
    premium_active,
)

FUTURE = datetime.now(timezone.utc) + timedelta(days=10)
PAST = datetime.now(timezone.utc) - timedelta(days=1)


class TestFreeUser:
    def test_no_premium_field(self):
        assert premium_active({}) is False

    def test_premium_false(self):
        assert premium_active({"premium": False}) is False

    def test_none_user(self):
        assert premium_active(None) is False

    def test_expiry_without_premium_flag_grants_nothing(self):
        assert premium_active({"premium": False, "premium_expires_at": FUTURE}) is False


class TestLifetime:
    def test_no_expiry_means_forever(self):
        assert premium_active({"premium": True}) is True

    def test_explicit_null_expiry_means_forever(self):
        assert premium_active({"premium": True, "premium_expires_at": None}) is True


class TestSubscription:
    def test_active_period(self):
        assert premium_active({"premium": True, "premium_expires_at": FUTURE}) is True

    def test_lapsed_period_revokes_access(self):
        # The bug this function exists to prevent: `premium` stays True in the
        # document after a subscription ends.
        assert premium_active({"premium": True, "premium_expires_at": PAST}) is False

    def test_expiry_from_iso_string(self):
        assert premium_active({"premium": True, "premium_expires_at": FUTURE.isoformat()}) is True
        assert premium_active({"premium": True, "premium_expires_at": PAST.isoformat()}) is False

    def test_expiry_from_zulu_string(self):
        stamp = FUTURE.strftime("%Y-%m-%dT%H:%M:%SZ")
        assert premium_active({"premium": True, "premium_expires_at": stamp}) is True

    def test_naive_datetime_is_treated_as_utc(self):
        naive_future = FUTURE.replace(tzinfo=None)
        naive_past = PAST.replace(tzinfo=None)
        assert premium_active({"premium": True, "premium_expires_at": naive_future}) is True
        assert premium_active({"premium": True, "premium_expires_at": naive_past}) is False

    def test_unparseable_expiry_keeps_paid_access(self):
        # A data problem must not silently remove access someone paid for
        assert premium_active({"premium": True, "premium_expires_at": "not-a-date"}) is True
        assert premium_active({"premium": True, "premium_expires_at": 12345}) is True


class TestLimits:
    def test_free_tier_limits_match_the_prd(self):
        # PRD: "Free: 10 swipes/day, 5 matches"
        assert FREE_DAILY_SWIPES == 10
        assert FREE_MAX_MATCHES == 5

    def test_limits_are_positive(self):
        assert FREE_DAILY_SWIPES > 0
        assert FREE_MAX_MATCHES > 0
