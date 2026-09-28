"""Shared test setup.

Settings are read once per process, so the test environment must be set
BEFORE the app is imported. The tests use a fixed fake key and a small
upload limit, never the real .env values (environment variables beat .env).
"""

from __future__ import annotations

import os
from collections.abc import Iterator
from pathlib import Path

import pytest

TEST_KEY = "test-internal-key-" + "x" * 32
os.environ["INTERNAL_API_KEY"] = TEST_KEY
os.environ["MAX_UPLOAD_BYTES"] = "300000"

from fastapi.testclient import TestClient  # noqa: E402

from app.main import create_app  # noqa: E402

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture(scope="session")
def client() -> Iterator[TestClient]:
    """One app for the whole run. `with` runs the lifespan, so the model loads once."""
    with TestClient(create_app()) as c:
        state = c.app.state.model_state
        if not state.ready:
            pytest.skip(f"model not available ({state.error}) - run scripts/fetch_model.py")
        yield c


@pytest.fixture
def auth() -> dict[str, str]:
    return {"X-Internal-Key": TEST_KEY}


@pytest.fixture
def disease_photo() -> bytes:
    return (FIXTURES / "maize_common_rust.jpg").read_bytes()


@pytest.fixture
def healthy_photo() -> bytes:
    return (FIXTURES / "potato_healthy.jpg").read_bytes()
