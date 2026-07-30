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
"""
import os

import pytest

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
