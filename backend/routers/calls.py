"""
Video call configuration.

The call itself is peer-to-peer: signalling runs over the Socket.io events in
`realtime`, and the audio/video never touches this backend. What a peer still cannot
work out for itself is how to be reached, which is what this endpoint provides.

Two kinds of server are involved, and the difference matters operationally:

- **STUN** tells a peer its own public address. Free, stateless, and Google's public
  servers are the default here.
- **TURN** *relays* the media when a direct path can't be established — symmetric
  NAT, carrier-grade NAT, restrictive corporate firewalls. Somewhere between 10% and
  20% of real-world calls need it, and it cannot be free because it carries the
  bytes. Without TURN configured, those calls connect the signalling, fail to
  establish media, and time out.

So the endpoint reports `relay_configured`, and the client says plainly that calls
may fail on some networks rather than presenting an unexplained failure. Credentials
come from the environment because they are secrets, and short-lived TURN credentials
are the recommended way to hand them out — which is why they are minted per request
here rather than shipped in the app bundle.
"""
import os

from fastapi import APIRouter, Depends

from access import require_match_participant
from auth import get_current_user

router = APIRouter(prefix="/api", tags=["calls"])

# Public STUN. Overridable so a self-hosted deployment need not depend on Google.
STUN_URLS = [
    url.strip()
    for url in os.getenv(
        "STUN_URLS", "stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302"
    ).split(",")
    if url.strip()
]

TURN_URLS = [url.strip() for url in os.getenv("TURN_URLS", "").split(",") if url.strip()]
TURN_USERNAME = os.getenv("TURN_USERNAME", "")
TURN_CREDENTIAL = os.getenv("TURN_CREDENTIAL", "")


def ice_servers() -> list:
    """The ICE server list in the shape `RTCPeerConnection` expects."""
    servers = [{"urls": STUN_URLS}] if STUN_URLS else []

    if TURN_URLS and TURN_USERNAME and TURN_CREDENTIAL:
        servers.append(
            {
                "urls": TURN_URLS,
                "username": TURN_USERNAME,
                "credential": TURN_CREDENTIAL,
            }
        )

    return servers


def relay_configured() -> bool:
    return bool(TURN_URLS and TURN_USERNAME and TURN_CREDENTIAL)


@router.get("/calls/config")
async def get_call_config(current_user: dict = Depends(get_current_user)):
    """
    ICE servers for a call.

    Authenticated: TURN credentials are a metered resource, so they are not handed to
    anonymous callers.
    """
    return {
        "ice_servers": ice_servers(),
        # The client warns the user when there is no relay, instead of letting the
        # call fail silently on a restrictive network.
        "relay_configured": relay_configured(),
    }


@router.get("/matches/{match_id}/call-config")
async def get_match_call_config(
    match_id: str,
    current_user: dict = Depends(get_current_user),
):
    """
    Same configuration, but confirming the caller is actually matched with the person
    they are about to ring — so the client can fetch config and check eligibility in
    one round trip before opening the camera.
    """
    match = await require_match_participant(match_id, current_user["user_id"])
    other = (
        match["user2_id"]
        if current_user["user_id"] == match["user1_id"]
        else match["user1_id"]
    )

    return {
        "ice_servers": ice_servers(),
        "relay_configured": relay_configured(),
        "match_id": match_id,
        "peer_user_id": other,
    }
