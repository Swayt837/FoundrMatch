"""
Premium (Stripe) integration — Lifetime one-time & Monthly subscription
Uses Emergent-provisioned Stripe test key (sk_test_emergent) with proxy base.
"""
import os
import stripe
from typing import Optional

from fastapi import APIRouter, HTTPException, Depends, Request
from pydantic import BaseModel

from emergentintegrations.payments.stripe.checkout import (
    StripeCheckout,
    CheckoutSessionRequest,
)
from database import (
    users_collection,
    payment_transactions_collection,
    get_utc_now,
)
from auth import get_current_user
from quotas import FREE_DAILY_SWIPES, swipes_used_today


STRIPE_API_KEY = os.getenv("STRIPE_API_KEY", "sk_test_emergent")
STRIPE_WEBHOOK_SECRET = os.getenv("STRIPE_WEBHOOK_SECRET", "")


# Server-side price registry — DO NOT trust client for amount
PLAN_PRICES = {
    "lifetime": {"amount": 29.00, "currency": "usd", "name": "CoFound Premium Lifetime"},
    "monthly": {"amount": 9.99, "currency": "usd", "name": "CoFound Premium (Monthly)"},
}

router = APIRouter(prefix="/api/premium", tags=["premium"])


class CheckoutRequest(BaseModel):
    plan: str  # 'lifetime' | 'monthly'
    origin_url: str  # frontend origin, e.g. https://myapp.example.com


class CheckoutResponse(BaseModel):
    url: str
    session_id: str


class StatusResponse(BaseModel):
    status: str
    payment_status: str
    amount_total: int
    currency: str
    user_premium: bool
    already_processed: bool = False


def _get_stripe_checkout(webhook_url: Optional[str] = None) -> StripeCheckout:
    return StripeCheckout(
        api_key=STRIPE_API_KEY,
        webhook_secret=STRIPE_WEBHOOK_SECRET or None,
        webhook_url=webhook_url,
    )


@router.post("/checkout", response_model=CheckoutResponse)
async def create_checkout_session(
    body: CheckoutRequest,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    """Create a Stripe Checkout Session for the given premium plan."""
    if body.plan not in PLAN_PRICES:
        raise HTTPException(status_code=400, detail="Invalid plan")

    # Prevent duplicate lifetime purchase
    if current_user.get("premium") and body.plan == "lifetime":
        raise HTTPException(status_code=400, detail="You already have Premium Lifetime")

    plan_meta = PLAN_PRICES[body.plan]

    origin = body.origin_url.rstrip("/")
    success_url = f"{origin}/premium/success?session_id={{CHECKOUT_SESSION_ID}}"
    cancel_url = f"{origin}/premium"

    # Build webhook URL from request base (used by the emergent proxy)
    webhook_url = str(request.base_url).rstrip("/") + "/api/webhook/stripe"

    checkout = _get_stripe_checkout(webhook_url=webhook_url)

    session_request = CheckoutSessionRequest(
        amount=plan_meta["amount"],
        currency=plan_meta["currency"],
        success_url=success_url,
        cancel_url=cancel_url,
        metadata={
            "user_id": current_user["user_id"],
            "user_email": current_user.get("email", ""),
            "plan": body.plan,
            "product_name": plan_meta["name"],
        },
    )

    try:
        session = await checkout.create_checkout_session(session_request)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Stripe error: {str(e)}")

    # Record initial transaction (unpaid)
    await payment_transactions_collection.insert_one({
        "session_id": session.session_id,
        "user_id": current_user["user_id"],
        "plan": body.plan,
        "amount": plan_meta["amount"],
        "currency": plan_meta["currency"],
        "payment_status": "pending",
        "status": "open",
        "metadata": {"product_name": plan_meta["name"]},
        "created_at": get_utc_now(),
        "updated_at": get_utc_now(),
    })

    return CheckoutResponse(url=session.url, session_id=session.session_id)


async def _apply_premium(user_id: str, plan: str, session_id: str):
    """Idempotently mark the user as premium."""
    update = {
        "premium": True,
        "premium_plan": plan,
        "premium_since": get_utc_now(),
    }
    await users_collection.update_one({"user_id": user_id}, {"$set": update})


@router.get("/status/{session_id}", response_model=StatusResponse)
async def get_checkout_status(
    session_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Poll to check payment status. Also flips user to premium on success (idempotent)."""
    txn = await payment_transactions_collection.find_one({"session_id": session_id}, {"_id": 0})
    if not txn:
        raise HTTPException(status_code=404, detail="Session not found")
    if txn["user_id"] != current_user["user_id"]:
        raise HTTPException(status_code=403, detail="Not your session")

    checkout = _get_stripe_checkout()
    try:
        status = await checkout.get_checkout_status(session_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Stripe error: {str(e)}")

    already_processed = txn.get("payment_status") == "paid"

    # Update local record
    await payment_transactions_collection.update_one(
        {"session_id": session_id},
        {"$set": {
            "status": status.status,
            "payment_status": status.payment_status,
            "amount_total": status.amount_total,
            "currency": status.currency,
            "updated_at": get_utc_now(),
        }},
    )

    user_is_premium = current_user.get("premium", False)

    # Grant premium if paid & not already processed
    if status.payment_status == "paid" and not already_processed:
        plan = txn.get("plan") or (status.metadata or {}).get("plan", "lifetime")
        await _apply_premium(current_user["user_id"], plan, session_id)
        user_is_premium = True

    return StatusResponse(
        status=status.status,
        payment_status=status.payment_status,
        amount_total=status.amount_total,
        currency=status.currency,
        user_premium=user_is_premium,
        already_processed=already_processed,
    )


@router.get("/me")
async def get_my_premium(current_user: dict = Depends(get_current_user)):
    """Return current user's premium status + swipe usage."""
    # Quota constants live in quotas.py so /api/swipe and this endpoint cannot
    # disagree about what the free allowance is.
    swipes_today = swipes_used_today(current_user)

    is_premium = bool(current_user.get("premium", False))
    daily_limit = FREE_DAILY_SWIPES

    return {
        "premium": is_premium,
        "plan": current_user.get("premium_plan"),
        "premium_since": current_user.get("premium_since"),
        "daily_swipes_used": swipes_today,
        "daily_swipes_limit": daily_limit if not is_premium else None,
        "remaining_swipes": None if is_premium else max(0, daily_limit - swipes_today),
    }


# ============ WEBHOOK ============

webhook_router = APIRouter(tags=["premium-webhook"])


@webhook_router.post("/api/webhook/stripe")
async def stripe_webhook(request: Request):
    """Handle Stripe webhook events (checkout.session.completed etc.)."""
    payload = await request.body()
    sig_header = request.headers.get("stripe-signature", "")

    checkout = _get_stripe_checkout()
    try:
        result = await checkout.handle_webhook(payload, sig_header)
    except AttributeError:
        # Fallback: use raw stripe library
        try:
            event = stripe.Webhook.construct_event(
                payload, sig_header, STRIPE_WEBHOOK_SECRET
            ) if STRIPE_WEBHOOK_SECRET else stripe.Event.construct_from(
                __import__("json").loads(payload.decode()), STRIPE_API_KEY
            )
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid webhook")
        result = None
        obj = event["data"]["object"]
        if event["type"] == "checkout.session.completed":
            metadata = obj.get("metadata") or {}
            user_id = metadata.get("user_id")
            plan = metadata.get("plan", "lifetime")
            session_id = obj.get("id")
            if obj.get("payment_status") == "paid" and user_id:
                await _apply_premium(user_id, plan, session_id)
                await payment_transactions_collection.update_one(
                    {"session_id": session_id},
                    {"$set": {"payment_status": "paid", "status": "complete",
                              "updated_at": get_utc_now()}},
                )
        return {"received": True}

    # If handle_webhook exists, process result object
    try:
        if result and getattr(result, "event_type", None) == "checkout.session.completed":
            metadata = getattr(result, "metadata", {}) or {}
            user_id = metadata.get("user_id")
            plan = metadata.get("plan", "lifetime")
            session_id = getattr(result, "session_id", None)
            payment_status = getattr(result, "payment_status", None)
            if payment_status == "paid" and user_id:
                await _apply_premium(user_id, plan, session_id)
                if session_id:
                    await payment_transactions_collection.update_one(
                        {"session_id": session_id},
                        {"$set": {"payment_status": "paid", "status": "complete",
                                  "updated_at": get_utc_now()}},
                    )
    except Exception as e:
        print(f"Webhook handling error: {e}")

    return {"received": True}
