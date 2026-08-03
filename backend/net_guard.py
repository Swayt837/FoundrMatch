"""
Fetching a URL a user gave us, without becoming their proxy.

Website verification needs the server to read a page at an address the user
chose. That is a server-side request forgery primitive by default: `localhost`,
`169.254.169.254` (the cloud metadata endpoint, which hands out credentials),
and anything on the deployment's private network are all reachable from here and
from nowhere else.

So every hop is resolved and checked before it is followed:

- **http(s) only.** `file://` reads the disk, `gopher://` reaches arbitrary TCP.
- **Public addresses only**, checked after DNS resolution rather than by pattern-
  matching the hostname — `127.0.0.1.nip.io` is a public name that resolves to
  loopback, and a name can resolve differently on each lookup.
- **Redirects are followed manually**, each one re-checked. A permitted URL that
  302s to `http://169.254.169.254/` is the standard bypass.
- **Bounded** in time and size: a verification is a meta tag near the top of a
  document, not a reason to stream a gigabyte.
"""
import ipaddress
import socket
from typing import Optional, Tuple
from urllib.parse import urlparse

import httpx

MAX_REDIRECTS = 3
TIMEOUT_SECONDS = 8
MAX_BYTES = 512 * 1024

USER_AGENT = "CoFoundrVerifier/1.0 (+https://cofound-api-xjxt.onrender.com)"


class UnsafeURL(ValueError):
    """The URL is not one this server is willing to fetch."""


def _is_public(address: str) -> bool:
    ip = ipaddress.ip_address(address)
    return not (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local      # 169.254.0.0/16 — cloud metadata lives here
        or ip.is_reserved
        or ip.is_multicast
        or ip.is_unspecified
    )


def assert_fetchable(url: str) -> Tuple[str, str]:
    """
    Validate one URL and return `(hostname, scheme)`.

    Raises `UnsafeURL` with a message safe to show the user — they chose the
    address, so they are entitled to know why it was refused.
    """
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise UnsafeURL("Only http and https addresses can be checked")
    if not parsed.hostname:
        raise UnsafeURL("That does not look like a web address")

    try:
        resolved = socket.getaddrinfo(parsed.hostname, None)
    except socket.gaierror:
        raise UnsafeURL(f"Could not resolve {parsed.hostname}")

    for entry in resolved:
        address = entry[4][0]
        if not _is_public(address):
            # Deliberately vague about which internal address it hit.
            raise UnsafeURL("That address is not reachable from the public internet")

    return parsed.hostname, parsed.scheme


async def fetch_text(url: str) -> str:
    """
    Fetch a page, following redirects by hand so each hop is checked.

    Returns at most MAX_BYTES of decoded text.
    """
    current = url

    async with httpx.AsyncClient(
        timeout=TIMEOUT_SECONDS,
        follow_redirects=False,
        headers={"User-Agent": USER_AGENT},
    ) as client:
        for _ in range(MAX_REDIRECTS + 1):
            assert_fetchable(current)

            try:
                response = await client.get(current)
            except httpx.HTTPError as exc:
                raise UnsafeURL(f"Could not reach that address: {exc.__class__.__name__}")

            if response.is_redirect:
                location = response.headers.get("location")
                if not location:
                    raise UnsafeURL("That address redirected to nowhere")
                # Resolve relative redirects against the URL that produced them.
                current = str(response.url.join(location))
                continue

            if response.status_code >= 400:
                raise UnsafeURL(f"That address answered {response.status_code}")

            return response.text[:MAX_BYTES]

    raise UnsafeURL("That address redirected too many times")


def normalise(url: str) -> Optional[str]:
    """
    Tidy a user-typed address, adding https:// when the scheme is missing.

    People type "acme.com". Refusing that teaches them nothing.
    """
    url = (url or "").strip()
    if not url:
        return None
    if "://" not in url:
        url = f"https://{url}"
    parsed = urlparse(url)
    if not parsed.hostname:
        return None
    return url
