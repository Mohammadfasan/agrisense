"""Internal authentication: only the Node API may call ml-service.

Browsers never talk to this service directly - the Node API does the user
auth, rate limits and ownership checks, then calls us with a shared secret
in the X-Internal-Key header. Without the right key: 401.
"""

from __future__ import annotations

import secrets
from typing import Annotated

from fastapi import Depends, Header, HTTPException, status

from app.core.config import Settings, get_settings

API_KEY_HEADER = "X-Internal-Key"


def require_internal_key(
    settings: Annotated[Settings, Depends(get_settings)],
    x_internal_key: Annotated[str | None, Header(alias=API_KEY_HEADER)] = None,
) -> None:
    """FastAPI dependency: raise 401 unless the header holds the shared key."""
    expected = settings.internal_api_key.get_secret_value().encode()
    given = (x_internal_key or "").encode()
    if not secrets.compare_digest(given, expected):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="missing or invalid internal key",
        )
