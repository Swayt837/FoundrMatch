"""
Google ID token verification tests.

This is an authentication boundary, so the tests are mostly about what must be
*rejected*. Google's own signature check is the easy part; the two checks that are
easy to leave out are the ones that matter:

- **Audience.** A validly-signed Google token issued to a different application is
  still a genuine Google token. Skipping this check means anyone who can register an
  OAuth client — which is anyone — can mint a token and sign in as any of our users.
- **`email_verified`.** Accounts are matched by email, so an unverified address is an
  account-takeover route: claim someone's email on a throwaway Google account, sign
  in, inherit their profile.

The signature check itself is Google's library and is stubbed out here; what is under
test is what this code does with the claims it gets back.

Run with: pytest backend/tests -o addopts='' -q
"""
import asyncio
import os
import sys

import pytest
from fastapi import HTTPException

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import auth  # noqa: E402

OUR_IOS_CLIENT = "111-ios.apps.googleusercontent.com"
OUR_WEB_CLIENT = "111-web.apps.googleusercontent.com"
SOMEONE_ELSES_CLIENT = "999-attacker.apps.googleusercontent.com"


def valid_claims(**overrides):
    claims = {
        "sub": "google-user-1",
        "email": "founder@example.com",
        "email_verified": True,
        "name": "Ada Founder",
        "picture": "https://example.com/ada.jpg",
        "aud": OUR_IOS_CLIENT,
        "iss": "https://accounts.google.com",
    }
    claims.update(overrides)
    return claims


@pytest.fixture
def configured(monkeypatch):
    """A backend that accepts tokens for our iOS and web clients."""
    monkeypatch.setattr(auth, "GOOGLE_CLIENT_IDS", [OUR_IOS_CLIENT, OUR_WEB_CLIENT])


def stub_google(monkeypatch, claims=None, raises=None):
    """Replace Google's verifier — its signature check is not what's under test."""

    def _verify(token, request, audience):
        if raises is not None:
            raise raises
        return claims

    monkeypatch.setattr(auth.google_id_token, "verify_oauth2_token", _verify)


def run(coroutine):
    return asyncio.run(coroutine)


class TestAcceptance:
    def test_valid_token_returns_claims(self, configured, monkeypatch):
        stub_google(monkeypatch, claims=valid_claims())

        claims = run(auth.verify_google_id_token("token"))

        assert claims["sub"] == "google-user-1"
        assert claims["email"] == "founder@example.com"

    def test_any_configured_client_is_accepted(self, configured, monkeypatch):
        """One OAuth client per platform, so all of them have to work."""
        stub_google(monkeypatch, claims=valid_claims(aud=OUR_WEB_CLIENT))

        assert run(auth.verify_google_id_token("token"))["aud"] == OUR_WEB_CLIENT

    @pytest.mark.parametrize("issuer", ["accounts.google.com", "https://accounts.google.com"])
    def test_both_google_issuer_spellings(self, configured, monkeypatch, issuer):
        """Google uses both forms; rejecting one locks out real users."""
        stub_google(monkeypatch, claims=valid_claims(iss=issuer))

        assert run(auth.verify_google_id_token("token"))["iss"] == issuer


class TestRejection:
    def _assert_401(self, coroutine):
        with pytest.raises(HTTPException) as exc:
            run(coroutine)
        assert exc.value.status_code == 401
        return exc.value

    def test_token_for_another_app_is_rejected(self, configured, monkeypatch):
        """
        The whole point of the audience check. This token is genuine, signed by
        Google, and not for us.
        """
        stub_google(monkeypatch, claims=valid_claims(aud=SOMEONE_ELSES_CLIENT))

        self._assert_401(auth.verify_google_id_token("token"))

    def test_unverified_email_is_rejected(self, configured, monkeypatch):
        """Accounts are matched by email, so an unverified one is a takeover route."""
        stub_google(monkeypatch, claims=valid_claims(email_verified=False))

        self._assert_401(auth.verify_google_id_token("token"))

    def test_missing_email_is_rejected(self, configured, monkeypatch):
        stub_google(monkeypatch, claims=valid_claims(email=None))

        self._assert_401(auth.verify_google_id_token("token"))

    def test_wrong_issuer_is_rejected(self, configured, monkeypatch):
        stub_google(monkeypatch, claims=valid_claims(iss="https://accounts.evil.com"))

        self._assert_401(auth.verify_google_id_token("token"))

    def test_bad_signature_is_rejected(self, configured, monkeypatch):
        """`verify_oauth2_token` raises ValueError for a bad or expired token."""
        stub_google(monkeypatch, raises=ValueError("Token expired"))

        self._assert_401(auth.verify_google_id_token("token"))

    def test_google_auth_error_is_rejected(self, configured, monkeypatch):
        from google.auth.exceptions import GoogleAuthError

        stub_google(monkeypatch, raises=GoogleAuthError("could not fetch certs"))

        self._assert_401(auth.verify_google_id_token("token"))

    def test_failure_reason_is_not_disclosed(self, configured, monkeypatch):
        """Telling a caller *why* a token failed helps them iterate towards one that works."""
        stub_google(monkeypatch, raises=ValueError("Token expired at 2026-01-01"))

        error = self._assert_401(auth.verify_google_id_token("token"))

        assert "2026" not in error.detail
        assert error.detail == "Invalid Google token"


class TestNotConfigured:
    def test_unconfigured_server_reports_503_not_401(self, monkeypatch):
        """
        503 says "this server can't do that", 401 would say "your token is bad" —
        which would send someone debugging a token that was fine.
        """
        monkeypatch.setattr(auth, "GOOGLE_CLIENT_IDS", [])
        stub_google(monkeypatch, claims=valid_claims())

        with pytest.raises(HTTPException) as exc:
            run(auth.verify_google_id_token("token"))

        assert exc.value.status_code == 503

    def test_no_client_ids_means_no_token_is_accepted(self, monkeypatch):
        """An empty allowlist must not degrade into "accept anything"."""
        monkeypatch.setattr(auth, "GOOGLE_CLIENT_IDS", [])
        stub_google(monkeypatch, claims=valid_claims(aud=SOMEONE_ELSES_CLIENT))

        with pytest.raises(HTTPException):
            run(auth.verify_google_id_token("token"))
