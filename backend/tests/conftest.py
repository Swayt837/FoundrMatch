"""
Shared pytest configuration.

The API-level suites (`test_premium_features`, `test_iteration6_features`,
`test_premium_filters_iter8`) exercise a *deployed* backend over HTTP. Without
`EXPO_PUBLIC_BACKEND_URL` set they used to abort collection — one of them called
`.rstrip()` on `None` at import time — which made the whole `pytest tests/`
command unusable and hid the unit suites entirely.

They are now skipped with a clear reason instead, so `pytest backend/tests` runs
the dependency-free suites anywhere and the remote ones only when pointed at a
backend.

This file also stubs `emergentintegrations` when it isn't installed. That package
is a private SDK available only inside the deployment environment, and
`ai_service` imports it at module scope, so without the stub no test could import
any router — the endpoint modules were untestable for a reason that has nothing to
do with the endpoints.
"""
import os
import sys
import types

import pytest


def _stub_emergentintegrations() -> None:
    """
    Minimal stand-in for the private LLM SDK.

    Only the names `ai_service` imports are provided. Any test that actually calls
    the model has to patch `ai_service.ai_service`; the stub exists to make imports
    work, not to fake responses — a stub that returned plausible text would let a
    broken call path pass as working.
    """
    if "emergentintegrations" in sys.modules:
        return
    try:  # The real package, when running inside the deployment environment.
        import emergentintegrations  # noqa: F401
        return
    except ImportError:
        pass

    class _Unavailable:
        """Raises if a test tries to reach the service without patching it out."""

        def __init__(self, *args, **kwargs):
            raise RuntimeError(
                "emergentintegrations is stubbed in tests — patch the service object instead"
            )

    class _Payload:
        def __init__(self, *args, **kwargs):
            self.args = args
            self.kwargs = kwargs

    def module(name: str, **attrs) -> types.ModuleType:
        mod = types.ModuleType(name)
        # Mark the intermediate namespaces as packages, or importing a submodule
        # fails with "not a package".
        mod.__path__ = []
        for key, value in attrs.items():
            setattr(mod, key, value)
        sys.modules[name] = mod
        return mod

    root = module("emergentintegrations")
    llm = module("emergentintegrations.llm")
    chat = module(
        "emergentintegrations.llm.chat",
        LlmChat=_Unavailable,
        UserMessage=_Payload,
        TextDelta=_Payload,
        StreamDone=_Payload,
    )
    payments = module("emergentintegrations.payments")
    stripe_pkg = module("emergentintegrations.payments.stripe")
    checkout = module(
        "emergentintegrations.payments.stripe.checkout",
        StripeCheckout=_Unavailable,
        CheckoutSessionRequest=_Payload,
    )

    root.llm = llm
    root.payments = payments
    llm.chat = chat
    payments.stripe = stripe_pkg
    stripe_pkg.checkout = checkout


_stub_emergentintegrations()

# Suites that need a running backend rather than just importable modules.
REMOTE_SUITES = (
    "test_premium_features",
    "test_iteration6_features",
    "test_premium_filters_iter8",
)

BACKEND_URL_ENV = "EXPO_PUBLIC_BACKEND_URL"


def pytest_collection_modifyitems(config, items):
    """Skip the deployed-backend suites unless a target URL is configured."""
    if os.environ.get(BACKEND_URL_ENV):
        return

    skip = pytest.mark.skip(
        reason=f"needs a running backend — set {BACKEND_URL_ENV} to run this suite"
    )
    for item in items:
        if any(suite in item.nodeid for suite in REMOTE_SUITES):
            item.add_marker(skip)


def pytest_ignore_collect(collection_path, config):
    """
    Don't even import the remote suites without a URL.

    `test_premium_filters_iter8` reads the env var at module scope, so skipping at
    item level is too late — collection has to be prevented outright.
    """
    if os.environ.get(BACKEND_URL_ENV):
        return None
    if collection_path.stem in REMOTE_SUITES:
        return True
    return None
