"""
Video call signalling tests.

The signalling relay is where authorisation has to hold: an unchecked event would let
any socket ring, or send media offers to, someone they have never matched with. Each
handler is exercised against a fake Socket.io server and a fake matches collection.

What is asserted, for every event:

- a participant's event reaches *the other participant's personal room* — not the
  match room, because an incoming call has to arrive whether or not the callee has
  the conversation open, and not the sender,
- a stranger's event reaches nobody,
- an unauthenticated socket's event reaches nobody.

Run with: pytest backend/tests -o addopts=''
"""
import asyncio
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import realtime  # noqa: E402

ALICE = "user_alice"
BOB = "user_bob"
STRANGER = "user_stranger"
MATCH = "match_1"


class FakeSio:
    """Records emissions instead of sending them."""

    def __init__(self, sessions):
        self.sessions = sessions
        self.emitted = []

    async def get_session(self, sid):
        return self.sessions.get(sid)

    async def emit(self, event, data=None, room=None, skip_sid=None):
        self.emitted.append({"event": event, "data": data, "room": room})

    def to(self, event, room=None):
        return [e for e in self.emitted if e["event"] == event and (room is None or e["room"] == room)]


class FakeMatches:
    def __init__(self, match):
        self.match = match

    async def find_one(self, query, projection=None):
        if query.get("match_id") != self.match["match_id"]:
            return None
        return dict(self.match)


@pytest.fixture
def sio(monkeypatch):
    fake = FakeSio(
        {
            "sid_alice": {"user_id": ALICE},
            "sid_bob": {"user_id": BOB},
            "sid_stranger": {"user_id": STRANGER},
            "sid_anon": None,
        }
    )
    monkeypatch.setattr(realtime, "sio", fake)
    monkeypatch.setattr(
        realtime,
        "matches_collection",
        FakeMatches({"match_id": MATCH, "user1_id": ALICE, "user2_id": BOB}),
    )
    return fake


def run(coroutine):
    return asyncio.run(coroutine)


# The handlers are registered on the real `sio` via decorator, but the decorator
# returns the function, so they are callable directly.
CALL_EVENTS = (
    realtime.call_invite,
    realtime.call_accept,
    realtime.call_decline,
    realtime.call_end,
)


class TestAuthorization:
    @pytest.mark.parametrize("handler", CALL_EVENTS, ids=lambda h: h.__name__)
    def test_stranger_cannot_signal_on_someone_elses_match(self, sio, handler):
        run(handler("sid_stranger", {"match_id": MATCH, "call_id": "call_x"}))

        assert sio.to("call_incoming") == []
        assert sio.to("call_accepted") == []
        assert sio.to("call_declined") == []
        assert sio.to("call_ended") == []
        # The refusal goes back to the sender only.
        errors = sio.to("call_error")
        assert len(errors) == 1
        assert errors[0]["room"] == "sid_stranger"

    @pytest.mark.parametrize("handler", CALL_EVENTS, ids=lambda h: h.__name__)
    def test_unauthenticated_socket_is_ignored(self, sio, handler):
        run(handler("sid_anon", {"match_id": MATCH}))
        assert sio.emitted == []

    @pytest.mark.parametrize("handler", CALL_EVENTS, ids=lambda h: h.__name__)
    def test_unknown_match_is_refused(self, sio, handler):
        run(handler("sid_alice", {"match_id": "match_nope"}))

        assert sio.to("call_incoming") == []
        assert [e["event"] for e in sio.emitted] == ["call_error"]

    @pytest.mark.parametrize("handler", CALL_EVENTS, ids=lambda h: h.__name__)
    def test_missing_match_id_is_ignored(self, sio, handler):
        run(handler("sid_alice", {}))
        assert sio.emitted == []


class TestInvite:
    def test_rings_the_other_founder_personal_room(self, sio):
        run(realtime.call_invite("sid_alice", {"match_id": MATCH}))

        incoming = sio.to("call_incoming")
        assert len(incoming) == 1
        # Personal room, not the match room: the callee may not have the chat open.
        assert incoming[0]["room"] == f"user:{BOB}"
        assert incoming[0]["data"]["from_user_id"] == ALICE
        assert incoming[0]["data"]["media"] == "video"

    def test_caller_is_told_the_call_id(self, sio):
        run(realtime.call_invite("sid_alice", {"match_id": MATCH}))

        incoming = sio.to("call_incoming")[0]["data"]
        ringing = sio.to("call_ringing")
        assert len(ringing) == 1
        assert ringing[0]["room"] == "sid_alice"
        # Both sides must agree on the id or later signalling cannot be routed.
        assert ringing[0]["data"]["call_id"] == incoming["call_id"]

    def test_call_id_is_server_minted_and_unique(self, sio):
        """
        A client-chosen id could collide with — or deliberately hijack — another call
        in flight, so the server mints it.
        """
        run(realtime.call_invite("sid_alice", {"match_id": MATCH, "call_id": "attacker_chosen"}))
        run(realtime.call_invite("sid_alice", {"match_id": MATCH, "call_id": "attacker_chosen"}))

        ids = [e["data"]["call_id"] for e in sio.to("call_incoming")]
        assert ids[0] != ids[1]
        assert "attacker_chosen" not in ids

    def test_audio_only_is_honoured(self, sio):
        run(realtime.call_invite("sid_alice", {"match_id": MATCH, "media": "audio"}))
        assert sio.to("call_incoming")[0]["data"]["media"] == "audio"

    def test_unrecognised_media_falls_back_to_video(self, sio):
        run(realtime.call_invite("sid_alice", {"match_id": MATCH, "media": "hologram"}))
        assert sio.to("call_incoming")[0]["data"]["media"] == "video"

    def test_either_side_can_initiate(self, sio):
        run(realtime.call_invite("sid_bob", {"match_id": MATCH}))

        incoming = sio.to("call_incoming")[0]
        assert incoming["room"] == f"user:{ALICE}"
        assert incoming["data"]["from_user_id"] == BOB


class TestLifecycle:
    def test_accept_reaches_the_caller(self, sio):
        run(realtime.call_accept("sid_bob", {"match_id": MATCH, "call_id": "call_1"}))

        accepted = sio.to("call_accepted")
        assert accepted[0]["room"] == f"user:{ALICE}"
        assert accepted[0]["data"]["call_id"] == "call_1"

    def test_decline_carries_a_reason(self, sio):
        run(
            realtime.call_decline(
                "sid_bob", {"match_id": MATCH, "call_id": "call_1", "reason": "busy"}
            )
        )
        assert sio.to("call_declined")[0]["data"]["reason"] == "busy"

    def test_decline_defaults_its_reason(self, sio):
        run(realtime.call_decline("sid_bob", {"match_id": MATCH, "call_id": "call_1"}))
        assert sio.to("call_declined")[0]["data"]["reason"] == "declined"

    def test_end_reaches_the_other_side(self, sio):
        run(realtime.call_end("sid_alice", {"match_id": MATCH, "call_id": "call_1"}))

        ended = sio.to("call_ended")
        assert ended[0]["room"] == f"user:{BOB}"
        assert ended[0]["data"]["from_user_id"] == ALICE


class TestSignalRelay:
    def test_relays_an_offer_verbatim(self, sio):
        """
        The server does not parse SDP — reading it would add a way to get it wrong
        without adding anything.
        """
        offer = {"type": "offer", "sdp": "v=0\r\no=- 123 2 IN IP4 127.0.0.1\r\n"}

        run(realtime.call_signal("sid_alice", {"match_id": MATCH, "call_id": "c1", "signal": offer}))

        relayed = sio.to("call_signal")
        assert relayed[0]["room"] == f"user:{BOB}"
        assert relayed[0]["data"]["signal"] == offer
        assert relayed[0]["data"]["from_user_id"] == ALICE

    def test_stranger_cannot_send_signals(self, sio):
        run(
            realtime.call_signal(
                "sid_stranger", {"match_id": MATCH, "call_id": "c1", "signal": {"type": "offer"}}
            )
        )

        assert sio.to("call_signal") == []
        assert [e["event"] for e in sio.emitted] == ["call_error"]

    def test_missing_signal_is_dropped(self, sio):
        run(realtime.call_signal("sid_alice", {"match_id": MATCH, "call_id": "c1"}))
        assert sio.emitted == []

    def test_oversized_signal_is_refused(self, sio):
        """
        Otherwise the signalling channel is an unmetered way to push arbitrary
        payloads at another user.
        """
        run(
            realtime.call_signal(
                "sid_alice",
                {
                    "match_id": MATCH,
                    "call_id": "c1",
                    "signal": "x" * (realtime.MAX_SIGNAL_BYTES + 1),
                },
            )
        )

        assert sio.to("call_signal") == []
        errors = sio.to("call_error")
        assert errors[0]["data"]["reason"] == "signal_too_large"
        assert errors[0]["room"] == "sid_alice"

    def test_signal_at_the_size_limit_passes(self, sio):
        run(
            realtime.call_signal(
                "sid_alice",
                {"match_id": MATCH, "call_id": "c1", "signal": "x" * realtime.MAX_SIGNAL_BYTES},
            )
        )
        assert len(sio.to("call_signal")) == 1


class TestIceConfig:
    def test_stun_is_always_offered(self):
        from routers import calls

        servers = calls.ice_servers()
        assert servers, "a call needs at least STUN to discover its own address"
        assert any("stun:" in url for url in servers[0]["urls"])

    def test_turn_is_absent_until_configured(self, monkeypatch):
        from routers import calls

        monkeypatch.setattr(calls, "TURN_URLS", [])
        assert calls.relay_configured() is False
        assert all("credential" not in server for server in calls.ice_servers())

    def test_turn_requires_all_three_settings(self, monkeypatch):
        """
        A URL without credentials is not a usable relay; reporting it as configured
        would tell the client calls are reliable when they are not.
        """
        from routers import calls

        monkeypatch.setattr(calls, "TURN_URLS", ["turn:relay.example.com:3478"])
        monkeypatch.setattr(calls, "TURN_USERNAME", "")
        monkeypatch.setattr(calls, "TURN_CREDENTIAL", "secret")

        assert calls.relay_configured() is False

    def test_configured_turn_is_included(self, monkeypatch):
        from routers import calls

        monkeypatch.setattr(calls, "TURN_URLS", ["turn:relay.example.com:3478"])
        monkeypatch.setattr(calls, "TURN_USERNAME", "cofound")
        monkeypatch.setattr(calls, "TURN_CREDENTIAL", "secret")

        assert calls.relay_configured() is True
        relay = calls.ice_servers()[-1]
        assert relay["username"] == "cofound"
        assert relay["credential"] == "secret"
