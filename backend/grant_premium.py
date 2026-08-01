"""
Grant or revoke Premium on an account, without a payment.

For testing features that sit behind the paywall — deal rooms, the deep
compatibility report, the copilot — and for the occasional comped account.

The plan is recorded as "complimentary" rather than "lifetime" on purpose. It
goes in the same field a real purchase writes, so anything counting plans later
would otherwise read this as revenue. Being able to tell the two apart matters
more the moment there is any.

Run:  python grant_premium.py you@example.com
      python grant_premium.py you@example.com --revoke
"""
import asyncio
import sys

from database import users_collection
from entitlements import premium_active
from premium import _grant_premium, _revoke_premium

PLAN = "complimentary"


async def main(email: str, revoke: bool) -> int:
    user = await users_collection.find_one({"email": email}, {"_id": 0})
    if not user:
        print(f"No account with email {email!r}")
        return 1

    name = (user.get("profile") or {}).get("name") or "(no name)"
    print(f"{name} <{email}>")
    print(f"  premium before : {premium_active(user)} (plan {user.get('premium_plan')})")

    if revoke:
        await _revoke_premium(user["user_id"], "revoked manually")
    else:
        # expires_at=None: a complimentary grant does not lapse on its own.
        await _grant_premium(user["user_id"], PLAN, expires_at=None)

    updated = await users_collection.find_one({"user_id": user["user_id"]}, {"_id": 0})
    print(f"  premium after  : {premium_active(updated)} (plan {updated.get('premium_plan')})")
    return 0


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not args:
        print(__doc__)
        sys.exit(2)
    sys.exit(asyncio.run(main(args[0], "--revoke" in sys.argv)))
