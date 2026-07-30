"""
Deal-room workspace tests: documents, decisions and equity.

These call the route handlers directly against an in-memory stand-in for the rooms
collection. That is deliberately not a full API test — there is no Mongo here — but
it covers the logic that matters and that a UI cannot be trusted to enforce:

- an equity split must add up to 100% across exactly the two founders,
- editing a split must revoke the other founder's agreement,
- agreement transitions must be idempotent,
- a document link must be http(s), never `javascript:`,
- a non-participant must be refused.

Run with: pytest backend/tests -o addopts=''
"""
import asyncio
import copy
import os
import sys

import pytest
from fastapi import HTTPException

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import access  # noqa: E402
from routers import deal_rooms  # noqa: E402

ALICE = "user_alice"
BOB = "user_bob"
STRANGER = "user_stranger"


class FakeRooms:
    """
    The subset of Mongo's update grammar these handlers use: `$set`, `$push`,
    `$pull`. Documents are copied on read so a handler cannot mutate stored state
    without going through `update_one` — the real driver behaves that way, and a
    shared-reference fake would hide a missing write.
    """

    def __init__(self, room):
        self.room = room

    async def find_one(self, query, projection=None):
        if query.get("room_id") and query["room_id"] != self.room["room_id"]:
            return None
        if query.get("match_id") and query["match_id"] != self.room.get("match_id"):
            return None
        return copy.deepcopy(self.room)

    async def update_one(self, query, update):
        for key, value in (update.get("$set") or {}).items():
            self.room[key] = value
        for key, value in (update.get("$push") or {}).items():
            self.room.setdefault(key, []).append(value)
        for key, condition in (update.get("$pull") or {}).items():
            field, wanted = next(iter(condition.items()))
            self.room[key] = [
                item for item in self.room.get(key, []) if item.get(field) != wanted
            ]


@pytest.fixture
def room():
    return {
        "room_id": "room_1",
        "match_id": "match_1",
        "participants": [ALICE, BOB],
        "project_name": "Founders CRM",
        "vision": "A CRM for founders",
        "tasks": [],
        "documents": [],
        "decisions": [],
        "equity_split": {},
    }


@pytest.fixture
def rooms(room, monkeypatch):
    fake = FakeRooms(room)
    # Both modules hold their own reference to the collection.
    monkeypatch.setattr(deal_rooms, "deal_rooms_collection", fake)
    monkeypatch.setattr(access, "deal_rooms_collection", fake)
    return fake


def user(user_id):
    return {"user_id": user_id}


def run(coroutine):
    return asyncio.run(coroutine)


class TestAuthorization:
    def test_stranger_cannot_read_a_room(self, rooms):
        with pytest.raises(HTTPException) as exc:
            run(deal_rooms.get_deal_room("room_1", user(STRANGER)))
        assert exc.value.status_code == 403

    def test_missing_room_is_404_not_403(self, rooms):
        with pytest.raises(HTTPException) as exc:
            run(deal_rooms.get_deal_room("room_nope", user(ALICE)))
        assert exc.value.status_code == 404

    def test_stranger_cannot_propose_equity(self, rooms):
        proposal = deal_rooms.EquityProposal(splits={ALICE: 50, BOB: 50})
        with pytest.raises(HTTPException) as exc:
            run(deal_rooms.propose_equity("room_1", proposal, user(STRANGER)))
        assert exc.value.status_code == 403


class TestDocuments:
    def test_adds_a_link(self, rooms, room):
        entry = run(
            deal_rooms.add_document(
                "room_1",
                deal_rooms.DocumentCreate(
                    title="Pitch deck", url="https://example.com/deck", doc_type="pitch_deck"
                ),
                user(ALICE),
            )
        )

        assert entry["added_by"] == ALICE
        assert entry["doc_type"] == "pitch_deck"
        assert [d["document_id"] for d in room["documents"]] == [entry["document_id"]]

    @pytest.mark.parametrize(
        "url",
        [
            "javascript:alert(1)",
            "data:text/html,<script>alert(1)</script>",
            "file:///etc/passwd",
            "example.com/deck",
            "https://",
        ],
    )
    def test_rejects_non_http_links(self, rooms, url):
        """
        A shared workspace renders links for the *other* founder to tap, so a
        `javascript:` URL here is one founder attacking the other.
        """
        with pytest.raises(HTTPException) as exc:
            run(
                deal_rooms.add_document(
                    "room_1",
                    deal_rooms.DocumentCreate(title="x", url=url),
                    user(ALICE),
                )
            )
        assert exc.value.status_code == 400

    def test_unknown_document_type_falls_back_to_other(self, rooms):
        entry = run(
            deal_rooms.add_document(
                "room_1",
                deal_rooms.DocumentCreate(
                    title="x", url="https://example.com", doc_type="secret_sauce"
                ),
                user(ALICE),
            )
        )
        assert entry["doc_type"] == "other"

    def test_either_founder_can_remove_a_link(self, rooms, room):
        entry = run(
            deal_rooms.add_document(
                "room_1",
                deal_rooms.DocumentCreate(title="x", url="https://example.com"),
                user(ALICE),
            )
        )

        run(deal_rooms.remove_document("room_1", entry["document_id"], user(BOB)))

        assert room["documents"] == []

    def test_removing_an_unknown_document_is_404(self, rooms):
        with pytest.raises(HTTPException) as exc:
            run(deal_rooms.remove_document("room_1", "doc_nope", user(ALICE)))
        assert exc.value.status_code == 404


class TestDecisions:
    def test_author_counts_as_agreeing_but_it_stays_proposed(self, rooms):
        entry = run(
            deal_rooms.add_decision(
                "room_1", deal_rooms.DecisionCreate(title="Incorporate in France"), user(ALICE)
            )
        )

        assert entry["agreed_by"] == [ALICE]
        assert entry["status"] == "proposed"

    def test_both_founders_agreeing_marks_it_agreed(self, rooms):
        entry = run(
            deal_rooms.add_decision(
                "room_1", deal_rooms.DecisionCreate(title="Raise a pre-seed"), user(ALICE)
            )
        )

        updated = run(
            deal_rooms.agree_to_decision("room_1", entry["decision_id"], user(BOB))
        )

        assert sorted(updated["agreed_by"]) == sorted([ALICE, BOB])
        assert updated["status"] == "agreed"

    def test_agreeing_twice_changes_nothing(self, rooms):
        entry = run(
            deal_rooms.add_decision(
                "room_1", deal_rooms.DecisionCreate(title="Ship weekly"), user(ALICE)
            )
        )

        run(deal_rooms.agree_to_decision("room_1", entry["decision_id"], user(BOB)))
        twice = run(deal_rooms.agree_to_decision("room_1", entry["decision_id"], user(BOB)))

        assert twice["agreed_by"].count(BOB) == 1

    def test_unknown_decision_is_404(self, rooms):
        with pytest.raises(HTTPException) as exc:
            run(deal_rooms.agree_to_decision("room_1", "decision_nope", user(ALICE)))
        assert exc.value.status_code == 404


class TestEquity:
    def propose(self, splits, actor=ALICE, **kwargs):
        return run(
            deal_rooms.propose_equity(
                "room_1", deal_rooms.EquityProposal(splits=splits, **kwargs), user(actor)
            )
        )

    def test_valid_split_is_stored_with_vesting(self, rooms, room):
        equity = self.propose({ALICE: 60, BOB: 40}, vesting_months=48, cliff_months=12)

        assert equity["splits"] == {ALICE: 60.0, BOB: 40.0}
        assert equity["vesting_months"] == 48
        assert equity["cliff_months"] == 12
        assert room["equity_split"]["proposed_by"] == ALICE

    @pytest.mark.parametrize("splits", [{ALICE: 60, BOB: 60}, {ALICE: 10, BOB: 10}])
    def test_shares_must_total_100(self, rooms, splits):
        """
        The whole reason this tab exists: two founders must not each walk away
        believing they hold 60%.
        """
        with pytest.raises(HTTPException) as exc:
            self.propose(splits)
        assert exc.value.status_code == 400
        assert "100%" in exc.value.detail

    def test_split_must_name_exactly_the_participants(self, rooms):
        with pytest.raises(HTTPException) as exc:
            self.propose({ALICE: 50, STRANGER: 50})
        assert exc.value.status_code == 400

    def test_split_cannot_omit_a_founder(self, rooms):
        with pytest.raises(HTTPException) as exc:
            self.propose({ALICE: 100})
        assert exc.value.status_code == 400

    def test_floating_point_totals_are_tolerated(self, rooms):
        equity = self.propose({ALICE: 33.33, BOB: 66.67})
        assert equity["status"] == "proposed"

    def test_accepting_completes_the_agreement(self, rooms):
        self.propose({ALICE: 50, BOB: 50})

        agreed = run(deal_rooms.accept_equity("room_1", user(BOB)))

        assert agreed["status"] == "agreed"
        assert "agreed_at" in agreed

    def test_reproposing_revokes_the_other_founder_agreement(self, rooms):
        """
        Otherwise one founder could accept 50/50 and the other could then quietly
        rewrite it to 80/20 while the record still said "agreed".
        """
        self.propose({ALICE: 50, BOB: 50})
        run(deal_rooms.accept_equity("room_1", user(BOB)))

        revised = self.propose({ALICE: 80, BOB: 20})

        assert revised["agreed_by"] == [ALICE]
        assert revised["status"] == "proposed"

    def test_accepting_before_a_proposal_exists_is_404(self, rooms):
        with pytest.raises(HTTPException) as exc:
            run(deal_rooms.accept_equity("room_1", user(BOB)))
        assert exc.value.status_code == 404

    def test_accepting_twice_changes_nothing(self, rooms):
        self.propose({ALICE: 50, BOB: 50})
        first = run(deal_rooms.accept_equity("room_1", user(BOB)))
        second = run(deal_rooms.accept_equity("room_1", user(BOB)))

        assert second["agreed_by"] == first["agreed_by"]
        assert second["agreed_at"] == first["agreed_at"]


class TestTasks:
    def test_task_cannot_be_assigned_to_a_non_participant(self, rooms):
        with pytest.raises(HTTPException) as exc:
            run(
                deal_rooms.add_task(
                    "room_1",
                    deal_rooms.TaskCreate(title="Do the thing", assigned_to=STRANGER),
                    user(ALICE),
                )
            )
        assert exc.value.status_code == 400

    def test_toggling_an_unknown_task_is_404(self, rooms):
        """It used to write the task list back unchanged and report success."""
        with pytest.raises(HTTPException) as exc:
            run(deal_rooms.toggle_task("room_1", "task_nope", user(ALICE)))
        assert exc.value.status_code == 404

    def test_toggle_flips_completion(self, rooms):
        task = run(
            deal_rooms.add_task(
                "room_1", deal_rooms.TaskCreate(title="Register the company"), user(ALICE)
            )
        )

        after = run(deal_rooms.toggle_task("room_1", task["task_id"], user(BOB)))
        assert after["tasks"][0]["completed"] is True

        again = run(deal_rooms.toggle_task("room_1", task["task_id"], user(BOB)))
        assert again["tasks"][0]["completed"] is False
