"""
Transactional email, through Resend.

One provider, one function. There is exactly one thing this app sends — a
verification code — and an abstraction over three providers for one message
would be more code than the message.

Unconfigured is a supported state: `configured()` is false without an API key,
the verification route answers 503, and the rest of the app is unaffected. Same
degradation as storage, Stripe and Google sign-in.
"""
import os
from typing import Optional

import httpx

RESEND_API_KEY = os.getenv("RESEND_API_KEY", "").strip()
# Must be an address on a domain verified in Resend, or delivery is refused.
MAIL_FROM = os.getenv("MAIL_FROM", "CoFoundr <onboarding@resend.dev>").strip()

RESEND_URL = "https://api.resend.com/emails"
TIMEOUT_SECONDS = 10


class MailError(RuntimeError):
    """The message could not be handed to the provider."""


def configured() -> bool:
    return bool(RESEND_API_KEY)


async def send(to: str, subject: str, html: str, text: Optional[str] = None) -> str:
    """
    Send one message. Returns the provider's id for it.

    Errors are raised rather than swallowed, unlike push notifications: a
    verification code that silently fails to send leaves the user staring at a
    box waiting for something that is never coming.
    """
    if not configured():
        raise MailError("Email sending is not configured (RESEND_API_KEY is unset)")

    payload = {
        "from": MAIL_FROM,
        "to": [to],
        "subject": subject,
        "html": html,
    }
    if text:
        payload["text"] = text

    try:
        async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS) as client:
            response = await client.post(
                RESEND_URL,
                json=payload,
                headers={"Authorization": f"Bearer {RESEND_API_KEY}"},
            )
    except httpx.HTTPError as exc:
        raise MailError(f"Could not reach the email provider: {exc}") from exc

    if response.status_code >= 400:
        raise MailError(f"Email provider refused the message: {response.text[:200]}")

    return (response.json() or {}).get("id", "")


def verification_email(code: str) -> tuple:
    """
    `(subject, html, text)` for a verification code.

    Plain text alongside HTML because some clients show only that, and a code
    nobody can read is not a verification.
    """
    subject = f"{code} is your CoFoundr verification code"
    html = f"""
      <div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;
                  background:#09090B;color:#FAFAFA;padding:40px 24px;border-radius:12px">
        <p style="margin:0 0 8px;color:#A1A1AA;font-size:13px;letter-spacing:1.5px">
          COFOUNDR
        </p>
        <h1 style="margin:0 0 24px;font-size:22px;font-weight:600">Confirm your email</h1>
        <p style="margin:0 0 24px;color:#A1A1AA;line-height:1.6">
          Enter this code in the app. It expires in 15 minutes.
        </p>
        <p style="margin:0 0 24px;font-size:34px;letter-spacing:10px;color:#D4AF37;
                  font-weight:700">{code}</p>
        <p style="margin:0;color:#71717A;font-size:13px;line-height:1.6">
          If you did not ask for this, ignore it — nothing has changed on your account.
        </p>
      </div>
    """
    text = (
        f"Your CoFoundr verification code is {code}. It expires in 15 minutes.\n\n"
        "If you did not ask for this, ignore this message."
    )
    return subject, html, text
