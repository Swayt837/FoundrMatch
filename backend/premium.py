"""
Premium (Stripe) integration.

Two things were wrong with the previous version and both are fixed here:

1. **The webhook accepted unsigned events.** When `STRIPE_WEBHOOK_SECRET` was unset
   it fell back to `stripe.Event.construct_from(json.loads(payload))` and then
   granted premium to whatever `user_id` the payload named. Anyone who could POST
   to the endpoint could give themselves — or anyone else — a paid plan.
   Signatures are now always verified and an unsigned event is rejected.

2. **The "monthly" plan was a one-off charge granting permanent access.** It created
   a one-time charge and set `premium: True` with no expiry, so 9.99 once bought
   premium forever. Monthly is now a real Stripe subscription with an expiry date,
   renewal handling and cancellation handling.

Both flows now run on the official `stripe` package. The one-time plan used to go
through `emergentintegrations`, a private SDK only installable inside the Emergent
platform — which meant this module could not even be imported anywhere else.

Premium state lives at the user document root: `premium`, `premium_plan`,
`premium_since`, `premium_expires_at`, `stripe_subscription_id`. Always read it
through `premium_active()` — a lifetime plan never expires, a subscription does.
"""
import os
from datetime import datetime, timezone
from typing import Any, Dict, Optional

import stripe
from fastapi import APIRouter, HTTPException, Depends, Request
from pydantic import BaseModel

from database import (
    users_collection,
    payment_transactions_collection,
    get_utc_now,
)
from auth import get_current_user
from entitlements import FREE_DAILY_SWIPES, premium_active
from quotas import swipes_used_today


# One key for everything. There used to be two: an Emergent-provisioned key for the
# one-time flow and a real Stripe key for subscriptions. The private SDK is gone, so
# both flows now go through the official `stripe` package and the same secret key.
STRIPE_SECRET_KEY = os.getenv("STRIPE_SECRET_KEY", "")
STRIPE_WEBHOOK_SECRET = os.getenv("STRIPE_WEBHOOK_SECRET", "")
STRIPE_PRICE_MONTHLY = os.getenv("STRIPE_PRICE_MONTHLY", "")

ENVIRONMENT = os.getenv("ENVIRONMENT", "development")

# Prices come from the environment so they can be changed without a deploy. The
# defaults preserve today's behaviour; note the PRD quotes premium at ~EUR 20/month,
# which these do not match — that reconciliation is a pricing decision, not a code
# one, so it is left explicit rather than silently changed here.
PREMIUM_CURRENCY = os.getenv("PREMIUM_CURRENCY", "usd").lower()
LIFETIME_AMOUNT = float(os.getenv("PREMIUM_LIFETIME_AMOUNT", "29.00"))
MONTHLY_AMOUNT = float(os.getenv("PREMIUM_MONTHLY_AMOUNT", "9.99"))

if STRIPE_SECRET_KEY:
    stripe.api_key = STRIPE_SECRET_KEY


class Plan(BaseModel):
    """A purchasable plan, as advertised to the client."""
    id: str
    name: str
    amount: float
    currency: str
    interval: Optional[str] = None  # None = one-time
    available: bool = True
    unavailable_reason: Optional[str] = None


def _plans() -> Dict[str, Plan]:
    """
    Server-side plan registry — the client never supplies an amount.

    `available` is computed rather than hardcoded so the paywall can hide a plan
    that cannot actually be purchased instead of offering one that 503s.
    """
    # Nothing can be sold without a secret key; a subscription additionally needs a
    # Price object. Reporting that honestly is what lets the paywall hide a plan
    # rather than offer one that 503s at checkout.
    checkout_ready = bool(STRIPE_SECRET_KEY)
    subscription_ready = checkout_ready and bool(STRIPE_PRICE_MONTHLY)
    return {
        "lifetime": Plan(
            id="lifetime",
            name="CoFound Premium Lifetime",
            amount=LIFETIME_AMOUNT,
            currency=PREMIUM_CURRENCY,
            interval=None,
            available=checkout_ready,
            unavailable_reason=(
                None if checkout_ready else "Payments need STRIPE_SECRET_KEY."
            ),
        ),
        "monthly": Plan(
            id="monthly",
            name="CoFound Premium (Monthly)",
            amount=MONTHLY_AMOUNT,
            currency=PREMIUM_CURRENCY,
            interval="month",
            available=subscription_ready,
            unavailable_reason=(
                None if subscription_ready
                else "Monthly billing needs STRIPE_SECRET_KEY and STRIPE_PRICE_MONTHLY."
            ),
        ),
    }


router = APIRouter(prefix="/api/premium", tags=["premium"])


# ============ PREMIUM STATE ============

def require_premium(current_user: dict = Depends(get_current_user)) -> dict:
    """
    FastAPI dependency for premium-only endpoints.

    402 rather than 403: the client turns a payment-required response into the
    paywall, and `ApiError.isPaymentRequired` already branches on it. Lives here
    rather than in `entitlements` so that module stays free of the auth stack.
    """
    if not premium_active(current_user):
        raise HTTPException(
            status_code=402,
            detail="This is a Premium feature. Upgrade to unlock it.",
        )
    return current_user


async def _grant_premium(
    user_id: str,
    plan: str,
    expires_at: Optional[datetime] = None,
    subscription_id: Optional[str] = None,
) -> None:
    """Mark a user premium. Idempotent — safe to call from both webhook and polling."""
    update: Dict[str, Any] = {
        "premium": True,
        "premium_plan": plan,
        "premium_since": get_utc_now(),
        "premium_expires_at": expires_at,
    }
    if subscription_id:
        update["stripe_subscription_id"] = subscription_id

    await users_collection.update_one({"user_id": user_id}, {"$set": update})


async def _revoke_premium(user_id: str, reason: str) -> None:
    """Take premium away — cancellation, failed renewal, or a refund."""
    await users_collection.update_one(
        {"user_id": user_id},
        {"$set": {
            "premium": False,
            "premium_revoked_at": get_utc_now(),
            "premium_revoked_reason": reason,
        }},
    )


# ============ PLANS ============

@router.get("/plans")
async def list_plans():
    """
    Purchasable plans.

    The paywall renders from this instead of hardcoding prices, so it can't offer a
    plan the backend isn't configured to sell.
    """
    return {"plans": [plan.model_dump() for plan in _plans().values()]}


# ============ CHECKOUT ============

class CheckoutRequest(BaseModel):
    plan: str  # 'lifetime' | 'monthly'
    origin_url: str  # frontend origin, e.g. https://myapp.example.com


class CheckoutResponse(BaseModel):
    url: str
    session_id: str


@router.post("/checkout", response_model=CheckoutResponse)
async def create_checkout_session(
    body: CheckoutRequest,
    current_user: dict = Depends(get_current_user),
):
    """Create a Stripe Checkout Session for the given premium plan."""
    plans = _plans()
    plan = plans.get(body.plan)
    if plan is None:
        raise HTTPException(status_code=400, detail="Invalid plan")
    if not plan.available:
        raise HTTPException(status_code=503, detail=plan.unavailable_reason or "Plan unavailable")

    if premium_active(current_user):
        raise HTTPException(status_code=400, detail="You already have Premium")

    origin = body.origin_url.rstrip("/")
    success_url = f"{origin}/premium/success?session_id={{CHECKOUT_SESSION_ID}}"
    cancel_url = f"{origin}/premium"

    metadata = {
        "user_id": current_user["user_id"],
        "user_email": current_user.get("email", ""),
        "plan": plan.id,
        "product_name": plan.name,
    }

    if plan.interval:
        session_id, url = _create_subscription_session(success_url, cancel_url, metadata)
    else:
        session_id, url = _create_one_time_session(plan, success_url, cancel_url, metadata)

    await payment_transactions_collection.insert_one({
        "session_id": session_id,
        "user_id": current_user["user_id"],
        "plan": plan.id,
        "amount": plan.amount,
        "currency": plan.currency,
        "interval": plan.interval,
        "payment_status": "pending",
        "status": "open",
        "metadata": {"product_name": plan.name},
        "created_at": get_utc_now(),
        "updated_at": get_utc_now(),
    })

    return CheckoutResponse(url=url, session_id=session_id)


def _create_subscription_session(success_url: str, cancel_url: str, metadata: Dict[str, str]):
    """
    Recurring plan: a real Stripe subscription against a Price object.

    `mode="subscription"` is what makes this actually recur — the previous
    implementation created a one-time charge and called it monthly.
    """
    try:
        session = stripe.checkout.Session.create(
            mode="subscription",
            line_items=[{"price": STRIPE_PRICE_MONTHLY, "quantity": 1}],
            success_url=success_url,
            cancel_url=cancel_url,
            client_reference_id=metadata["user_id"],
            metadata=metadata,
            subscription_data={"metadata": metadata},
        )
    except stripe.StripeError as e:
        raise HTTPException(status_code=502, detail=f"Stripe error: {e.user_message or str(e)}")

    return session.id, session.url


def _create_one_time_session(
    plan: Plan,
    success_url: str,
    cancel_url: str,
    metadata: Dict[str, str],
):
    """
    Lifetime plan: a single payment, built inline rather than against a Price object.

    `price_data` avoids having to keep a second Stripe Price in sync with
    `PREMIUM_LIFETIME_AMOUNT`. The amount is still server-side — it comes from the
    plan registry, never from the request — and `unit_amount` is in the currency's
    minor unit, so the euros/dollars figure is converted to cents here.
    """
    try:
        session = stripe.checkout.Session.create(
            mode="payment",
            line_items=[{
                "price_data": {
                    "currency": plan.currency,
                    "unit_amount": round(plan.amount * 100),
                    "product_data": {"name": plan.name},
                },
                "quantity": 1,
            }],
            success_url=success_url,
            cancel_url=cancel_url,
            client_reference_id=metadata["user_id"],
            metadata=metadata,
            payment_intent_data={"metadata": metadata},
        )
    except stripe.StripeError as e:
        raise HTTPException(status_code=502, detail=f"Stripe error: {e.user_message or str(e)}")

    return session.id, session.url


# ============ STATUS ============

class StatusResponse(BaseModel):
    status: str
    payment_status: str
    amount_total: int
    currency: str
    user_premium: bool
    already_processed: bool = False


@router.get("/status/{session_id}", response_model=StatusResponse)
async def get_checkout_status(
    session_id: str,
    current_user: dict = Depends(get_current_user),
):
    """
    Poll a checkout session. Grants premium on success, idempotently.

    The client polls this after returning from Stripe so activation doesn't depend
    on webhook delivery; the webhook is the authoritative path for renewals.
    """
    txn = await payment_transactions_collection.find_one({"session_id": session_id}, {"_id": 0})
    if not txn:
        raise HTTPException(status_code=404, detail="Session not found")
    if txn["user_id"] != current_user["user_id"]:
        raise HTTPException(status_code=403, detail="Not your session")

    already_processed = txn.get("payment_status") == "paid"

    if txn.get("interval"):
        status = _subscription_session_status(session_id)
    else:
        status = _one_time_session_status(session_id)

    await payment_transactions_collection.update_one(
        {"session_id": session_id},
        {"$set": {
            "status": status["status"],
            "payment_status": status["payment_status"],
            "amount_total": status["amount_total"],
            "currency": status["currency"],
            "updated_at": get_utc_now(),
        }},
    )

    user_is_premium = premium_active(current_user)

    if status["payment_status"] == "paid" and not already_processed:
        await _grant_premium(
            current_user["user_id"],
            txn.get("plan") or "lifetime",
            expires_at=status.get("expires_at"),
            subscription_id=status.get("subscription_id"),
        )
        user_is_premium = True

    return StatusResponse(
        status=status["status"],
        payment_status=status["payment_status"],
        amount_total=status["amount_total"],
        currency=status["currency"],
        user_premium=user_is_premium,
        already_processed=already_processed,
    )


def _subscription_session_status(session_id: str) -> Dict[str, Any]:
    """Read a subscription checkout session, including the period it paid for."""
    try:
        session = stripe.checkout.Session.retrieve(session_id, expand=["subscription"])
    except stripe.StripeError as e:
        raise HTTPException(status_code=502, detail=f"Stripe error: {e.user_message or str(e)}")

    subscription = session.get("subscription")
    expires_at = None
    subscription_id = None

    if isinstance(subscription, dict):
        subscription_id = subscription.get("id")
        period_end = subscription.get("current_period_end")
        if period_end:
            expires_at = datetime.fromtimestamp(period_end, tz=timezone.utc)
    elif isinstance(subscription, str):
        subscription_id = subscription

    return {
        "status": session.get("status") or "open",
        "payment_status": session.get("payment_status") or "unpaid",
        "amount_total": session.get("amount_total") or 0,
        "currency": session.get("currency") or PREMIUM_CURRENCY,
        "expires_at": expires_at,
        "subscription_id": subscription_id,
    }


def _one_time_session_status(session_id: str) -> Dict[str, Any]:
    """Read a one-time checkout session. No expiry — lifetime is lifetime."""
    try:
        session = stripe.checkout.Session.retrieve(session_id)
    except stripe.StripeError as e:
        raise HTTPException(status_code=502, detail=f"Stripe error: {e.user_message or str(e)}")

    return {
        "status": session.get("status") or "open",
        "payment_status": session.get("payment_status") or "unpaid",
        "amount_total": session.get("amount_total") or 0,
        "currency": session.get("currency") or PREMIUM_CURRENCY,
        "expires_at": None,
        "subscription_id": None,
    }


# ============ ACCOUNT ============

@router.get("/me")
async def get_my_premium(current_user: dict = Depends(get_current_user)):
    """Current user's premium status and swipe usage."""
    # Quota constants live in quotas.py so /api/swipe and this endpoint cannot
    # disagree about what the free allowance is.
    swipes_today = swipes_used_today(current_user)

    is_premium = premium_active(current_user)
    daily_limit = FREE_DAILY_SWIPES

    return {
        "premium": is_premium,
        "plan": current_user.get("premium_plan"),
        "premium_since": current_user.get("premium_since"),
        "premium_expires_at": current_user.get("premium_expires_at"),
        "cancel_at_period_end": bool(current_user.get("premium_cancel_at_period_end")),
        "daily_swipes_used": swipes_today,
        "daily_swipes_limit": daily_limit if not is_premium else None,
        "remaining_swipes": None if is_premium else max(0, daily_limit - swipes_today),
    }


@router.post("/cancel")
async def cancel_subscription(current_user: dict = Depends(get_current_user)):
    """
    Cancel a monthly subscription at the end of the paid period.

    Required by both app stores for a recurring purchase, and previously impossible:
    there was no subscription to cancel. Access is kept until the period the user
    already paid for runs out.
    """
    subscription_id = current_user.get("stripe_subscription_id")
    if not subscription_id:
        raise HTTPException(status_code=400, detail="No active subscription to cancel")

    if not STRIPE_SECRET_KEY:
        raise HTTPException(status_code=503, detail="Subscription management is not configured")

    try:
        subscription = stripe.Subscription.modify(subscription_id, cancel_at_period_end=True)
    except stripe.StripeError as e:
        raise HTTPException(status_code=502, detail=f"Stripe error: {e.user_message or str(e)}")

    period_end = subscription.get("current_period_end")
    expires_at = datetime.fromtimestamp(period_end, tz=timezone.utc) if period_end else None

    await users_collection.update_one(
        {"user_id": current_user["user_id"]},
        {"$set": {
            "premium_cancel_at_period_end": True,
            "premium_expires_at": expires_at,
        }},
    )

    return {"cancelled": True, "access_until": expires_at}


# ============ WEBHOOK ============

webhook_router = APIRouter(tags=["premium-webhook"])


def _verify_webhook(payload: bytes, signature: str):
    """
    Verify the Stripe signature and return the event.

    There is deliberately no unsigned path. The previous implementation fell back to
    parsing the body unverified when no secret was configured, and then granted
    premium to the `user_id` in that body — an unauthenticated privilege escalation.
    """
    if not STRIPE_WEBHOOK_SECRET:
        # Refuse rather than trust: an unverifiable event is not actionable.
        raise HTTPException(
            status_code=503,
            detail="Webhook rejected: STRIPE_WEBHOOK_SECRET is not configured.",
        )

    if not signature:
        raise HTTPException(status_code=400, detail="Missing stripe-signature header")

    try:
        return stripe.Webhook.construct_event(payload, signature, STRIPE_WEBHOOK_SECRET)
    except ValueError:
        raise HTTPException(status_code=400, detail="Malformed webhook payload")
    except stripe.SignatureVerificationError:
        raise HTTPException(status_code=400, detail="Invalid webhook signature")


async def _user_id_for_subscription(subscription: Dict[str, Any]) -> Optional[str]:
    """
    Resolve the account behind a subscription event.

    Prefers our own stored mapping over the event metadata: metadata is attacker-
    controlled on a forged event, and by this point we know the signature is valid
    but still shouldn't treat the payload as the source of truth for identity.
    """
    subscription_id = subscription.get("id")
    if subscription_id:
        user = await users_collection.find_one(
            {"stripe_subscription_id": subscription_id}, {"_id": 0, "user_id": 1}
        )
        if user:
            return user["user_id"]

    return (subscription.get("metadata") or {}).get("user_id")


@webhook_router.post("/api/webhook/stripe")
async def stripe_webhook(request: Request):
    """
    Handle Stripe webhook events.

    Covers the full subscription lifecycle, not just the first payment: renewals
    extend access, cancellations and failed payments revoke it.
    """
    event = _verify_webhook(await request.body(), request.headers.get("stripe-signature", ""))
    event_type = event["type"]
    obj = event["data"]["object"]

    if event_type == "checkout.session.completed":
        metadata = obj.get("metadata") or {}
        user_id = metadata.get("user_id") or obj.get("client_reference_id")
        plan = metadata.get("plan", "lifetime")
        session_id = obj.get("id")

        if user_id and obj.get("payment_status") in ("paid", "no_payment_required"):
            expires_at = None
            subscription_id = obj.get("subscription")
            if subscription_id and STRIPE_SECRET_KEY:
                try:
                    subscription = stripe.Subscription.retrieve(subscription_id)
                    period_end = subscription.get("current_period_end")
                    if period_end:
                        expires_at = datetime.fromtimestamp(period_end, tz=timezone.utc)
                except stripe.StripeError as e:
                    print(f"[stripe] could not read subscription {subscription_id}: {e}")

            await _grant_premium(user_id, plan, expires_at, subscription_id)
            if session_id:
                await payment_transactions_collection.update_one(
                    {"session_id": session_id},
                    {"$set": {
                        "payment_status": "paid",
                        "status": "complete",
                        "updated_at": get_utc_now(),
                    }},
                )

    elif event_type == "invoice.paid":
        # Renewal: push the expiry out to the new period end.
        subscription_id = obj.get("subscription")
        period_end = (obj.get("lines", {}).get("data") or [{}])[0].get("period", {}).get("end")
        if subscription_id:
            user = await users_collection.find_one(
                {"stripe_subscription_id": subscription_id}, {"_id": 0, "user_id": 1, "premium_plan": 1}
            )
            if user and period_end:
                await _grant_premium(
                    user["user_id"],
                    user.get("premium_plan") or "monthly",
                    expires_at=datetime.fromtimestamp(period_end, tz=timezone.utc),
                    subscription_id=subscription_id,
                )

    elif event_type in ("customer.subscription.deleted", "customer.subscription.paused"):
        user_id = await _user_id_for_subscription(obj)
        if user_id:
            await _revoke_premium(user_id, event_type)

    elif event_type == "invoice.payment_failed":
        # Don't revoke immediately — Stripe retries, and `premium_expires_at`
        # already limits access to the period that was actually paid for.
        subscription_id = obj.get("subscription")
        if subscription_id:
            await users_collection.update_one(
                {"stripe_subscription_id": subscription_id},
                {"$set": {"premium_payment_failed_at": get_utc_now()}},
            )

    elif event_type == "charge.refunded":
        metadata = obj.get("metadata") or {}
        user_id = metadata.get("user_id")
        if user_id:
            await _revoke_premium(user_id, "refunded")

    return {"received": True}
