"""
Verification: the URL guard, the email codes, and the meta-tag parser.

The guard carries the most weight. Website verification makes the server fetch
an address a user chose, which is a server-side request forgery primitive by
default — the cloud metadata endpoint at 169.254.169.254 hands out credentials
to anything on the box that asks.
"""
import socket

import pytest

import net_guard
import verification as verify


# ===== The URL guard =====

class TestSchemes:
    @pytest.mark.parametrize("url", [
        "file:///etc/passwd",
        "gopher://internal:70/",
        "ftp://files.example.com/",
        "javascript:alert(1)",
    ])
    def test_only_http_and_https(self, url):
        with pytest.raises(net_guard.UnsafeURL, match="http"):
            net_guard.assert_fetchable(url)

    def test_missing_host_is_refused(self):
        with pytest.raises(net_guard.UnsafeURL):
            net_guard.assert_fetchable("https:///nowhere")


class TestPrivateAddresses:
    """
    Checked after DNS resolution, not by matching the hostname: `127.0.0.1.nip.io`
    is a perfectly public-looking name that resolves to loopback.
    """

    def _resolving_to(self, monkeypatch, address):
        monkeypatch.setattr(
            net_guard.socket,
            "getaddrinfo",
            lambda *a, **k: [(socket.AF_INET, None, None, "", (address, 0))],
        )

    @pytest.mark.parametrize("address", [
        "127.0.0.1",        # loopback
        "10.0.0.5",         # private
        "192.168.1.15",     # private
        "172.16.4.2",       # private
        "169.254.169.254",  # cloud metadata — the one that leaks credentials
        "0.0.0.0",          # unspecified
    ])
    def test_internal_addresses_are_refused(self, monkeypatch, address):
        self._resolving_to(monkeypatch, address)

        with pytest.raises(net_guard.UnsafeURL, match="not reachable"):
            net_guard.assert_fetchable("https://looks-legit.example")

    def test_a_public_address_is_allowed(self, monkeypatch):
        self._resolving_to(monkeypatch, "93.184.216.34")

        host, scheme = net_guard.assert_fetchable("https://example.com/page")
        assert host == "example.com"
        assert scheme == "https"

    def test_unresolvable_names_are_refused(self, monkeypatch):
        def boom(*args, **kwargs):
            raise socket.gaierror()

        monkeypatch.setattr(net_guard.socket, "getaddrinfo", boom)

        with pytest.raises(net_guard.UnsafeURL, match="resolve"):
            net_guard.assert_fetchable("https://does-not-exist.example")


class TestNormalise:
    def test_adds_a_scheme(self):
        assert net_guard.normalise("acme.com") == "https://acme.com"

    def test_keeps_an_explicit_scheme(self):
        assert net_guard.normalise("http://acme.com") == "http://acme.com"

    def test_rejects_nothing_useful(self):
        assert net_guard.normalise("") is None
        assert net_guard.normalise("   ") is None


# ===== The meta tag =====

class TestTokenParsing:
    def test_finds_the_token(self):
        token = verify.website_token()
        html = f'<html><head>{verify.meta_tag(token)}</head><body></body></html>'

        assert verify.find_token(html) == token

    def test_attribute_order_does_not_matter(self):
        """Hand-written tags routinely put content before name."""
        html = '<meta content="cofoundr-abc123" name="cofoundr-verification">'

        assert verify.find_token(html) == "cofoundr-abc123"

    def test_single_quotes_and_odd_casing(self):
        html = "<META NAME='cofoundr-verification' CONTENT='cofoundr-xyz'>"

        assert verify.find_token(html) == "cofoundr-xyz"

    def test_absent_returns_none(self):
        assert verify.find_token("<html><head><title>Hi</title></head></html>") is None

    def test_other_meta_tags_are_ignored(self):
        html = '<meta name="description" content="cofoundr-not-the-token">'

        assert verify.find_token(html) is None


# ===== Email codes =====

class TestEmailCodes:
    def test_codes_are_six_digits(self):
        for _ in range(50):
            code = verify.new_code()
            assert len(code) == 6 and code.isdigit()

    def test_hash_is_salted_per_user(self):
        """
        Otherwise a table of a million hashes reverses the whole column at once.
        """
        assert verify.hash_code("123456", "user_a") != verify.hash_code("123456", "user_b")

    def test_hash_is_stable_for_the_same_pair(self):
        assert verify.hash_code("123456", "user_a") == verify.hash_code("123456", "user_a")


# ===== Configuration gates =====

def test_github_needs_both_halves(monkeypatch):
    monkeypatch.setattr(verify, "GITHUB_CLIENT_ID", "id")
    monkeypatch.setattr(verify, "GITHUB_CLIENT_SECRET", "")
    assert verify.github_configured() is False

    monkeypatch.setattr(verify, "GITHUB_CLIENT_SECRET", "secret")
    assert verify.github_configured() is True


def test_github_requests_no_scopes(monkeypatch):
    """
    Proving account ownership needs public profile data and nothing else. Asking
    for repository access to display a username would be indefensible.
    """
    monkeypatch.setattr(verify, "GITHUB_CLIENT_ID", "id")

    url = verify.github_authorize_url("state123", "https://app.example/cb")

    assert "scope=" in url and "scope=repo" not in url
    assert "state=state123" in url
